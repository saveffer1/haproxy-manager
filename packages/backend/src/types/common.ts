export type ApiResponse<T = unknown> = {
	success: boolean;
	data?: T;
	error?: string;
	message?: string;
};

export type PaginationMeta = {
	total: number;
	page: number;
	limit: number;
	pages: number;
};

export type PaginatedResponse<T = unknown> = ApiResponse<{
	items: T[];
	meta: PaginationMeta;
}>;

export type CreateNodeInput = {
	name: string;
	ipAddress: string;
	type?: "managed" | "monitored";
	logStrategy?: "docker" | "file" | "journald";
	logPath?: string;
	sshUser?: string;
};

export type UpdateNodeInput = Partial<CreateNodeInput>;

export type NodeOutput = {
	id: string;
	name: string;
	ipAddress: string;
	type: "managed" | "monitored";
	logStrategy: "docker" | "file" | "journald";
	logPath: string | null;
	sshUser: string;
	createdAt: Date;
};
