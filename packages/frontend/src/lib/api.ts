import type { App } from "@app/backend";
import { treaty } from "@elysiajs/eden";
import { env } from "./env";

type ApiEnvelope<T> = {
	success: boolean;
	data?: T;
	error?: string;
	message?: string;
};

export type HealthStatus = {
	status: "healthy" | "degraded" | "unhealthy";
	timestamp: string;
	checks: {
		database: boolean;
		redis: boolean;
		haproxy: boolean;
	};
};

export type HAProxyStats = {
	status: string;
	uptime: string;
	active_sessions: number;
	connections_rate: number;
	dataSource?: "socket" | "url" | "none";
	snapshot?: {
		collectedAt: string;
		totals: {
			activeSessions: number;
			connectionsRate: number;
			bytesIn: number;
			bytesOut: number;
			queueCurrent: number;
			queueMax: number;
			errors: number;
		};
		httpResponses: {
			xx2: number;
			xx3: number;
			xx4: number;
			xx5: number;
			other: number;
		};
		health: {
			up: number;
			down: number;
			other: number;
		};
		servers: Array<{
			proxy: string;
			server: string;
			status: string;
			activeSessions: number;
			connectionsRate: number;
			bytesIn: number;
			bytesOut: number;
			errors: number;
		}>;
	};
	warning?: string;
	nodeRuntime?: {
		nodeId: string;
		nodeName: string;
		nodeType: "managed" | "monitored";
		source: "manual" | "docker" | "remote" | "api";
		collectedAt: string;
		detailItems: Array<{
			label: string;
			value: string;
		}>;
		docker?: {
			containerId: string;
			containerName: string;
			image: string;
			status: string;
			startedAt?: string;
			createdAt?: string;
			networkMode?: string;
			networks: Array<{
				name: string;
				ipAddress?: string;
			}>;
			uptime?: string;
			note?: string;
		};
		note?: string;
	};
};

export type HAProxyStatsCapabilities = {
	supportsSocket: boolean;
	supportsUrl: boolean;
	availableViews: Array<"graph" | "classic">;
	defaultSource: "socket" | "url" | "none";
	notes: string[];
};

export type HAProxyStatsRequestedSource = "auto" | "socket" | "url";

export type NodeOutput = {
	id: string;
	name: string;
	ipAddress: string;
	isLocalService: boolean;
	type: "managed" | "monitored";
	source: "manual" | "docker" | "remote" | "api";
	logStrategy: "docker" | "file" | "journald";
	logPath?: string;
	haproxyStatsUrl?: string | null;
	haproxySocketPath?: string | null;
	haproxyApiUrl?: string | null;
	haproxyContainerRef?: string | null;
	haproxyConfigPath?: string | null;
	haproxyLogPath?: string | null;
	haproxyLogSource?: "container" | "forwarded";
	sshUser: string;
	sshPort: number;
	createdAt: string;
};

export type NodeConfigUpdateInput = {
	name: string;
	ipAddress: string;
	isLocalService: boolean;
	type: "managed" | "monitored";
	source: "manual" | "docker" | "remote" | "api";
	haproxyStatsUrl?: string;
	haproxySocketPath?: string;
	haproxyApiUrl?: string;
	haproxyContainerRef?: string;
	haproxyConfigPath?: string;
	haproxyLogPath?: string;
	haproxyLogSource: "container" | "forwarded";
	sshUser?: string;
	sshPort?: number;
};

export type CreateNodeInput = {
	name: string;
	ipAddress: string;
	isLocalService?: boolean;
	type?: "managed" | "monitored";
	source?: "manual" | "docker" | "remote" | "api";
	haproxyStatsUrl?: string;
	haproxySocketPath?: string;
	haproxyApiUrl?: string;
	haproxyContainerRef?: string;
	haproxyConfigPath?: string;
	haproxyLogPath?: string;
	haproxyLogSource?: "container" | "forwarded";
	sshUser?: string;
	sshPort?: number;
};

export type SshTestResult = {
	ok: boolean;
	message: string;
};

export type DashboardSummary = {
	health: HealthStatus | null;
	stats: HAProxyStats | null;
	nodes: NodeOutput[];
	error?: string;
};

export type HAProxyConfigFile = {
	path: string;
	size: number;
	updatedAt: string;
};

export type RemoteConfigMutationFeedback = {
	mode: "remote";
	action: "save" | "create" | "delete";
	sshTarget: string;
	container: string;
	path: string;
	validation: "passed";
	rollbackApplied: boolean;
	details: string[];
	validationOutput?: string;
};

export type HAProxyConfigMutationResult = {
	path: string;
	remoteFeedback?: RemoteConfigMutationFeedback;
};

export type HAProxyLogSource = "container" | "file";

export type HAProxyLogContainer = {
	id: string;
	name: string;
	image: string;
	status: string;
};

export type HAProxyLogReadResult = {
	source: HAProxyLogSource;
	target: string;
	resolvedFilePath?: string;
	lines: string[];
	fetchedAt: string;
};

type ThemeMode = "light" | "dark";

type BetterAuthResolveIdentityResponse = {
	success: boolean;
	data?: {
		username: string | null;
		email: string | null;
	};
	error?: string;
};

type BetterAuthSession = {
	session: {
		id: string;
		expiresAt: string;
		userId: string;
	};
	user: {
		id: string;
		email: string;
		name: string;
		username?: string | null;
	};
};

type BetterAuthCredential = {
	username: string;
	password: string;
};

type BetterAuthLoginResult = {
	ok: boolean;
	message: string;
};

type BetterAuthDefaultIdentity = {
	username: string;
	email: string;
};

type RequestPasswordResetInput = {
	identity: string;
	redirectTo: string;
};

type ResetPasswordInput = {
	token: string;
	newPassword: string;
};

type ChangePasswordInput = {
	currentPassword: string;
	newPassword: string;
	revokeOtherSessions?: boolean;
};

type TreatyResponse = {
	data: unknown;
	error: unknown;
	status: number;
};

function appendNodeId(path: string, nodeId?: string | null) {
	if (!nodeId) {
		return path;
	}

	const separator = path.includes("?") ? "&" : "?";
	const query = new URLSearchParams({ nodeId }).toString();
	return `${path}${separator}${query}`;
}

function requireNodeId(nodeId?: string | null) {
	const normalized = nodeId?.trim();
	if (!normalized) {
		throw new Error("Please select a node first.");
	}

	return normalized;
}

async function parseErrorMessage(response: Response) {
	try {
		const body = (await response.json()) as
			| { error?: string; message?: string }
			| undefined;
		if (body?.error) {
			return body.error;
		}
		if (body?.message) {
			return body.message;
		}
	} catch {
		// Ignore body parse errors and fall back to status text.
	}

	return response.statusText || "Request failed";
}

const api = treaty<App>(env.VITE_BACKEND_URL, {
	fetch: {
		credentials: "include",
	},
	headers: () => ({
		"Content-Type": "application/json",
	}),
});

function parseTreatyErrorMessage(error: unknown, status: number) {
	if (!error || typeof error !== "object") {
		return `Request failed (${status})`;
	}

	const maybeError = error as {
		value?: { error?: string; message?: string } | string;
	};

	if (typeof maybeError.value === "string") {
		return `${maybeError.value} (${status})`;
	}

	if (maybeError.value && typeof maybeError.value === "object") {
		if (maybeError.value.error) {
			return `${maybeError.value.error} (${status})`;
		}

		if (maybeError.value.message) {
			return `${maybeError.value.message} (${status})`;
		}
	}

	return `Request failed (${status})`;
}

async function requestTreaty<T>(request: Promise<TreatyResponse>): Promise<T> {
	const { data, error, status } = await request;

	if (error || data === null) {
		throw new Error(parseTreatyErrorMessage(error, status));
	}

	return data as T;
}

async function getJsonRaw<T>(path: string): Promise<T> {
	const response = await fetch(`${env.VITE_BACKEND_URL}${path}`, {
		headers: {
			"Content-Type": "application/json",
		},
		credentials: "include",
	});

	if (!response.ok) {
		const message = await parseErrorMessage(response);
		throw new Error(`${message} (${response.status})`);
	}

	return (await response.json()) as T;
}

async function postJsonRaw<T>(path: string, payload: unknown): Promise<T> {
	const response = await fetch(`${env.VITE_BACKEND_URL}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		credentials: "include",
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const message = await parseErrorMessage(response);
		throw new Error(`${message} (${response.status})`);
	}

	if (response.status === 204) {
		return {} as T;
	}

	return (await response.json()) as T;
}

async function putJsonRaw<T>(path: string, payload: unknown): Promise<T> {
	const response = await fetch(`${env.VITE_BACKEND_URL}${path}`, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
		},
		credentials: "include",
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const message = await parseErrorMessage(response);
		throw new Error(`${message} (${response.status})`);
	}

	if (response.status === 204) {
		return {} as T;
	}

	return (await response.json()) as T;
}

async function deleteJsonRaw<T>(path: string): Promise<T> {
	const response = await fetch(`${env.VITE_BACKEND_URL}${path}`, {
		method: "DELETE",
		headers: {
			"Content-Type": "application/json",
		},
		credentials: "include",
	});

	if (!response.ok) {
		const message = await parseErrorMessage(response);
		throw new Error(`${message} (${response.status})`);
	}

	if (response.status === 204) {
		return {} as T;
	}

	return (await response.json()) as T;
}

async function apiFetchText(path: string): Promise<string> {
	const response = await fetch(`${env.VITE_BACKEND_URL}${path}`, {
		credentials: "include",
	});

	if (!response.ok) {
		const message = await parseErrorMessage(response);
		throw new Error(`${message} (${response.status})`);
	}

	return response.text();
}

async function resolveIdentityToEmail(identity: string) {
	if (identity.includes("@")) {
		return identity;
	}

	try {
		const response = await requestTreaty<BetterAuthResolveIdentityResponse>(
			api.auth["resolve-identity"].get({
				query: {
					identity,
				},
			}),
		);

		if (!response.success || !response.data?.email) {
			throw new Error("Unable to resolve username");
		}

		return response.data.email;
	} catch {
		return `${identity}@local.dev`;
	}
}

export async function loginWithBetterAuth(
	credential: BetterAuthCredential,
): Promise<BetterAuthLoginResult> {
	try {
		const email = await resolveIdentityToEmail(credential.username.trim());

		await postJsonRaw("/api/auth/sign-in/email", {
			email,
			password: credential.password,
			rememberMe: true,
		});

		return {
			ok: true,
			message: "Authenticated",
		};
	} catch (error) {
		return {
			ok: false,
			message:
				error instanceof Error
					? error.message
					: "Unable to sign in via Better Auth. Check backend configuration.",
		};
	}
}

export async function getBetterAuthSession(): Promise<BetterAuthSession | null> {
	try {
		return await getJsonRaw<BetterAuthSession | null>("/api/auth/get-session");
	} catch {
		return null;
	}
}

export async function signOutBetterAuth() {
	await postJsonRaw("/api/auth/sign-out", {});
}

export async function requestPasswordReset(input: RequestPasswordResetInput) {
	const email = await resolveIdentityToEmail(input.identity.trim());
	await postJsonRaw("/api/auth/request-password-reset", {
		email,
		redirectTo: input.redirectTo,
	});
}

export async function resetPassword(input: ResetPasswordInput) {
	await postJsonRaw("/api/auth/reset-password", {
		token: input.token,
		newPassword: input.newPassword,
	});
}

export async function changeBetterAuthPassword(input: ChangePasswordInput) {
	await postJsonRaw("/api/auth/change-password", {
		currentPassword: input.currentPassword,
		newPassword: input.newPassword,
		revokeOtherSessions: input.revokeOtherSessions ?? false,
	});
}

export async function getBetterAuthDefaultIdentity(): Promise<BetterAuthDefaultIdentity> {
	// This endpoint is no longer supported. Return an empty identity to avoid
	// exposing any default credentials.
	return { username: "", email: "" };
}

export async function getDashboardSummary(
	nodeId?: string | null,
	options?: {
		includeStats?: boolean;
		statsSource?: HAProxyStatsRequestedSource;
	},
): Promise<DashboardSummary> {
	const includeStats = options?.includeStats ?? false;
	const statsSource = options?.statsSource ?? "auto";
	const scopedNodeId = nodeId?.trim() || null;
	const shouldFetchStats = includeStats && Boolean(scopedNodeId);

	const [healthResult, statsResult, nodesResult] = await Promise.allSettled([
		requestTreaty<ApiEnvelope<HealthStatus>>(api.health.get()),
		shouldFetchStats
			? getJsonRaw<ApiEnvelope<HAProxyStats>>(
					`${appendNodeId("/haproxy/stats", scopedNodeId)}&source=${statsSource}`,
				)
			: Promise.resolve({ success: true, data: null } as ApiEnvelope<null>),
		requestTreaty<ApiEnvelope<NodeOutput[]>>(api.api.nodes.get()),
	]);

	const health =
		healthResult.status === "fulfilled" && healthResult.value.success
			? (healthResult.value.data ?? null)
			: null;

	const stats =
		shouldFetchStats &&
		statsResult.status === "fulfilled" &&
		statsResult.value.success
			? (statsResult.value.data ?? null)
			: null;

	const nodes =
		nodesResult.status === "fulfilled" && nodesResult.value.success
			? (nodesResult.value.data ?? [])
			: [];

	const hasError = !health || (shouldFetchStats && !stats);

	return {
		health,
		stats,
		nodes,
		error: hasError
			? "Some backend sections are unavailable. Showing partial data."
			: undefined,
	};
}

export async function getHAProxyStatsDashboardHtml(
	theme: ThemeMode,
	nodeId: string,
) {
	const scopedNodeId = requireNodeId(nodeId);
	const query = new URLSearchParams({ theme });
	query.set("nodeId", scopedNodeId);

	return apiFetchText(`/haproxy/stats/ui?${query.toString()}`);
}

export async function getHAProxyStatsCapabilities(
	nodeId: string,
): Promise<HAProxyStatsCapabilities> {
	const scopedNodeId = requireNodeId(nodeId);
	const response = await getJsonRaw<ApiEnvelope<HAProxyStatsCapabilities>>(
		appendNodeId("/haproxy/stats/capabilities", scopedNodeId),
	);

	if (!response.success || !response.data) {
		throw new Error(
			response.error ?? "Failed to fetch HAProxy stats capabilities",
		);
	}

	return response.data;
}

export async function getHAProxyStatsSnapshot(input: {
	nodeId: string;
	source?: HAProxyStatsRequestedSource;
}): Promise<HAProxyStats> {
	const scopedNodeId = requireNodeId(input.nodeId);
	const query = new URLSearchParams({
		nodeId: scopedNodeId,
		source: input.source ?? "auto",
	});

	const response = await getJsonRaw<ApiEnvelope<HAProxyStats>>(
		`/haproxy/stats/snapshot?${query.toString()}`,
	);

	if (!response.success || !response.data) {
		throw new Error(response.error ?? "Failed to fetch HAProxy stats snapshot");
	}

	return response.data;
}

export async function listHAProxyConfigFiles(
	nodeId: string,
	options?: {
		forceRefresh?: boolean;
	},
): Promise<HAProxyConfigFile[]> {
	const scopedNodeId = requireNodeId(nodeId);
	const query = new URLSearchParams();
	query.set("nodeId", scopedNodeId);
	if (options?.forceRefresh) {
		query.set("forceRefresh", "true");
	}

	const response = await getJsonRaw<ApiEnvelope<HAProxyConfigFile[]>>(
		`/haproxy/config-files${query.toString() ? `?${query.toString()}` : ""}`,
	);

	if (!response.success) {
		throw new Error(response.error ?? "Failed to list HAProxy config files");
	}

	return response.data ?? [];
}

export async function getHAProxyConfigFileContent(
	filePath: string,
	nodeId: string,
	options?: {
		forceRefresh?: boolean;
	},
): Promise<string> {
	const scopedNodeId = requireNodeId(nodeId);
	const query = new URLSearchParams({ path: filePath });
	query.set("nodeId", scopedNodeId);
	if (options?.forceRefresh) {
		query.set("forceRefresh", "true");
	}
	const response = await getJsonRaw<
		ApiEnvelope<{ path: string; content: string }>
	>(`/haproxy/config-files/content?${query.toString()}`);

	if (!response.success || !response.data) {
		throw new Error(response.error ?? "Failed to load HAProxy config file");
	}

	return response.data.content;
}

export async function createHAProxyConfigFile(
	filePath: string,
	content = "",
	reload = true,
	nodeId: string,
) {
	const scopedNodeId = requireNodeId(nodeId);
	const response = await postJsonRaw<ApiEnvelope<HAProxyConfigMutationResult>>(
		appendNodeId("/haproxy/config-files", scopedNodeId),
		{
			path: filePath,
			content,
			reload,
		},
	);

	if (!response.success) {
		throw new Error(response.error ?? "Failed to create HAProxy config file");
	}

	return response;
}

export async function saveHAProxyConfigFile(
	filePath: string,
	content: string,
	reload = true,
	nodeId: string,
) {
	const scopedNodeId = requireNodeId(nodeId);
	const response = await putJsonRaw<ApiEnvelope<HAProxyConfigMutationResult>>(
		appendNodeId("/haproxy/config-files/content", scopedNodeId),
		{
			path: filePath,
			content,
			reload,
		},
	);

	if (!response.success) {
		throw new Error(response.error ?? "Failed to save HAProxy config file");
	}

	return response;
}

export async function deleteHAProxyConfigFile(
	filePath: string,
	reload = true,
	nodeId: string,
) {
	const scopedNodeId = requireNodeId(nodeId);
	const query = new URLSearchParams({
		path: filePath,
		reload: String(reload),
	});
	query.set("nodeId", scopedNodeId);
	const response = await deleteJsonRaw<
		ApiEnvelope<HAProxyConfigMutationResult>
	>(`/haproxy/config-files?${query.toString()}`);

	if (!response.success) {
		throw new Error(response.error ?? "Failed to delete HAProxy config file");
	}

	return response;
}

export async function reloadHAProxyConfig(nodeId: string) {
	const scopedNodeId = requireNodeId(nodeId);
	const response = await postJsonRaw<ApiEnvelope<unknown>>(
		appendNodeId("/haproxy/reload", scopedNodeId),
		{},
	);
	if (!response.success) {
		throw new Error(response.error ?? "Failed to reload HAProxy configuration");
	}

	return response;
}

export async function listHAProxyLogContainers(
	nodeId: string,
): Promise<HAProxyLogContainer[]> {
	const scopedNodeId = requireNodeId(nodeId);
	const response = await getJsonRaw<ApiEnvelope<HAProxyLogContainer[]>>(
		appendNodeId("/haproxy/logs/containers", scopedNodeId),
	);

	if (!response.success) {
		throw new Error(response.error ?? "Failed to list log containers");
	}

	return response.data ?? [];
}

export async function listHAProxyLogFiles(
	nodeId: string,
	path?: string,
): Promise<string[]> {
	const scopedNodeId = requireNodeId(nodeId);
	const query = new URLSearchParams({ nodeId: scopedNodeId });

	if (path?.trim()) {
		query.set("path", path.trim());
	}

	const response = await getJsonRaw<ApiEnvelope<string[]>>(
		`/haproxy/logs/files?${query.toString()}`,
	);

	if (!response.success) {
		throw new Error(response.error ?? "Failed to list selectable log files");
	}

	return response.data ?? [];
}

export async function readHAProxyLogs(input: {
	nodeId: string;
	source: HAProxyLogSource;
	filePath?: string;
	containerRef?: string;
	lines?: number;
}): Promise<HAProxyLogReadResult> {
	const scopedNodeId = requireNodeId(input.nodeId);
	const query = new URLSearchParams({
		nodeId: scopedNodeId,
		source: input.source,
	});

	if (typeof input.lines === "number" && Number.isFinite(input.lines)) {
		query.set("lines", String(Math.trunc(input.lines)));
	}

	if (input.filePath?.trim()) {
		query.set("filePath", input.filePath.trim());
	}

	if (input.containerRef?.trim()) {
		query.set("containerRef", input.containerRef.trim());
	}

	const response = await getJsonRaw<ApiEnvelope<HAProxyLogReadResult>>(
		`/haproxy/logs?${query.toString()}`,
	);

	if (!response.success || !response.data) {
		throw new Error(response.error ?? "Failed to read HAProxy logs");
	}

	return response.data;
}

export async function updateNodeConfiguration(
	nodeId: string,
	input: NodeConfigUpdateInput,
) {
	const response = await putJsonRaw<ApiEnvelope<NodeOutput>>(
		`/api/nodes/${nodeId}`,
		{
			name: input.name,
			ipAddress: input.ipAddress,
			isLocalService: input.isLocalService,
			type: input.type,
			source: input.source,
			haproxyStatsUrl: input.haproxyStatsUrl,
			haproxySocketPath: input.haproxySocketPath,
			haproxyApiUrl: input.haproxyApiUrl,
			haproxyContainerRef: input.haproxyContainerRef,
			haproxyConfigPath: input.haproxyConfigPath,
			haproxyLogPath: input.haproxyLogPath,
			haproxyLogSource: input.haproxyLogSource,
			sshUser: input.sshUser,
			sshPort: input.sshPort,
		},
	);

	if (!response.success || !response.data) {
		throw new Error(response.error ?? "Failed to update node configuration");
	}

	return response.data;
}

export async function createNode(input: CreateNodeInput) {
	const response = await postJsonRaw<ApiEnvelope<NodeOutput>>(
		"/api/nodes",
		input,
	);

	if (!response.success || !response.data) {
		throw new Error(response.error ?? "Failed to create node");
	}

	return response.data;
}

export async function deleteNode(nodeId: string) {
	const response = await deleteJsonRaw<ApiEnvelope<unknown>>(
		`/api/nodes/${nodeId}`,
	);

	if (!response.success) {
		throw new Error(response.error ?? "Failed to delete node");
	}
}

export async function getSshPublicKey(): Promise<string> {
	const response = await getJsonRaw<ApiEnvelope<{ publicKey: string }>>(
		"/api/nodes/ssh/public-key",
	);

	if (!response.success || !response.data?.publicKey) {
		throw new Error(response.error ?? "Failed to load SSH public key");
	}

	return response.data.publicKey;
}

export async function testSshConnection(input: {
	ipAddress: string;
	sshUser?: string;
	sshPort?: number;
}): Promise<SshTestResult> {
	const response = await postJsonRaw<ApiEnvelope<SshTestResult>>(
		"/api/nodes/ssh/test",
		input,
	);

	if (!response.success || !response.data) {
		throw new Error(response.error ?? "Failed to test SSH connection");
	}

	return response.data;
}
