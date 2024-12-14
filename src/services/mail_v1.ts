import { EmailMessage } from 'cloudflare:email';
import { Service } from '..';
import { createMimeMessage } from 'mimetext';

type MailPayload = {
	subject: string;
	message: string;
};

const service: Service = {
	path: '/mail/v1/',

	fetch: async (request: Request, env: Env, ctx: ExecutionContext, subPath: string): Promise<Response | void> => {
		if (request.method !== 'POST') return;

		let recepients: string[] = [];

		switch (subPath.split('/')[0]) {
			case 'broadcast':
				recepients = ['noahgerber100@gmail.com', 'saimaneesh14@gmail.com', 'ehomburg@ethz.ch'];
				break;
			case 'noah':
				recepients = ['noahgerber100@gmail.com'];
				break;
			case 'sai':
				recepients = ['saimaneesh14@gmail.com'];
				break;
			case 'eren':
				recepients = ['ehomburg@ethz.ch'];
				break;
			default:
				return;
		}

		const payload = await request.json<MailPayload>();

		const msg = createMimeMessage();
		msg.setSender({ name: 'Backend', addr: 'backend@urban-ai.ch' });
		msg.setRecipients(recepients);
		msg.setSubject(payload.subject);
		msg.addMessage({ contentType: 'text/plain', data: payload.message });

		const mailPromises = recepients.map(async (recepient) => {
			var message = new EmailMessage('backend@urban-ai.ch', `${recepient}`, msg.asRaw());

			return env.EMAIL_BINDING.send(message).then(
				() => `Mail to ${recepient} sent`,
				(e) => `Mail to ${recepient} failed: ${e}`,
			);
		});

		return Promise.all(mailPromises).then(
			(results) => new Response(JSON.stringify(results), { status: 201 }),
			() => new Response('Internal server error', { status: 500 }),
		);
	},
};

export default service;
