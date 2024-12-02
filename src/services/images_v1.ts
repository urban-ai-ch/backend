import { Service } from '..';
import { authenticateToken } from './auth_v1';

type ImagesResponse = {
	name: string;
	href: string;
}[];

const service: Service = {
	path: '/images/v1/',

	fetch: async (request: Request, subPath: string, env: Env): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);
		if (authContext instanceof Response) return authContext;

		const args = subPath.split('/');
		switch (request.method + ' ' + args[0]) {
			case 'POST image': {
				const fileBuffer = await request.arrayBuffer();

				// Validate file size (2MB)
				const MAX_SIZE = 2 * 1024 * 1024;
				if (fileBuffer.byteLength > MAX_SIZE) {
					return new Response('File size exceeds 5MB limit', { status: 413 });
				}

				const uniqueName = `${authContext.username} - ${crypto.randomUUID()}.jpg`;

				await env.IMAGES_BUCKET.put(uniqueName, fileBuffer, {
					httpMetadata: { contentType: 'image/jpeg' },
				});

				return new Response('File uploaded successfully', { status: 200 });
			}
			case 'GET image': {
				const cacheKey = authContext.username + request.url;
				const cache = caches.default;
				let response = await cache.match(cacheKey);

				if (!response) {
					const imageName = args[1];
					if (!imageName.includes(authContext.username)) {
						return new Response('Image not found');
					}

					const image = await env.IMAGES_BUCKET.get(imageName);

					if (!image) {
						return new Response('Image not found');
					}

					const headers = new Headers();
					image.writeHttpMetadata(headers);
					headers.set('etag', image.httpEtag);

					response = new Response(image.body, { status: 200, headers });
					await cache.put(cacheKey, response.clone());
				}

				const headers = new Headers(response.headers);
				headers.set('Cache-Control', 'private, max-age=31536000'); //1 year caching

				return new Response(response.body, {
					status: response.status,
					headers: headers,
				});
			}
			case 'GET images': {
				const listResponse = await env.IMAGES_BUCKET.list({ prefix: authContext.username });

				const images: ImagesResponse = listResponse.objects.map((image) => {
					return { name: image.key, href: request.url.replace('images', `image/${image.key}`) };
				});

				return new Response(JSON.stringify(images));
			}
		}
	},
};

export default service;
