import Stripe from 'stripe';
import { Service } from '..';
import {
	GROUNDING_SAM_ENDPOINT_NAME,
	GROUNDING_SAM_KEY_NAME,
	GroundingSamInput,
	imageAnalyticsAI,
	UFORM_ENDPOINT_NAME,
	UformInput,
} from './ai_v1';
import Replicate, { validateWebhook } from 'replicate';
import { updateTokenCount } from './tokens_v1';
import { stripeSumItemsByName } from './payments_v1';
import { updateMetaData } from './images_v1';
import { GroundingSamKV, UformKV } from '../types';

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
		const args = subPath.split('/');
		switch (request.method + ' ' + args[0]) {
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

				switch (args[1]) {
					case GROUNDING_SAM_ENDPOINT_NAME: {
						const prediction = await request.json<ReplicatePrediction<GroundingSamInput>>();

						const groundingSamKVKey = new URL(request.url).searchParams.get(GROUNDING_SAM_KEY_NAME);

						if (!groundingSamKVKey) {
							console.log('Grounding-sam key not found');
							return new Response('Grounding-sam key not found', { status: 400 });
						}

						const groundingSamStorage: GroundingSamKV | null = await env.GROUNDING_SAM_KV.get(
							groundingSamKVKey,
							'json',
						);

						if (!groundingSamStorage) {
							console.log('No data for grounding-sam key');
							return new Response('No data for grounding-sam key', { status: 400 });
						}

						groundingSamStorage.processing = false;
						groundingSamStorage.croppedImageUrl = prediction.output;

						ctx.waitUntil(
							env.GROUNDING_SAM_KV.put(groundingSamKVKey, JSON.stringify(groundingSamStorage), {
								expirationTtl: 60 * 60 - 1,
							}),
						);

						return await imageAnalyticsAI(
							request,
							env,
							ctx,
							groundingSamStorage.croppedImageUrl,
							groundingSamStorage.criteria,
							groundingSamStorage.orgImageName,
						);
					}
					case UFORM_ENDPOINT_NAME: {
						const prediction = await request.json<ReplicatePrediction<UformInput>>();

						const uformKVKey = new URL(request.url).searchParams.get(GROUNDING_SAM_KEY_NAME);

						if (!uformKVKey) {
							console.log('Uform key not found');
							return new Response('Uform key not found', { status: 400 });
						}

						const uformStorage: UformKV | null = await env.UFORM_KV.get(uformKVKey, 'json');

						if (!uformStorage) {
							console.log('No data for uform key');
							return new Response('No data for uform key', { status: 400 });
						}

						uformStorage.processing = false;
						uformStorage.description = prediction.output;

						ctx.waitUntil(
							env.UFORM_KV.put(uformKVKey, JSON.stringify(uformStorage), {
								expirationTtl: 60 * 60 - 1,
							}),
						);

						return await updateMetaData(
							request,
							ctx,
							env,
							uformStorage.orgImageName,
							uformStorage.criteria,
							uformStorage.description,
						);
					}
				}
			}
		}
	},
};

export default service;
