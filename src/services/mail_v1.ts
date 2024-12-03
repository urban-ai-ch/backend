import { EmailMessage } from 'cloudflare:email';
import { Service } from '..';
import { createMimeMessage } from 'mimetext';

type MailPayload = {
	subject: string;
	message: string;
};

const recepients = ['noahgerber100@gmail.com', 'saimaneesh14@gmail.com'];

const service: Service = {
	path: '/mail/v1/',

	fetch: async (request: Request, subPath: string, env: Env): Promise<Response | void> => {
		switch (request.method + ' ' + subPath.split('/')[0]) {
			case 'POST broadcast': {
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
						(e) => `Mail to ${recepient} failed: ${e}`
					);
				});

				return Promise.all(mailPromises).then(
					(results) => new Response(JSON.stringify(results), { status: 201 }),
					() => new Response('Internal server error', { status: 500 })
				);
			}
		}
	},
};

export default service;
