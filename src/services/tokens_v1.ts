import { Service } from '..';
import { authenticateToken } from './auth_v1';

type TokenResponse = {
	tokenCount: number;
};

const service: Service = {
	path: '/tokens/v1/',

	fetch: async (request: Request, subPath: string, env: Env): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);
		if (authContext instanceof Response) return authContext;

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'GET self': {
				const username = 'a';
				const amount = 0;

				const tokensResult = await env.DB.prepare(
					`SELECT token_count
					FROM tokens
					WHERE user_name = ?`,
				)
					.bind(username)
					.first<TokensRow>();

				const response: TokenResponse = {
					tokenCount: tokensResult?.token_count ?? 0,
				};

				return new Response(JSON.stringify(response), { status: 200 });
			}
		}
	},
};

export default service;
