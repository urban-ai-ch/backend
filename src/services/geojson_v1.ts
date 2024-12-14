import { Service } from '..';
import { authenticateToken } from './auth_v1';

const service: Service = {
	path: '/geojson/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);
		if (authContext instanceof Response) return authContext;

		const args = subPath.split('/');
		switch (request.method + ' ' + args[0]) {
			case 'GET geojson': {
				const cacheKey = authContext.username + request.url;
				const cache = caches.default;
				let response = await cache.match(cacheKey);

				if (!response) {
					const data = await env.GEOSJON_BUCKET.get(args[1]);

					if (!data) {
						return new Response('Data not found', { status: 404 });
					}

					const headers = new Headers();
					data.writeHttpMetadata(headers);
					headers.set('etag', data.httpEtag);

					response = new Response(data.body, { status: 200, headers });
					await cache.put(cacheKey, response.clone());
				}

				const headers = new Headers(response.headers);
				headers.set('Cache-Control', 'private, max-age=31536000'); //1 year caching

				return new Response(response.body, {
					status: response.status,
					headers: headers,
				});
			}
		}
	},
};

export default service;
