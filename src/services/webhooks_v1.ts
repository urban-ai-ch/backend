import Stripe from 'stripe';
import { Service } from '..';
import { GroundingSamInput } from './ai_v1';
import Replicate, { validateWebhook } from 'replicate';
import { Criteria, getImageMetaURL, getImageURL, ImageMetaData } from './images_v1';

type ReplicatePrediction<I> = {
	id: string;
	input: I;
	output: string;
	status: string;
	metrics: any;
};

type AiInput = {
	[key in Criteria]?: string;
};

export const stripeSumItemsByName = async (
	lineItems: Stripe.ApiList<Stripe.LineItem>,
	name: string,
	stripe: Stripe,
): Promise<number> => {
	let totalAmount = 0;

	for (const item of lineItems.data) {
		if (!item.price) continue;

		let product = item.price.product;
		if (typeof product === 'string') product = await stripe.products.retrieve(product);
		if (product.deleted) continue;

		totalAmount += product.name === name ? (item.quantity ?? 0) : 0;
	}

	return lineItems.has_more
		? totalAmount +
				(await stripeSumItemsByName(
					await stripe.checkout.sessions.listLineItems('session_id', {
						starting_after: lineItems.data[lineItems.data.length - 1].id,
					}),
					name,
					stripe,
				))
		: totalAmount;
};

const service: Service = {
	path: '/webhooks/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'GET stripe': {
				const event = await request.json<Stripe.Event>();
				const stripe = new Stripe(env.STRIPE_PRIVATE_KEY);

				switch (event.type) {
					case 'checkout.session.completed':
						const paymentIntent = event.data.object;

						if (!paymentIntent.line_items) {
							return new Response('Items missing', { status: 400 });
						}

						if (!paymentIntent.metadata || !paymentIntent.metadata['username']) {
							return new Response('Username missing', { status: 400 });
						}

						const username = paymentIntent.metadata['username'];
						const quantity = await stripeSumItemsByName(paymentIntent.line_items, 'Token', stripe);

						const tokensResult = await env.DB.prepare(
							`SELECT token_count
              FROM tokens
              WHERE user_name = ?`,
						)
							.bind(username)
							.first<TokensRow>();

						const writeStmt = env.DB.prepare(
							`INSERT INTO tokens(user_name, token_count)
              VALUES(?, ?)
              ON CONFLICT(user_name)
              DO UPDATE SET user_name = excluded.user_name, token_count = excluded.token_count`,
						);

						const updatedTokens = quantity + (tokensResult?.token_count ?? 0);
						await writeStmt.bind(username, updatedTokens).run<TokensRow>();

						return new Response(`Added ${quantity} tokens`, { status: 200 });
					default:
						return;
				}
			}
			case 'POST replicate': {
				const replicate = new Replicate({ auth: env.REPLICATE_API_TOKEN });

				const webHookCacheKey = new Request('https://urban-ai.ch');
				webHookCacheKey.headers.set('If-Modified-Since', new Date(Date.now() - 600000).toUTCString());

				const keyResponse = await caches.default.match(webHookCacheKey);
				let wHVKey = await keyResponse?.text();

				if (!wHVKey) {
					wHVKey = (await replicate.webhooks.default.secret.get()).key;
					caches.default.put(webHookCacheKey, new Response(wHVKey));
				}

				const isValid = await validateWebhook(request.clone(), wHVKey);

				if (!isValid) return new Response('Webhook corrupted', { status: 401 });

				const prediction = await request.json<ReplicatePrediction<GroundingSamInput>>();
				const url = prediction.output;

				console.log('Grounding-sam result: ' + url);

				const image = await (await fetch(url)).arrayBuffer();

				console.log(new URL(request.url).searchParams.get('criteria'));
				const criteria = new URL(request.url).searchParams.get('criteria') as Criteria;
				console.log(criteria);
				const aiInput: AiInput = {
					materials:
						'List only the main building materials used in the construction of the building in the image. No filler words, just the materials',
					history: 'Provide a brief history of this building, including its construction date',
					seismic: "What's the seismic risk of this building",
				};

				const prompt = aiInput[criteria];

				if (!prompt) {
					console.log('Criteria not found');
					return new Response('Criteria not found', { status: 400 });
				}

				const input = {
					image: [...new Uint8Array(image)],
					prompt: aiInput[criteria],
					max_tokens: 20,
				};

				const headers = new Headers();
				headers.set('cf-aig-authorization', `Bearer ${env.AI_GATEWAY_TOKEN}`);

				const aiPromise = env.AI.run('@cf/unum/uform-gen2-qwen-500m', input, {
					extraHeaders: headers,
					gateway: { id: 'webdev-hs24', collectLog: true },
				}).then(async (response) => {
					console.log('LLM result: ' + response.description);

					const original_image_name = new URL(request.url).searchParams.get('original_image_name');
					if (!original_image_name) return new Response('Original image name missing');

					const original = await env.IMAGES_BUCKET.get(original_image_name);
					if (!original) return new Response('Original Image not found');

					let metaData: ImageMetaData = {
						history: original.customMetadata?.history,
						materials: original.customMetadata?.materials,
						seismic: original.customMetadata?.seismic,
					};

					metaData[criteria] = response.description;

					const imageBucketPromise = env.IMAGES_BUCKET.put(original_image_name, await original.blob(), {
						customMetadata: metaData,
					});
					const cacheDeleteMetaPromise = caches.default.delete(getImageMetaURL(request.url, original_image_name));
					const cacheDeleteImagePromise = caches.default.delete(getImageURL(request.url, original_image_name));

					await Promise.allSettled([imageBucketPromise, cacheDeleteImagePromise, cacheDeleteMetaPromise]);
				});

				ctx.waitUntil(aiPromise);

				return new Response('Result received', { status: 200 });
			}
		}
	},
};

export default service;
