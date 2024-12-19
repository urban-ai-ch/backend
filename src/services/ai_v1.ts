import { Service } from '..';
import { hash } from '../auth';
import { GroundingSamKV, UformKV } from '../types';
import { authenticateToken } from './auth_v1';
import { Criteria, getImageMetaURL, getImageURL, updateMetaData } from './images_v1';
import { updateTokenCount } from './tokens_v1';

type DetectionPayload = {
	imageName: string;
	criteria: Criteria;
};

export type GroundingSamInput = {
	image_url: string;
	labels: string[];
};

export type UformInput = {
	image_url: string;
	prompt: string;
	max_tokens: number;
};

type ReplicatePayload<Input> = {
	input: Input;
	webhook: string;
	webhook_events_filter: string[];
};

type AiInput = {
	[key in Criteria]?: string;
};

const replicate_model_owner = 'gerbernoah';
const cloudflareAccountID = '5b90fdf2bc4e39874b024b2bc8cd5d13';
const gatewayID = 'urban-ai-gateway';

export const GROUNDING_SAM_KEY_NAME = 'groundingSamKey';
export const GROUNDING_SAM_ENDPOINT_NAME = 'grounding-dino';

export const UFORM_KEY_NAME = 'uformKey';
export const UFORM_ENDPOINT_NAME = 'uform';

const replicateWebhookURL = (serverURL: string, modelName: string) => {
	return new URL(`https://${new URL(serverURL).host}/webhooks/v1/replicate/${modelName}`);
};

export const imageAnalyticsAI = async (
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	croppedImageUrl: string,
	criteria: Criteria,
	orgImageName: string,
): Promise<Response> => {
	console.log(`Uform input image url: ${croppedImageUrl}`);

	const image = await (await fetch(croppedImageUrl)).arrayBuffer();

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

	console.log(`Uform prompt: ${prompt}`);

	const max_tokens = 20;

	return await env.AI.run(
		'@cf/unum/uform-gen2-qwen-500m',
		{
			image: [...new Uint8Array(image)],
			prompt,
			max_tokens,
		},
		{
			extraHeaders: {
				'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}`,
			},
			gateway: { id: gatewayID },
		},
	).then(
		async (result) => {
			console.log(`Cloudflare uform result: ${result.description}`);

			await updateMetaData(request, ctx, env, orgImageName, criteria, result.description);
			return new Response('Uform: Job queued');
		},
		async (e) => {
			console.error(`Error: ${e}`);
			console.log('Fallback: replicate uform ai');

			const replicateInput: UformInput = {
				image_url: croppedImageUrl,
				prompt,
				max_tokens,
			};
			const uformKVKey = await hash(JSON.stringify(replicateInput));

			console.log('Replicate uform: input hashed');

			try {
				const uformStorage: UformKV | null = await env.UFORM_KV.get(uformKVKey, 'json');

				console.log('Replicate uform: kv storage loaded');
				if (uformStorage) {
					if (uformStorage.processing == true) {
						console.log('Replicate uform: job still running');
						return new Response('Job still running', { status: 200 });
					}

					if (uformStorage.description) {
						console.log('Replicate uform: description from storage');

						return await updateMetaData(
							request,
							ctx,
							env,
							uformStorage.orgImageName,
							uformStorage.criteria,
							uformStorage.description,
						);
					} else {
						console.log('Replicate uform: stored description not available');
					}
				}

				console.log('Replicate uform: fetching');

				const webhookUrl = replicateWebhookURL(request.url, UFORM_ENDPOINT_NAME);
				webhookUrl.searchParams.set(UFORM_KEY_NAME, uformKVKey);

				const uformBody: ReplicatePayload<UformInput> = {
					input: replicateInput,
					webhook: webhookUrl.toString(),
					webhook_events_filter: ['output'],
				};

				const uformStorageInput: UformKV = {
					processing: true,
					orgImageName: orgImageName,
					criteria: criteria,
				};
				ctx.waitUntil(env.UFORM_KV.put(uformKVKey, JSON.stringify(uformStorageInput), { expirationTtl: 60 * 10 }));

				const replicate_deployment_name = 'urban-ai-uform-gen2';

				ctx.waitUntil(
					fetch(
						`https://gateway.ai.cloudflare.com/v1/${cloudflareAccountID}/${gatewayID}/replicate/deployments/${replicate_model_owner}/${replicate_deployment_name}/predictions`,
						{
							method: 'POST',
							body: JSON.stringify(uformBody),
							headers: {
								Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
								'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}`,
								'cf-aig-skip-cache': 'true',
							},
						},
					),
				);

				console.log('Replicate uform job queued');
				return new Response('Uform: Job queued', { status: 200 });
			} catch (e) {
				console.error(`Error in replicate uform ai. Error: ${e}`);

				ctx.waitUntil(updateMetaData(request, ctx, env, orgImageName, criteria, 'Error in replicate uform ai'));
				let groundingSamStorage: GroundingSamKV | null = await env.GROUNDING_SAM_KV.get(uformKVKey, 'json');

				if (groundingSamStorage) {
					groundingSamStorage.processing = false;
					ctx.waitUntil(env.GROUNDING_SAM_KV.put(uformKVKey, JSON.stringify(groundingSamStorage)));
				}
				return new Response('Error in replicate uform ai', { status: 500 });
			}
		},
	);
};

const groundingSam = async (
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	criteria: Criteria,
	orgImageName: string,
): Promise<Response> => {
	const input: GroundingSamInput = {
		image_url: getImageURL(request.url, orgImageName),
		labels: ['house facade'],
	};

	ctx.waitUntil(
		updateMetaData(request, ctx, env, orgImageName, criteria, 'Processing').then(
			async () => await caches.default.delete(getImageMetaURL(request.url, orgImageName)),
		),
	);

	const groundingSamKVKey = await hash(JSON.stringify(input));
	try {
		const webhookUrl = replicateWebhookURL(request.url, GROUNDING_SAM_ENDPOINT_NAME);
		webhookUrl.searchParams.set(GROUNDING_SAM_KEY_NAME, groundingSamKVKey);

		const groundingSamBody: ReplicatePayload<GroundingSamInput> = {
			input,
			webhook: webhookUrl.toString(),
			webhook_events_filter: ['output'],
		};

		const groundingSamStorage: GroundingSamKV | null = await env.GROUNDING_SAM_KV.get(groundingSamKVKey, 'json');
		if (groundingSamStorage) {
			if (groundingSamStorage.processing == true) {
				return new Response('Job still running', { status: 200 });
			}

			if (groundingSamStorage.croppedImageUrl) {
				console.log('Replicate grounding-sam: KV storage loaded');

				return await imageAnalyticsAI(
					request,
					env,
					ctx,
					groundingSamStorage.croppedImageUrl,
					groundingSamStorage.criteria,
					groundingSamStorage.orgImageName,
				);
			} else {
				console.log('Replicate grounding-sam: Stored url not available');
			}
		}

		console.log('Replicate grounding-sam: Fetching');

		const groundingSamStorageInput: GroundingSamKV = {
			orgImageName: orgImageName,
			criteria: criteria,
			processing: true,
		};
		ctx.waitUntil(
			env.GROUNDING_SAM_KV.put(groundingSamKVKey, JSON.stringify(groundingSamStorageInput), { expirationTtl: 60 * 10 }),
		);

		const replicate_deployment_name = 'urban-ai-grounding-sam';

		ctx.waitUntil(
			fetch(
				`https://gateway.ai.cloudflare.com/v1/${cloudflareAccountID}/${gatewayID}/replicate/deployments/${replicate_model_owner}/${replicate_deployment_name}/predictions`,
				{
					method: 'POST',
					body: JSON.stringify(groundingSamBody),
					headers: {
						Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
						'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}`,
						'cf-aig-skip-cache': 'true',
					},
				},
			),
		);

		return new Response('Grounding-sam: Job queued', { status: 200 });
	} catch (e) {
		console.error(`Error in replicate grounding-sam ai. Error: ${e}`);

		ctx.waitUntil(updateMetaData(request, ctx, env, orgImageName, criteria, 'Error in replicate grounding-sam ai'));
		let groundingSamStorage: GroundingSamKV | null = await env.GROUNDING_SAM_KV.get(groundingSamKVKey, 'json');

		if (groundingSamStorage) {
			groundingSamStorage.processing = false;
			ctx.waitUntil(env.GROUNDING_SAM_KV.put(groundingSamKVKey, JSON.stringify(groundingSamStorage)));
		}
		return new Response('Error in replicate grounding-sam ai', { status: 500 });
	}
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

				return await groundingSam(request, env, ctx, payload.criteria, payload.imageName);
			}
		}
	},
};

export default service;
