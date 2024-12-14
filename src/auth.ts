const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(data: Uint8Array): string {
	return btoa(String.fromCharCode(...data))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function fromBase64Url(base64: string): Uint8Array {
	const binary = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
	return new Uint8Array([...binary].map((char) => char.charCodeAt(0)));
}

//expiration in seconds
export async function signJWT(payload: object, secret: string, expiresIn?: number): Promise<string> {
	const header = {
		alg: 'HS256',
		typ: 'JWT',
	};

	const now = Math.floor(Date.now() / 1000);
	const payloadWithExp = {
		payload,
		exp: expiresIn ? now + expiresIn : null,
	};

	const headerBase64 = toBase64Url(encoder.encode(JSON.stringify(header)));
	const payloadBase64 = toBase64Url(encoder.encode(JSON.stringify(payloadWithExp)));
	const toSign = `${headerBase64}.${payloadBase64}`;

	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
	]);
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(toSign));
	const signatureBase64 = toBase64Url(new Uint8Array(signature));

	return `${toSign}.${signatureBase64}`;
}

export async function verifyJWT<T>(token: string, secret: string): Promise<T | null> {
	const [headerBase64, payloadBase64, signatureBase64] = token.split('.');
	if (!headerBase64 || !payloadBase64 || !signatureBase64) {
		return null;
	}

	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'verify',
	]);
	const isValid = await crypto.subtle.verify(
		'HMAC',
		key,
		fromBase64Url(signatureBase64),
		encoder.encode(`${headerBase64}.${payloadBase64}`),
	);

	if (!isValid) {
		return null;
	}

	const payloadJson: { exp: number; payload: T } = JSON.parse(decoder.decode(fromBase64Url(payloadBase64)));

	// Check expiration
	const now = Math.floor(Date.now() / 1000);
	if (payloadJson.exp && payloadJson.exp < now) {
		return null; // Token has expired
	}

	return payloadJson.payload;
}

export async function hash(payload: string): Promise<string> {
	const encodedPayload = new TextEncoder().encode(payload);

	const digest = await crypto.subtle.digest(
		{
			name: 'SHA-256',
		},
		encodedPayload,
	);

	return new TextDecoder().decode(digest);
}

export async function createHmacSha256(secret: string, signedContent: string): Promise<string> {
	const encoder = new TextEncoder();
	const secretBuffer = encoder.encode(secret);
	const contentBuffer = encoder.encode(signedContent);

	const key = await crypto.subtle.importKey('raw', secretBuffer, { name: 'HMAC', hash: { name: 'SHA-256' } }, false, [
		'sign',
	]);

	const signatureBuffer = await crypto.subtle.sign('HMAC', key, contentBuffer);

	return btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
}
