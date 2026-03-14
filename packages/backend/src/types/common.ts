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
	isLocalService?: boolean;
	type?: "managed" | "monitored";
	source?: "manual" | "docker" | "remote" | "api";
	logStrategy?: "docker" | "file" | "journald";
	logPath?: string;
	haproxyStatsUrl?: string;
	haproxyApiUrl?: string;
	haproxyContainerRef?: string;
	haproxyConfigPath?: string;
	haproxyLogPath?: string;
	haproxyLogSource?: "container" | "forwarded";
	sshUser?: string;
	sshPort?: number;
};

export type UpdateNodeInput = Partial<CreateNodeInput>;

export type NodeOutput = {
	id: string;
	name: string;
	ipAddress: string;
	isLocalService: boolean;
	type: "managed" | "monitored";
	source: "manual" | "docker" | "remote" | "api";
	logStrategy: "docker" | "file" | "journald";
	logPath: string | null;
	haproxyStatsUrl: string | null;
	haproxyApiUrl: string | null;
	haproxyContainerRef: string | null;
	haproxyConfigPath: string | null;
	haproxyLogPath: string | null;
	haproxyLogSource: "container" | "forwarded";
	sshUser: string;
	sshPort: number;
	createdAt: Date;
};
