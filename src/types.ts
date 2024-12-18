type AccountKV = {
	username: string;
	password: string;
	email: string;
	bio?: string;
};

type CacheKV = {
	processing: boolean;
	url?: string;
};

type TokensRow = {
	user_name: string;
	token_count: number;
};
