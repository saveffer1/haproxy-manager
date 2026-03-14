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
};

export type NodeOutput = {
	id: string;
	name: string;
	ipAddress: string;
	type: "managed" | "monitored";
	logStrategy: "docker" | "file" | "journald";
	logPath?: string;
	sshUser: string;
	createdAt: string;
};

export type DashboardSummary = {
	health: HealthStatus | null;
	stats: HAProxyStats | null;
	nodes: NodeOutput[];
	error?: string;
};

type BetterAuthDefaultUserResponse = {
	success: boolean;
	data?: {
		username: string;
		email: string;
	};
	error?: string;
};

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

type TreatyResponse = {
	data: unknown;
	error: unknown;
	status: number;
};

function buildApiKeyHeaders() {
	const configuredApiKey = env.VITE_API_KEY.trim();
	if (!configuredApiKey) {
		throw new Error("Missing API key configuration (VITE_API_KEY/API_KEY)");
	}

	return {
		"x-api-key": configuredApiKey,
		Authorization: `Bearer ${configuredApiKey}`,
	};
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
		...buildApiKeyHeaders(),
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
	const apiKeyHeaders = buildApiKeyHeaders();

	const response = await fetch(`${env.VITE_BACKEND_URL}${path}`, {
		headers: {
			"Content-Type": "application/json",
			...apiKeyHeaders,
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
	const apiKeyHeaders = buildApiKeyHeaders();

	const response = await fetch(`${env.VITE_BACKEND_URL}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...apiKeyHeaders,
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

async function apiFetchText(path: string): Promise<string> {
	const apiKeyHeaders = buildApiKeyHeaders();

	const response = await fetch(`${env.VITE_BACKEND_URL}${path}`, {
		headers: {
			...apiKeyHeaders,
		},
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

export async function getBetterAuthDefaultIdentity(): Promise<BetterAuthDefaultIdentity> {
	try {
		const response = await requestTreaty<BetterAuthDefaultUserResponse>(
			api.auth["dev-default-user"].get(),
		);
		if (!response.success || !response.data) {
			return {
				username: "admin",
				email: "admin@local.dev",
			};
		}

		return response.data;
	} catch {
		return {
			username: "admin",
			email: "admin@local.dev",
		};
	}
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
	const [healthResult, statsResult, nodesResult] = await Promise.allSettled([
		requestTreaty<ApiEnvelope<HealthStatus>>(api.health.get()),
		requestTreaty<ApiEnvelope<HAProxyStats>>(api.haproxy.stats.get()),
		requestTreaty<ApiEnvelope<NodeOutput[]>>(api.api.nodes.get()),
	]);

	const health =
		healthResult.status === "fulfilled" && healthResult.value.success
			? (healthResult.value.data ?? null)
			: null;

	const stats =
		statsResult.status === "fulfilled" && statsResult.value.success
			? (statsResult.value.data ?? null)
			: null;

	const nodes =
		nodesResult.status === "fulfilled" && nodesResult.value.success
			? (nodesResult.value.data ?? [])
			: [];

	const hasError = !health || !stats;

	return {
		health,
		stats,
		nodes,
		error: hasError
			? "Some backend sections are unavailable. Showing partial data."
			: undefined,
	};
}

export async function getHAProxyStatsDashboardHtml() {
	return apiFetchText("/haproxy/stats/ui");
}
