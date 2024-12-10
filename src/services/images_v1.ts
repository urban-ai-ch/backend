import { Service } from '..';
import { authenticateToken } from './auth_v1';

type ImageObject = {
	name: string;
	href: string;
};

export const getImageURL = (url: string, imageName: string): string => {
	return `https://${new URL(url).host}/images/v1/image/${imageName}`;
};

const service: Service = {
	path: '/images/v1/',

	fetch: async (request: Request, subPath: string, env: Env): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);

		const args = subPath.split('/');
		switch (request.method + ' ' + args[0]) {
			case 'POST images': {
				if (authContext instanceof Response) return authContext;

				const formData = await request.formData();
				const files = formData.getAll('image');

				if (files.length >= 5) {
					return new Response('You can only upload 5 files at once');
				}

				// Validate file size (2MB for each file)
				const MAX_SIZE = 2 * 1024 * 1024;
				const filePromises = files.map(async (file) => {
					if (!(file instanceof File)) {
						return new Response('Invalid file type', { status: 400 });
					}

					if (file.size > MAX_SIZE) {
						console.log('file size exeeded');
						return new Response('File size exceeds 2MB limit', { status: 413 });
					}

					const contentType = file.type;
					const uniqueName = `${authContext.username}-${crypto.randomUUID()}.${contentType.split('/')[1]}`;

					await env.IMAGES_BUCKET.put(uniqueName, file.stream(), {
						httpMetadata: { contentType: file.type },
					});

					const response: ImageObject = {
						name: uniqueName,
						href: getImageURL(request.url, uniqueName),
					};
					return response;
				});

				try {
					const fileResponses = await Promise.all(filePromises);

					const responses = await Promise.all(
						fileResponses.map((response) =>
							response instanceof Response ? response.text().then((text) => ({ text, status: response.status })) : response
						)
					);

					if (responses.length > 0) {
						return new Response(JSON.stringify(responses), { status: 400 });
					} else {
						return new Response(JSON.stringify(fileResponses), { status: 200 });
					}
				} catch {
					return new Response('Internal server error', { status: 500 });
				}
			}
			case 'GET image': {
				const cache = caches.default;
				let response = await cache.match(request.url);

				if (!response) {
					const imageName = args[1];
					const image = await env.IMAGES_BUCKET.get(imageName);

					if (!image) {
						return new Response('Image not found');
					}

					const headers = new Headers();
					image.writeHttpMetadata(headers);
					headers.set('etag', image.httpEtag);

					response = new Response(image.body, { status: 200, headers });
					await cache.put(request.url, response.clone());
				}

				const headers = new Headers(response.headers);
				headers.set('Cache-Control', 'private, max-age=31536000'); //1 year caching

				return new Response(response.body, {
					status: response.status,
					headers: headers,
				});
			}
			case 'GET images': {
				if (authContext instanceof Response) return authContext;
				const listResponse = await env.IMAGES_BUCKET.list({ prefix: authContext.username });

				const images: ImageObject[] = listResponse.objects.map((image) => {
					return { name: image.key, href: getImageURL(request.url, image.key) };
				});

				return new Response(JSON.stringify(images));
			}
		}
	},
};

export default service;
