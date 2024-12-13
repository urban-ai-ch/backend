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

	fetch: async (request: Request, subPath: string, env: Env): Promise<Response | void> => {
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

				const output = await replicate.run('gerbernoah/grounding-sam', {
					input,
					wait: { mode: 'poll' },
					webhook: `https://${new URL(request.url).host}/webhooks/v1/replicate`,
					webhook_events_filter: ['output'],
				});

				console.log(output);
				return new Response(JSON.stringify(output), { status: 200 });
			}
		}
	},
};

export default service;
