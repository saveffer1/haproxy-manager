import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Elysia } from "elysia";
import logixlysia from "logixlysia";
import { env } from "./lib/env";
import { createHealthController } from "./controllers/healthController";
import { createNodeController } from "./controllers/nodeController";
import { createHAProxyController } from "./controllers/haproxyController";

// Initialize Elysia app with plugins
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
	.use(cors())
	.use(openapi())
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
	// Register controllers
	.use(createHealthController())
	.use(createNodeController())
	.use(createHAProxyController())
	.listen(3000);

console.log("🚀 HAProxy Manager API running on http://localhost:3000");

export type App = typeof app;
