import { Service } from '..';
import { hash, signJWT, verifyJWT } from '../auth';
import { AccountKV } from '../types';

type SignUpPayload = {
	username: string;
	password: string;
	email: string;
};

type SignInPayload = {
	username: string;
	password: string;
};

type AuthTokenResponse = {
	token: string;
};

export type JWTPayload = {
	iat: number;
	jti: string;
	username: string;
};

const service: Service = {
	path: '/auth/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'POST signup': {
				//return new Response('Signup disabled', { status: 409 });

				const { username, password, email } = await request.json<SignUpPayload>();

				const oldUser: AccountKV | null = await env.ACCOUNTS_KV.get(username, 'json');
				if (oldUser) return new Response('User already exists', { status: 400 });

				const user: AccountKV = {
					username,
					password: await hash(password),
					email,
				};

				await env.ACCOUNTS_KV.put(username, JSON.stringify(user));
				return new Response('User registered successfully', { status: 201 });
			}
			case 'POST signin': {
				const { username, password } = await request.json<SignInPayload>();

				const user: AccountKV | null = await env.ACCOUNTS_KV.get(username, 'json');
				if (!user) return new Response('User not found', { status: 400 });

				if (user.password !== (await hash(password))) return new Response('Invalid password', { status: 400 });

				const payload: JWTPayload = { iat: Date.now(), jti: crypto.randomUUID(), username };
				const token = await signJWT(payload, env.JWT_SECRET, 24 * 60 * 60);

				const response: AuthTokenResponse = { token };
				return new Response(JSON.stringify(response), { status: 200 });
			}
			case 'GET auth': {
				if (authContext instanceof Response) return authContext;
				return new Response('Authenticated', { status: 200 });
			}
		}
	},
};

export async function authenticateToken(headers: Headers, env: Env): Promise<JWTPayload | Response> {
	const authHeader = headers.get('Authorization');
	if (!authHeader) return new Response('Invalid token', { status: 401 });

	const token = authHeader.split(' ')[1];
	const context = await verifyJWT<JWTPayload>(token, env.JWT_SECRET);

	if (!context) {
		return new Response('Invalid token', { status: 401 });
	}

	return context; // verified is now typed as JWTPayload
}

export default service;
