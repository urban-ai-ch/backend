// Generated by Wrangler by running `wrangler types`

interface Env {
	ACCOUNTS_KV: KVNamespace;
	JWT_SECRET: string;
	IMAGES_BUCKET: R2Bucket;
	GEOSJON_BUCKET: R2Bucket;
	EMAIL_BINDING: SendEmail;
}
