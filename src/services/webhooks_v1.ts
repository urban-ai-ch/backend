import Stripe from 'stripe';
import { Service } from '..';
import { GroundingSamInput, imageAnalyticsAI, replicateURL } from './ai_v1';
import Replicate, { validateWebhook } from 'replicate';
import { updateTokenCount } from './tokens_v1';
import { stripeSumItemsByName } from './payments_v1';

export type ReplicatePrediction<I> = {
	id: string;
	input: I;
	output: string;
	status: string;
	metrics: any;
};

const service: Service = {
	path: '/webhooks/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'POST stripe': {
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

						const success = await updateTokenCount(env, username, quantity);
						if (success) {
							return new Response(`Added ${quantity} tokens`, { status: 200 });
						} else {
							return new Response('An error occured while crediting tokens');
						}
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

				const imageKey = encodeURIComponent(new URL(prediction.input.image_url).pathname);
				const inputKey = encodeURIComponent(prediction.input.labels.toString());
				const cacheKey = `${replicateURL}-${imageKey}-${inputKey}`;
				console.log({ replicateURL, imageKey, inputKey });
				console.log('cacheKey put', cacheKey);
				const cacheResponse = new Response(prediction.output, {
					headers: {
						'Cache-Control': 'private, max-age=31536000',
						'Content-Type': 'text/plain',
					},
				});
				await caches.default.put(cacheKey, cacheResponse);

				ctx.waitUntil(imageAnalyticsAI(request, env, prediction.output));

				return new Response('Result received', { status: 200 });
			}
		}
	},
};

export default service;
