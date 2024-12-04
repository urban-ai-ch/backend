import { Service } from '..';
import { authenticateToken } from './auth_v1';

type UserResponse = {
	username: string;
	email: string;
};

const service: Service = {
	path: '/users/v1/',

	fetch: async (request: Request, subPath: string, env: Env): Promise<Response | void> => {
		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'GET me': {
				const authContext = await authenticateToken(request.headers, env);
				if (authContext instanceof Response) return authContext;

				const userData: AccountKV | null = await env.ACCOUNTS_KV.get(authContext.username, 'json');

				if (!userData) {
					return new Response('User not found', { status: 400 });
				}

				const responseData: UserResponse = {
					email: userData.email,
					username: userData.username,
				};

				return new Response(JSON.stringify(responseData), { status: 200 });
			}
		}
	},
};

export default service;
