import { Service } from '..';
import { authenticateToken } from './auth_v1';

type TokenResponse = {
	tokenCount: number;
};

export const updateTokenCount = async (env: Env, username: string, quantity: number): Promise<boolean> => {
	const tokensResult = await env.DB.prepare(
		`SELECT token_count
								FROM tokens
								WHERE user_name = ?`,
	)
		.bind(username)
		.first<TokensRow>();

	const current = tokensResult?.token_count ?? 0;
	const updatedTokens = quantity + current;

	if (updatedTokens < 0) return false;

	const writeStmt = env.DB.prepare(
		`INSERT INTO tokens(user_name, token_count)
								VALUES(?, ?)
								ON CONFLICT(user_name)
								DO UPDATE SET user_name = excluded.user_name, token_count = excluded.token_count`,
	);

	const result = await writeStmt.bind(username, updatedTokens).run<TokensRow>();

	return !result.error;
};

const service: Service = {
	path: '/tokens/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);
		if (authContext instanceof Response) return authContext;

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'GET self': {
				const tokensResult = await env.DB.prepare(
					`SELECT token_count
					FROM tokens
					WHERE user_name = ?`,
				)
					.bind(authContext.username)
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
