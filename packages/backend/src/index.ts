import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Elysia } from "elysia";
import logixlysia from "logixlysia";
import { createAuthController } from "./controllers/authController";
import { createHAProxyController } from "./controllers/haproxyController";
import { createHealthController } from "./controllers/healthController";
import { createNodeController } from "./controllers/nodeController";
import { apiKeySupportPlugin } from "./lib/apiKeySupport";
import { auth, ensureDefaultAdminUser } from "./lib/auth";
import { env } from "./lib/env";
import { ensureDefaultNode } from "./services/nodeService";
import { ensureSshKeyPair } from "./services/sshService";

type BetterAuthSessionLookup = {
	user?: unknown;
} | null;

function getBearerToken(authorizationHeader: string | null) {
	if (!authorizationHeader) {
		return null;
	}

	const [scheme, value] = authorizationHeader.split(" ");
	if (scheme?.toLowerCase() !== "bearer" || !value) {
		return null;
	}

	return value;
}

const sessionProtectedPrefixes = ["/openapi", "/swagger", "/otel"];
const publicRoutePrefixes = ["/", "/health"];

function isSessionProtectedPath(pathname: string) {
	return sessionProtectedPrefixes.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

function isPublicRoute(pathname: string) {
	return publicRoutePrefixes.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

async function hasBetterAuthSession(request: Request) {
	const authApi = auth.api as {
		getSession: (args: {
			headers: Headers;
		}) => Promise<BetterAuthSessionLookup>;
	};

	const session = await authApi.getSession({
		headers: request.headers,
	});

	return Boolean(session?.user);
}

function isBetterAuthRoute(pathname: string) {
	return pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

// Initialize Elysia app with plugins
const corsOrigins = env.BETTER_AUTH_TRUSTED_ORIGINS.split(",")
	.map((origin) => origin.trim())
	.filter(Boolean);

const app = new Elysia()
	.use(
		logixlysia({
			config: {
				showStartupMessage: true,
				startupMessageFormat: "simple",
				timestamp: {
					translateTime: "yyyy-mm-dd HH:MM:ss.SSS",
				},
				logFilePath: "./logs/example.log",
				ip: true,
				customLogFormat:
					"{now} {level} {duration} {method} {pathname} {status} {message} {ip}",
			},
		}),
	)
	.use(
		cors({
			origin: corsOrigins,
			credentials: true,
		}),
	)
	.use(openapi())
	.use(apiKeySupportPlugin())
	.onBeforeHandle(async (ctx) => {
		const { request, set } = ctx;
		const requestPath = new URL(request.url).pathname;
		const keyFromHeader = request.headers.get("x-api-key");
		const keyFromBearer = getBearerToken(request.headers.get("authorization"));
		const resolvedKey = keyFromHeader ?? keyFromBearer;

		if (request.method === "OPTIONS") {
			set.status = 204;
			return;
		}

		if (isBetterAuthRoute(requestPath)) {
			return;
		}

		if (isPublicRoute(requestPath)) {
			return;
		}

		// These routes should rely on Better Auth session cookies, not API keys.
		if (
			requestPath === "/haproxy/stats/ui" ||
			isSessionProtectedPath(requestPath)
		) {
			const authenticated = await hasBetterAuthSession(request);
			if (!authenticated) {
				set.status = 401;
				return {
					success: false,
					error: "Authentication required",
				};
			}

			return;
		}

		const hasSession = await hasBetterAuthSession(request);
		if (hasSession) {
			return;
		}

		if (!resolvedKey) {
			set.status = 401;
			return {
				success: false,
				error: "Authentication required",
			};
		}

		if (resolvedKey !== env.API_KEY) {
			set.status = 403;
			return {
				success: false,
				error: "Invalid API key",
			};
		}
	})
	.use(
		opentelemetry({
			serviceName: "haproxy-manager-api",
			spanProcessor: new BatchSpanProcessor(
				new OTLPTraceExporter({
					url: env.OTEL_URL,
				}),
			),
		}),
	)
	.get("/otel", () => {
		return Response.redirect(new URL("/", env.OTEL_DASHBOARD_URL), 302);
	})
	.all("/api/auth", ({ request }) => auth.handler(request))
	.all("/api/auth/*", ({ request }) => auth.handler(request))
	.use(createAuthController())
	// Register controllers
	.use(createHealthController())
	.use(createNodeController())
	.use(createHAProxyController())
	.listen(3000);

void ensureDefaultAdminUser();
void ensureDefaultNode();
void ensureSshKeyPair();

export type App = typeof app;
