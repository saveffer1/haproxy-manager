import { bool, cleanEnv, str, url } from "envalid";

export const env = cleanEnv(process.env, {
	NODE_ENV: str({
		default: "development",
		choices: ["development", "test", "production", "staging"],
	}),
	API_KEY: str({ default: "your-default-api-key" }),
	HAPROXY_STATS_URL: str({ default: "http://localhost:8404/stats" }),
	HAPROXY_STATS_USERNAME: str({ default: "admin" }),
	HAPROXY_STATS_PASSWORD: str({ default: "admin12345" }),
	BETTER_AUTH_URL: str({ default: "http://localhost:3000" }),
	BETTER_AUTH_TRUSTED_ORIGINS: str({
		default:
			"http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
	}),
	DEFAULT_ADMIN_USERNAME: str({ default: "admin" }),
	DEFAULT_ADMIN_EMAIL: str({ default: "admin@local.dev" }),
	DEFAULT_ADMIN_PASSWORD: str({ default: "admin12345" }),
	DATABASE_URL: url({
		default: "postgres://postgres:password@localhost:5432/haproxy_db",
	}),
	OTEL_URL: url({ default: "http://localhost:4318/v1/traces" }),
	REDIS_URL: url({ default: "redis://localhost:6379" }),
	HAPROXY_SOCKET_ENABLED: bool({ default: process.platform !== "win32" }),
	HAPROXY_SOCKET_PATH: str({ default: "/var/run/haproxy.sock" }),
	HAPROXY_CONFIG_DIR: str({ default: "./haproxy/conf.d" }),
	HAPROXY_RELOAD_COMMAND: str({
		default: process.platform === "win32"
			? "docker compose restart haproxy"
			: "docker compose restart haproxy",
	}),
	HAPROXY_VALIDATE_COMMAND: str({
		default:
			"docker compose exec -T haproxy haproxy -f /usr/local/etc/haproxy/conf.d -c",
	}),
});
