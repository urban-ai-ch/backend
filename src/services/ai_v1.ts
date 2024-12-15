import { Service } from '..';
import { authenticateToken } from './auth_v1';
import { getImageURL } from './images_v1';

type DetectionPayload = {
	imageName: string;
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

				const replicateBody: ReplicatePayload = {
					input: input,
					webhook: `https://${new URL(request.url).host}/webhooks/v1/replicate?original_image_name=${payload.imageName}`,
					webhook_events_filter: ['output'],
				};

				const headers = new Headers();
				headers.set('Authorization', `Bearer ${env.REPLICATE_API_TOKEN}`);
				headers.set('cf-aig-authorization', `Bearer ${env.AI_GATEWAY_TOKEN}`);
				headers.set('Content-Type', 'application/json');

				const model_owner = 'gerbernoah';
				const deployment_name = 'urban-ai-grounding-sam';
				const cloudflareAccountID = '5b90fdf2bc4e39874b024b2bc8cd5d13';
				const gatewayID = 'webdev-hs24';

				const replicatePromise = fetch(
					`https://gateway.ai.cloudflare.com/v1/${cloudflareAccountID}/${gatewayID}/replicate/deployments/${model_owner}/${deployment_name}/predictions`,
					{
						method: 'POST',
						body: JSON.stringify(replicateBody),
						headers,
					},
				).then(() => console.log('fiinished'));

				ctx.waitUntil(replicatePromise);

				return new Response('Job queued', { status: 200 });
			}
		}
	},
};

export default service;
