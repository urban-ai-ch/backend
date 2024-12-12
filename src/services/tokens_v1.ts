import { Service } from '..';
import { authenticateToken } from './auth_v1';

type OrderPayload = {
	amount: number;
};

const service: Service = {
	path: '/tokens/v1/',

	fetch: async (request: Request, subPath: string, env: Env): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);
		if (authContext instanceof Response) return authContext;

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'POST preview': {
				const payload = await request.json<OrderPayload>();

				if (true) {
					return new Response('Tokens updated successfully', { status: 200 });
				} else {
					return new Response('Order failed', { status: 500 });
				}
			}
			case 'GET order': {
				return new Response('You bought some tokens');
			}
		}
	},
};

export default service;
