import { Criteria } from './services/images_v1';

export type AccountKV = {
	username: string;
	password: string;
	email: string;
	bio?: string;
};

export type GroundingSamKV = {
	processing: boolean;
	orgImageName: string;
	criteria: Criteria;
	croppedImageUrl?: string;
};

export type UformKV = {
	processing: boolean;
	orgImageName: string;
	criteria: Criteria;
	description?: string;
};

export type TokensRow = {
	user_name: string;
	token_count: number;
};
