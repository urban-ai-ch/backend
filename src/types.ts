import { Criteria } from './services/images_v1';

export type AccountKV = {
	username: string;
	password: string;
	email: string;
	bio?: string;
};

export type AIPipeLineKV = {
	processing: boolean;
	criteria: Criteria;
	orgImageName: string;
	croppedImageUrl?: string;
};

export type TokensRow = {
	user_name: string;
	token_count: number;
};
