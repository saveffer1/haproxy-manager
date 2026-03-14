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
	.onBeforeHandle((ctx) => {
		const { request, set } = ctx;
		const requestPath = new URL(request.url).pathname;
		const keyFromHeader = request.headers.get("x-api-key");
		const keyFromBearer = getBearerToken(request.headers.get("authorization"));
		const resolvedKey = keyFromHeader ?? keyFromBearer;

		if (request.method === "OPTIONS") {
			set.status = 204;
			return;
		}

		// HAProxy stats UI is protected by Better Auth session in its controller.
		if (requestPath === "/haproxy/stats/ui") {
			return;
		}

		if (!resolvedKey) {
			set.status = 401;
			return {
				success: false,
				error: "Missing API key. Send x-api-key or Authorization: Bearer <key>",
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
	.all("/api/auth", ({ request }) => auth.handler(request))
	.all("/api/auth/*", ({ request }) => auth.handler(request))
	.use(createAuthController())
	// Register controllers
	.use(createHealthController())
	.use(createNodeController())
	.use(createHAProxyController())
	.listen(3000);

void ensureDefaultAdminUser();

export type App = typeof app;
