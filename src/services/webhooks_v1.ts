import Stripe from 'stripe';
import { Service } from '..';
import { GroundingSamInput } from './ai_v1';
import { FileOutput } from 'replicate';

type ReplicatePrediction<I> = {
	id: string;
	input: I;
	output: string;
	status: string;
	metrics: any;
};

export const stripeSumItemsByName = async (
	lineItems: Stripe.ApiList<Stripe.LineItem>,
	name: string,
	stripe: Stripe,
): Promise<number> => {
	let totalAmount = 0;

	for (const item of lineItems.data) {
		if (!item.price) continue;

		let product = item.price.product;
		if (typeof product === 'string') product = await stripe.products.retrieve(product);
		if (product.deleted) continue;

		totalAmount += product.name === name ? (item.quantity ?? 0) : 0;
	}

	return lineItems.has_more
		? totalAmount +
				(await stripeSumItemsByName(
					await stripe.checkout.sessions.listLineItems('session_id', {
						starting_after: lineItems.data[lineItems.data.length - 1].id,
					}),
					name,
					stripe,
				))
		: totalAmount;
};

const service: Service = {
	path: '/webhooks/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'GET stripe': {
				const event = await request.json<Stripe.Event>();
				const stripe = new Stripe(env.STRIPE_PRIVATE_KEY);

				switch (event.type) {
					case 'checkout.session.completed':
						const paymentIntent = event.data.object;

						if (!paymentIntent.line_items) {
							return new Response('Items missing', { status: 400 });
						}

						if (!paymentIntent.metadata || !paymentIntent.metadata['username']) {
							return new Response('Username missing', { status: 400 });
						}

						const username = paymentIntent.metadata['username'];
						const quantity = await stripeSumItemsByName(paymentIntent.line_items, 'Token', stripe);

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

						const updatedTokens = quantity + (tokensResult?.token_count ?? 0);
						await writeStmt.bind(username, updatedTokens).run<TokensRow>();

						return new Response(`Added ${quantity} tokens`, { status: 200 });
					default:
						console.log(`Unhandled event type ${event.type}`);
				}
			}
			case 'POST replicate': {
				const prediction = await request.json<ReplicatePrediction<GroundingSamInput>>();
				const url = prediction.output;

				console.log(url);

				const image = await (await fetch(url)).arrayBuffer();

				const input = {
					image: [...new Uint8Array(image)],
					prompt: 'Give me the material of this image',
					max_tokens: 20,
				};
				const aiPromise = env.AI.run('@cf/unum/uform-gen2-qwen-500m', input).then((response) =>
					console.log(response.description),
				);

				ctx.waitUntil(aiPromise);

				return new Response('Result received', { status: 200 });
			}
		}
	},
};

export default service;
