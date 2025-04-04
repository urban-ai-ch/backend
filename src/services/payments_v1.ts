import { Service } from '..';
import { AccountKV } from '../types';
import { authenticateToken } from './auth_v1';

import Stripe from 'stripe';

type OrderResponse = {
	clientSecret: string;
};

type SessionStatusResponse = {
	status: string;
	quantity: number;
	amount_total: number;
	customer_email: string | null;
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
	path: '/payments/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);
		if (authContext instanceof Response) return authContext;

		const stripe = new Stripe(env.STRIPE_PRIVATE_KEY);

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'POST create-checkout-session': {
				const account: AccountKV | null = await env.ACCOUNTS_KV.get(authContext.username, 'json');

				if (!account) {
					return new Response('Account not found', { status: 400 });
				}

				const session = await stripe.checkout.sessions.create({
					ui_mode: 'embedded',
					customer_email: account.email,
					submit_type: 'pay',
					line_items: [
						{
							price_data: {
								currency: 'chf',
								unit_amount: 10,
								product_data: {
									name: 'Token',
									description: 'Tokens consumed by different website services',
								},
							},
							quantity: 10,
							adjustable_quantity: { enabled: true, minimum: 1, maximum: 999999 },
						},
					],
					payment_method_types: ['twint', 'card'],
					metadata: {
						username: authContext.username,
					},
					mode: 'payment',
					return_url: `${request.headers.get('Origin')}/return?session_id={CHECKOUT_SESSION_ID}`,
					automatic_tax: { enabled: true },
				});

				if (!session.client_secret) {
					return new Response('An error occured', { status: 400 });
				}

				const response: OrderResponse = { clientSecret: session.client_secret };

				return new Response(JSON.stringify(response), { status: 200 });
			}
			case 'GET session-status': {
				const url = new URL(request.url);
				try {
					const session = await stripe.checkout.sessions.retrieve(url.searchParams.get('session_id') ?? '');

					if (!session.status || !session.amount_total || !session.id) {
						return new Response('Fields missing', { status: 400 });
					}

					const line_items = await stripe.checkout.sessions.listLineItems(session.id);

					const quantity = await stripeSumItemsByName(line_items, 'Token', stripe);

					const response: SessionStatusResponse = {
						status: session.status,
						amount_total: session.amount_total,
						quantity: quantity,
						customer_email: session.customer_details?.email ?? null,
					};

					return new Response(JSON.stringify(response), { status: 200 });
				} catch {
					return new Response('Invalid session id', { status: 400 });
				}
			}
		}
	},
};

export default service;
