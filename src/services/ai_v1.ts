import { Service } from '..';
import { authenticateToken } from './auth_v1';
import { Criteria, getImageMetaURL, getImageURL, ImageMetaData } from './images_v1';
import { updateTokenCount } from './tokens_v1';

type DetectionPayload = {
	imageName: string;
	criteria: Criteria;
};

export type GroundingSamInput = {
	image_url: string;
	labels: string[];
};

type ReplicatePayload = {
	input: GroundingSamInput;
	webhook: string;
	webhook_events_filter: string[];
};

type AiInput = {
	[key in Criteria]?: string;
};

export const imageAnalyticsAI = async (request: Request, env: Env, url: string): Promise<Response> => {
	console.log('ImageAnalytics input img ' + url);

	const image = await (await fetch(url)).arrayBuffer();

	const criteria = new URL(request.url).searchParams.get('criteria') as Criteria;

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
		if (!original_image_name) return new Response('Original image name missing', { status: 400 });

		const original = await env.IMAGES_BUCKET.get(original_image_name);
		if (!original) return new Response('Original Image not found', { status: 400 });

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

		await Promise.allSettled([imageBucketPromise, cacheDeleteMetaPromise]);

		return new Response('Information generated', { status: 200 });
	});

	return aiPromise;
};

const service: Service = {
	path: '/ai/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);
		if (authContext instanceof Response) return authContext;

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'POST detection': {
				if (await updateTokenCount(env, authContext.username, -1)) {
					return new Response('Not enough tokens', { status: 402 });
				}

				const payload = await request.json<DetectionPayload>();

				const input: GroundingSamInput = {
					image_url: getImageURL(request.url, payload.imageName),
					labels: ['house facade'],
				};

				const original = await env.IMAGES_BUCKET.get(payload.imageName);
				if (!original) return new Response('Original Image not found');

				const metaData: ImageMetaData = {
					materials: original.customMetadata?.materials,
					history: original.customMetadata?.history,
					seismic: original.customMetadata?.seismic,
				};

				metaData[payload.criteria] = 'Processing';

				await env.IMAGES_BUCKET.put(payload.imageName, await original.blob(), {
					customMetadata: metaData,
				});
				const imageCacheDeletePromise = caches.default.delete(getImageMetaURL(request.url, payload.imageName));

				const webhookUrl = new URL(`https://${new URL(request.url).host}/webhooks/v1/replicate`);
				webhookUrl.searchParams.set('original_image_name', payload.imageName);
				webhookUrl.searchParams.set('criteria', payload.criteria);

				const replicateBody: ReplicatePayload = {
					input: input,
					webhook: webhookUrl.toString(),
					webhook_events_filter: ['output'],
				};

				const croppedImageUrl = await env.CACHE_KV.get(`grounding-sam/${JSON.stringify(input)}`);
				if (croppedImageUrl) {
					console.log('Grounding-Sam cached');

					ctx.waitUntil(imageAnalyticsAI(request, env, croppedImageUrl));
				} else {
					console.log('Grounding-Sam fetching');

					const replicate_model_owner = 'gerbernoah';
					const replicate_deployment_name = 'urban-ai-grounding-sam';
					const cloudflareAccountID = '5b90fdf2bc4e39874b024b2bc8cd5d13';
					const gatewayID = 'webdev-hs24';

					const replicatePromise = fetch(
						`https://gateway.ai.cloudflare.com/v1/${cloudflareAccountID}/${gatewayID}/replicate/deployments/${replicate_model_owner}/${replicate_deployment_name}/predictions`,
						{
							method: 'POST',
							body: JSON.stringify(replicateBody),
							headers: {
								Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
								'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}`,
								'Content-Type': 'application/json',
								'cf-aig-skip-cache': 'true',
							},
						},
					);

					ctx.waitUntil(replicatePromise);
				}

				return new Response('Job queued', { status: 200 });
			}
		}
	},
};

export default service;
