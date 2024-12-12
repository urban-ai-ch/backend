import { FRONTEND_URL, Service } from '..';
import { authenticateToken } from './auth_v1';

import Stripe from 'stripe';

type OrderPayload = {
	amount: number;
};

type OrderResponse = {
	clientSecret: string;
};

type SessionStatusResponse = {
	status: string;
	customer_email: string;
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
								product_data: {
									name: 'Token',
									description: 'Tokens consumed by different website services',
								},
							},
							quantity: 10,
							adjustable_quantity: { enabled: true, minimum: 10 },
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

					if (!session.status) {
						return new Response('Session status not found', { status: 400 });
					}

					if (!session.customer_details?.email) {
						return new Response('Session email not found', { status: 400 });
					}

					const response: SessionStatusResponse = {
						status: session.status,
						customer_email: session.customer_details.email,
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
