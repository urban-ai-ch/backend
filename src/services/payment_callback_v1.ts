import { Service } from '..';

const service: Service = {
	path: '/payment_callback/v1/',

	fetch: async (request: Request, subPath: string, env: Env): Promise<Response | void> => {
		const username = '';
		const amount = 0;

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'GET stripe': {
				const tokensResult = await env.DB.prepare(
					`SELECT token_count
					FROM tokens
					WHERE user_name = ?`,
				)
					.bind(username)
					.first<TokensRow>();

				const writeStmt = env.DB.prepare(
					`INSERT INTO tokens(user_name, token_count)
					VALUES(?, ?)
					ON CONFLICT(user_name)
					DO UPDATE SET user_name = excluded.user_name, token_count = excluded.token_count`,
				);

				const updatedTokens = amount + (tokensResult?.token_count ?? 0);
				const result = await writeStmt.bind(username, updatedTokens).run<TokensRow>();
			}
		}
	},
};

export default service;
