import { Service } from '..';
import { authenticateToken } from './auth_v1';

type ImageObject = {
	name: string;
	href: string;
};

export type Criteria = 'materials' | 'history' | 'seismic';
export type ImageMetaData = {
	[key in Criteria]?: string;
};

export const getImageURL = (url: string, imageName: string): string => {
	return `https://${new URL(url).host}/images/v1/image/${imageName}`;
};

export const getImageMetaURL = (url: string, imageName: string): string => {
	return `https://${new URL(url).host}/images/v1/metadata/${imageName}`;
};

export const updateMetaData = async (
	request: Request,
	env: Env,
	imageName: string,
	criteria: Criteria,
	description: string,
) => {
	const original = await env.IMAGES_BUCKET.get(imageName);
	if (!original) return new Response('Original Image not found', { status: 400 });

	let metaData: ImageMetaData = {
		history: original.customMetadata?.history,
		materials: original.customMetadata?.materials,
		seismic: original.customMetadata?.seismic,
	};

	metaData[criteria] = description;

	const imageBucketPromise = env.IMAGES_BUCKET.put(imageName, await original.blob(), {
		customMetadata: metaData,
	});

	const cacheDeleteMetaPromise = caches.default.delete(getImageMetaURL(request.url, imageName));

	await Promise.allSettled([imageBucketPromise, cacheDeleteMetaPromise]);

	return new Response('Information generated', { status: 200 });
};

const service: Service = {
	path: '/images/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
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

				const fileResponses = await Promise.all(filePromises);

				let status;
				const responses = await Promise.all(
					fileResponses.map((response) => {
						if (response instanceof Response) {
							status = 400;
							return response.text().then((text) => ({ text, status: response.status }));
						}
						status = 200;
						return response;
					}),
				);

				return new Response(JSON.stringify(responses), { status });
			}
			case 'GET image': {
				const cacheResponse = await caches.default.match(request.url);
				if (cacheResponse) return cacheResponse;

				const imageName = args[1];
				const image = await env.IMAGES_BUCKET.get(imageName);

				if (!image) {
					return new Response('Image not found');
				}

				const headers = new Headers();
				image.writeHttpMetadata(headers);
				headers.set('etag', image.httpEtag);
				headers.set('Cache-Control', 'private, max-age=31536000'); //1 year caching

				const response = new Response(image.body, { status: 200, headers });

				ctx.waitUntil(caches.default.put(request.url, response.clone()));

				return response;
			}
			case 'DELETE image': {
				if (authContext instanceof Response) return authContext;

				const cacheKey = `${request.url}-${authContext.username}`;
				const cacheResponse = await caches.default.match(cacheKey);
				if (cacheResponse) return cacheResponse;

				const imageName = args[1];

				let response;
				if (imageName.includes(authContext.username)) {
					await env.IMAGES_BUCKET.delete(imageName);

					response = new Response(null, { status: 204 });
				} else {
					response = new Response('You do not have permission to delete this resource', { status: 403 });
				}

				ctx.waitUntil(caches.default.put(cacheKey, response.clone()));

				return response;
			}
			case 'GET metadata': {
				const cacheResponse = await caches.default.match(request.url);
				if (cacheResponse) return cacheResponse;

				const imageName = args[1];
				const image = await env.IMAGES_BUCKET.get(imageName);

				if (!image) {
					return new Response('Image not found');
				}

				const metaData: ImageMetaData = {
					materials: image.customMetadata?.materials,
					history: image.customMetadata?.history,
					seismic: image.customMetadata?.seismic,
				};

				const response = new Response(JSON.stringify(metaData), {
					status: 200,
					headers: { 'Cache-Control': 'private, max-age=1, s-maxage=31536000' },
				});

				ctx.waitUntil(caches.default.put(request.url, response.clone()));

				return response;
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
