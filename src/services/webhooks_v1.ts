import Stripe from 'stripe';
import { Service } from '..';
import { GroundingSamInput, imageAnalyticsAI, PIPELINE_KEY_NAME } from './ai_v1';
import Replicate, { validateWebhook } from 'replicate';
import { updateTokenCount } from './tokens_v1';
import { stripeSumItemsByName } from './payments_v1';
import { Criteria, saveMetaData } from './images_v1';
import { AIPipeLineKV } from '../types';

export type ReplicatePrediction<I> = {
	id: string;
	input: I;
	output: string;
	status: string;
	metrics: any;
};

var webhookVerificationKey: string;

const service: Service = {
	path: '/webhooks/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'POST stripe': {
				const event = await request.json<Stripe.Event>();
				const stripe = new Stripe(env.STRIPE_PRIVATE_KEY);

				switch (event.type) {
					case 'checkout.session.completed':
						const paymentIntent = event.data.object;

						if (!paymentIntent.id) {
							return new Response('Id missing', { status: 400 });
						}

						const line_items = await stripe.checkout.sessions.listLineItems(paymentIntent.id);

						if (!paymentIntent.metadata || !paymentIntent.metadata['username']) {
							return new Response('Username missing', { status: 400 });
						}

						const username = paymentIntent.metadata['username'];
						const quantity = await stripeSumItemsByName(line_items, 'Token', stripe);

						const success = await updateTokenCount(env, username, quantity);
						if (success) {
							return new Response(`Added ${quantity} tokens`, { status: 200 });
						} else {
							return new Response('An error occured while crediting tokens');
						}
					default:
						return;
				}
			}
			case 'POST replicate': {
				const replicate = new Replicate({ auth: env.REPLICATE_API_TOKEN });

				webhookVerificationKey ??= (await replicate.webhooks.default.secret.get()).key;
				const isValid = await validateWebhook(request.clone(), webhookVerificationKey);
				if (!isValid) return new Response('Webhook corrupted', { status: 401 });

				const prediction = await request.json<ReplicatePrediction<GroundingSamInput>>();

				const pipelineKey = new URL(request.url).searchParams.get(PIPELINE_KEY_NAME);

				console.log('Incoming pipeline key: ' + pipelineKey);
				if (!pipelineKey) {
					console.log('Pipeline key not found');
					return new Response('Pipeline key not found', { status: 400 });
				}

				let pipeLineStorage: AIPipeLineKV | null = await env.AI_PIPELINE_KV.get(pipelineKey, 'json');

				if (!pipeLineStorage) {
					console.log('No data for pipeline key');
					return new Response('No data for pipeline key', { status: 400 });
				}

				pipeLineStorage.processing = false;
				pipeLineStorage.croppedImageUrl = prediction.output;

				ctx.waitUntil(
					env.AI_PIPELINE_KV.put(pipelineKey, JSON.stringify(pipeLineStorage), {
						expirationTtl: 60 * 60 - 1,
					}),
				);

				ctx.waitUntil(
					imageAnalyticsAI(env, pipeLineStorage.croppedImageUrl, pipeLineStorage.criteria).then(async (result) => {
						if (result instanceof Response) return result;

						await saveMetaData(request, env, pipeLineStorage.orgImageName, pipeLineStorage.criteria, result);
					}),
				);

				return new Response('Result received', { status: 200 });
			}
		}
	},
};

export default service;
