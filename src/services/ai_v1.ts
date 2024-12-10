import Replicate from 'replicate';

import { Service } from '..';
import { authenticateToken } from './auth_v1';
import { getImageURL } from './images_v1';

type DetectionPayload = {
	imageName: string;
};

const service: Service = {
	path: '/ai/v1/',

	fetch: async (request: Request, subPath: string, env: Env): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);
		if (authContext instanceof Response) return authContext;

		const replicate = new Replicate({
			auth: env.REPLICATE_API_TOKEN,
		});

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'GET detection': {
				const payload = await request.json<DetectionPayload>();

				const imgUrl = getImageURL(request.url, payload.imageName);

				const output = await replicate.run(
					'gerbernoah/grounding-dino-fork:4f5d21fed8f0a1a84f53f563f9748e069d2fa286dbd09e4e148a0b15ca871695',
					{
						input: {
							image: imgUrl,
							query: 'house facade',
							box_threshold: 0.25,
							text_threshold: 0.25,
							show_visualisation: true,
						},
					}
				);

				console.log(output);
				return new Response(JSON.stringify(output), { status: 200 });
			}
		}
	},
};

export default service;
