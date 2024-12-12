import { FRONTEND_URL, Service } from '..';
import { authenticateToken } from './auth_v1';

import Stripe from 'stripe';
import { sumItemsByName } from './webhooks_v1';

type OrderPayload = {
	amount: number;
};

type OrderResponse = {
	clientSecret: string;
};

type SessionStatusResponse = {
	status: string | null;
	customer_email: string | null;
	quantity: number | null;
	amount_total: number | null;
};

const service: Service = {
	path: '/tokens/v1/',

	fetch: async (request: Request, subPath: string, env: Env): Promise<Response | void> => {
		const authContext = await authenticateToken(request.headers, env);
		if (authContext instanceof Response) return authContext;

		const stripe = new Stripe(env.STRIPE_PRIVATE_KEY);

		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'POST create-checkout-session': {
				const payload = await request.json<OrderPayload>();
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
							adjustable_quantity: { enabled: true, minimum: 10, maximum: 999999 },
						},
					],
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

					const quantity = session.line_items ? await sumItemsByName(session.line_items, 'Token', stripe) : null;

					const response: SessionStatusResponse = {
						status: session.status,
						customer_email: session.customer_details?.email ?? null,
						amount_total: session.amount_total,
						quantity: quantity,
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
