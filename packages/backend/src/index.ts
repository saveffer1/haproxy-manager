import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Elysia } from "elysia";
import logixlysia from "logixlysia";
import { env } from "./lib/env";

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
	.get("/", () => ({ message: "HAProxy Manager API" }))
	.get("/haproxy/stats", () => {
		return {
			status: "online",
			uptime: "2h 45m",
			active_sessions: 120,
		};
	})
	.listen(3000);

export type App = typeof app;
