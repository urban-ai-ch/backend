import { Service } from '..';
import { authenticateToken } from './auth_v1';
import { Criteria, getImageMetaURL, getImageURL, ImageMetaData } from './images_v1';

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

const service: Service = {
	path: '/ai/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);
		if (authContext instanceof Response) return authContext;

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'POST detection': {
				const payload = await request.json<DetectionPayload>();

				const input: GroundingSamInput = {
					image_url: getImageURL(request.url, payload.imageName),
					labels: ['house facade'],
				};

				const original = await env.IMAGES_BUCKET.get(payload.imageName);
				if (!original) return new Response('Original Image not found');

				console.log(original.customMetadata);
				const metaData: ImageMetaData = {
					materials: original.customMetadata?.materials,
					history: original.customMetadata?.history,
					seismic: original.customMetadata?.seismic,
				};

				metaData[payload.criteria] = 'Processing';

				console.log(metaData);

				await env.IMAGES_BUCKET.put(payload.imageName, await original.blob(), {
					customMetadata: metaData,
				});
				await caches.default.delete(getImageMetaURL(request.url, payload.imageName));

				const webhookUrl = new URL(`https://${new URL(request.url).host}/webhooks/v1/replicate`);
				webhookUrl.searchParams.set('original_image_name', payload.imageName);
				webhookUrl.searchParams.set('criteria', payload.criteria);

				const replicateBody: ReplicatePayload = {
					input: input,
					webhook: webhookUrl.toString(),
					webhook_events_filter: ['output'],
				};

				const headers = new Headers();
				headers.set('Authorization', `Bearer ${env.REPLICATE_API_TOKEN}`);
				headers.set('cf-aig-authorization', `Bearer ${env.AI_GATEWAY_TOKEN}`);
				headers.set('Content-Type', 'application/json');
				headers.set('cf-aig-skip-cache', 'true');

				const model_owner = 'gerbernoah';
				const deployment_name = 'urban-ai-grounding-sam';
				const cloudflareAccountID = '5b90fdf2bc4e39874b024b2bc8cd5d13';
				const gatewayID = 'webdev-hs24';

				const replicateURL = `https://gateway.ai.cloudflare.com/v1/${cloudflareAccountID}/${gatewayID}/replicate/deployments/${model_owner}/${deployment_name}/predictions`;

				const replicatePromise = fetch(replicateURL, {
					method: 'POST',
					body: JSON.stringify(replicateBody),
					headers,
				});

				ctx.waitUntil(Promise.allSettled([replicatePromise]));

				return new Response('Job queued', { status: 200 });
			}
		}
	},
};

export default service;
