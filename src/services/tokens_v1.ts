import { Service } from '..';
import { authenticateToken } from './auth_v1';
import { Redis } from '@upstash/redis';

type OrderPayload = {
	amount: number;
};

const service: Service = {
	path: '/tokens/v1/',

	fetch: async (request: Request, subPath: string, env: Env): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);
		if (authContext instanceof Response) return authContext;

		const redis = new Redis({
			url: 'https://aware-lionfish-49993.upstash.io',
			token: env.UPSTASH_API_TOKEN,
		});

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'POST preview': {
				return new Response('Token Preview');
			}
			case 'GET order': {
				return new Response('You bought some tokens');
			}
		}
	},
};

export default service;
