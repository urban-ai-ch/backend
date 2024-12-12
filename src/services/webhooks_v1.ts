import Stripe from 'stripe';
import { Service } from '..';
import { authenticateToken } from './auth_v1';

const service: Service = {
	path: '/webhooks/v1/',

	fetch: async (request: Request, subPath: string, env: Env): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'GET stripe': {
				const event = await request.json<Stripe.Event>();
				const stripe = new Stripe(env.STRIPE_PRIVATE_KEY);

				const sumItemsByName = async (lineItems: Stripe.ApiList<Stripe.LineItem>, name: string): Promise<number> => {
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
								(await sumItemsByName(
									await stripe.checkout.sessions.listLineItems('session_id', {
										starting_after: lineItems.data[lineItems.data.length - 1].id,
									}),
									name,
								))
						: totalAmount;
				};

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
						const quantity = await sumItemsByName(paymentIntent.line_items, 'Token');

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
		}
	},
};

export default service;
