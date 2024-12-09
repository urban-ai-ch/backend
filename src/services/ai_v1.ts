import Replicate from 'replicate';

import { Service } from '..';
import { authenticateToken } from './auth_v1';

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

				const imgUrl = request.url.replace(subPath, `/images/v1/image/${payload.imageName}`);

				const output = await replicate.run(
					'idea-research/ram-grounded-sam:80a2aede4cf8e3c9f26e96c308d45b23c350dd36f1c381de790715007f1ac0ad',
					{
						input: {
							use_sam_hq: true,
							input_image: imgUrl,
						},
					}
				);
				console.log(output);
			}
		}
	},
};

export default service;
