import Replicate from 'replicate';

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

const service: Service = {
	path: '/ai/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);
		if (authContext instanceof Response) return authContext;

		const replicate = new Replicate({
			auth: env.REPLICATE_API_TOKEN,
			useFileOutput: false,
		});

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'POST detection': {
				const payload = await request.json<DetectionPayload>();

				const input: GroundingSamInput = {
					image_url: getImageURL(request.url, payload.imageName),
					labels: ['house facade'],
				};

				const replicatePromise = replicate
					.run('gerbernoah/grounding-sam:9cea0b079b1892a3c05d052d043fca45483ff55bbebfeed2fa0c20cc6a9a69e7', {
						input,
						webhook: `https://${new URL(request.url).host}/webhooks/v1/replicate`,
						webhook_events_filter: ['output'],
					})
					.then(() => console.log('fiinished'));

				ctx.waitUntil(replicatePromise);

				return new Response('Job queued', { status: 200 });
			}
		}
	},
};

export default service;
