import { Service } from '..';
import { hash } from '../auth';
import { AIPipeLineKV } from '../types';
import { authenticateToken } from './auth_v1';
import { Criteria, getImageMetaURL, getImageURL, ImageMetaData, updateMetaData } from './images_v1';
import { updateTokenCount } from './tokens_v1';

type DetectionPayload = {
	imageName: string;
	criteria: Criteria;
};

export type GroundingSamInput = {
	image_url: string;
	labels: string[];
};

type ReplicatePayload = {
	input: GroundingSamInput;
	webhook: string;
	webhook_events_filter: string[];
};

type AiInput = {
	[key in Criteria]?: string;
};

export const PIPELINE_KEY_NAME = 'pipelineKey';

export const imageAnalyticsAI = async (env: Env, url: string, criteria: Criteria): Promise<string | Response> => {
	console.log(`LLM url: ${url}`);

	const image = await (await fetch(url)).arrayBuffer();

	const aiInput: AiInput = {
		materials:
			'List only the main building materials used in the construction of the building in the image. No filler words, just the materials',
		history: 'Provide a brief history of this building, including its construction date',
		seismic: "What's the seismic risk of this building",
	};

	const prompt = aiInput[criteria];

	if (!prompt) {
		console.log('Criteria not found');
		return new Response('Criteria not found', { status: 400 });
	}

	console.log(`LLM prompt: ${prompt}`);

	const result = await env.AI.run(
		'@cf/unum/uform-gen2-qwen-500m',
		{
			image: [...new Uint8Array(image)],
			prompt,
			max_tokens: 20,
		},
		{
			extraHeaders: {
				'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}`,
			},
			gateway: { id: 'webdev-hs24', collectLog: true },
		},
	);

	console.log(`LLM result: ${result.description}`);
	return result.description;
};

const service: Service = {
	path: '/ai/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);
		if (authContext instanceof Response) return authContext;

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'POST detection': {
				if (!(await updateTokenCount(env, authContext.username, -1))) {
					return new Response('Not enough tokens', { status: 402 });
				}

				const payload = await request.json<DetectionPayload>();

				const input: GroundingSamInput = {
					image_url: getImageURL(request.url, payload.imageName),
					labels: ['house facade'],
				};

				ctx.waitUntil(
					updateMetaData(request, env, payload.imageName, payload.criteria, 'Processing').then(
						async () => await caches.default.delete(getImageMetaURL(request.url, payload.imageName)),
					),
				);

				const pipeLineKey = await hash(JSON.stringify(input));
				try {
					const webhookUrl = new URL(`https://${new URL(request.url).host}/webhooks/v1/replicate`);
					webhookUrl.searchParams.set(PIPELINE_KEY_NAME, pipeLineKey);

					const replicateBody: ReplicatePayload = {
						input: input,
						webhook: webhookUrl.toString(),
						webhook_events_filter: ['output'],
					};

					const pipeLineStorage: AIPipeLineKV | null = await env.AI_PIPELINE_KV.get(pipeLineKey, 'json');
					if (pipeLineStorage) {
						if (pipeLineStorage.processing == true) {
							return new Response('Job still running', { status: 200 });
						}

						if (pipeLineStorage.croppedImageUrl) {
							console.log('Grounding-Sam cached');

							ctx.waitUntil(
								imageAnalyticsAI(env, pipeLineStorage.croppedImageUrl, pipeLineStorage.criteria).then(
									async (result) => {
										if (result instanceof Response) return result;

										await updateMetaData(
											request,
											env,
											pipeLineStorage.orgImageName,
											pipeLineStorage.criteria,
											result,
										).catch(async () => {
											await updateMetaData(
												request,
												env,
												payload.imageName,
												payload.criteria,
												'Error in image analytics ai',
											);
										});
									},
								),
							);

							return new Response('Job queued', { status: 200 });
						} else {
							console.log('Cached url not available');
						}
					}

					console.log('Grounding-Sam fetching');

					const cacheInput: AIPipeLineKV = {
						orgImageName: payload.imageName,
						criteria: payload.criteria,
						processing: true,
					};
					ctx.waitUntil(env.AI_PIPELINE_KV.put(pipeLineKey, JSON.stringify(cacheInput), { expirationTtl: 60 * 10 }));

					const replicate_model_owner = 'gerbernoah';
					const replicate_deployment_name = 'urban-ai-grounding-sam';
					const cloudflareAccountID = '5b90fdf2bc4e39874b024b2bc8cd5d13';
					const gatewayID = 'webdev-hs24';

					ctx.waitUntil(
						fetch(
							`https://gateway.ai.cloudflare.com/v1/${cloudflareAccountID}/${gatewayID}/replicate/deployments/${replicate_model_owner}/${replicate_deployment_name}/predictions`,
							{
								method: 'POST',
								body: JSON.stringify(replicateBody),
								headers: {
									Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
									'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}`,
									'Content-Type': 'application/json',
									'cf-aig-skip-cache': 'true',
								},
							},
						),
					);

					return new Response('Job queued', { status: 200 });
				} catch (e) {
					console.log(e);

					ctx.waitUntil(updateMetaData(request, env, payload.imageName, payload.criteria, 'Error in grounding-sam ai'));
					let pipeLineStorage: AIPipeLineKV | null = await env.AI_PIPELINE_KV.get(pipeLineKey, 'json');

					if (pipeLineStorage) {
						pipeLineStorage.processing = false;
						ctx.waitUntil(env.AI_PIPELINE_KV.put(pipeLineKey, JSON.stringify(pipeLineStorage)));
					}
				}
			}
		}
	},
};

export default service;
