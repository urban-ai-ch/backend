import * as services from './services';

export interface Service {
	path: string;
	fetch(request: Request, subPath: string, env: Env): Promise<Response | void>;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		try {
			const url = new URL(request.url);
			const servicePath = `/${url.pathname.split('/').slice(1, 3).join('/')}/`;
			const subPath = url.pathname.substring(servicePath.length);

			const foundService = Object.values(services).filter((service: Service) => service.path === servicePath)[0];

			if (foundService) {
				const serviceResponse = await foundService.fetch(request, subPath, env);

				if (serviceResponse) {
					serviceResponse.headers.set('Access-Control-Allow-Origin', '*');

					return serviceResponse;
				}
			}

			return new Response('Service not found', { status: 404 });
		} catch (err) {
			console.error(`Error on request ${request.url}`, err);
			return new Response('Internal Server Error', { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
