import { Service } from '..';
import { AccountKV } from '../types';
import { authenticateToken } from './auth_v1';

type UserResponse = {
	username: string;
	email: string;
	bio: string;
};

type UserPayload = {
	email?: string;
	bio?: string;
};

const service: Service = {
	path: '/users/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'GET me': {
				if (authContext instanceof Response) return authContext;

				const userData: AccountKV | null = await env.ACCOUNTS_KV.get(authContext.username, 'json');

				if (!userData) {
					return new Response('User not found', { status: 400 });
				}

				const responseData: UserResponse = {
					email: userData.email,
					username: userData.username,
					bio: userData.bio ?? '',
				};

				return new Response(JSON.stringify(responseData), { status: 200 });
			}
			case 'PUT me': {
				if (authContext instanceof Response) return authContext;

				const payload = await request.json<UserPayload>();
				const userData: AccountKV | null = await env.ACCOUNTS_KV.get(authContext.username, 'json');

				if (!userData) {
					return new Response('User not found', { status: 400 });
				}

				const newUserData: AccountKV = {
					username: userData.username,
					password: userData.password,
					email: payload.email ?? userData.email,
					bio: payload.bio ?? userData.bio,
				};

				await env.ACCOUNTS_KV.put(authContext.username, JSON.stringify(newUserData));

				return new Response('User data updated', { status: 200 });
			}
		}
	},
};

export default service;
