// Generated by Wrangler by running `wrangler types`

interface Env {
	ACCOUNTS_KV: KVNamespace;
	UFORM_KV: KVNamespace;
	GROUNDING_SAM_KV: KVNamespace;
	JWT_SECRET: string;
	REPLICATE_API_TOKEN: string;
	STRIPE_PRIVATE_KEY: string;
	AI_GATEWAY_TOKEN: string;
	IMAGES_BUCKET: R2Bucket;
	GEOSJON_BUCKET: R2Bucket;
	DB: D1Database;
	EMAIL_BINDING: SendEmail;
	AI: Ai;
}
