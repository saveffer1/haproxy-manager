import { bool, cleanEnv, str, url } from "envalid";

export const env = cleanEnv(process.env, {
	NODE_ENV: str({
		default: "development",
		choices: ["development", "test", "production", "staging"],
	}),
	API_KEY: str({ default: "haproxy-manager-local-api-key" }),
	BETTER_AUTH_SECRET: str({
		default: "replace-me-in-production-please-change-this-secret",
	}),
	DEFAULT_NODE_NAME: str({ default: "local-haproxy-node" }),
	DEFAULT_NODE_IP_ADDRESS: str({ default: "127.0.0.1" }),
	DEFAULT_NODE_IS_LOCAL_SERVICE: bool({ default: true }),
	DEFAULT_NODE_TYPE: str({ default: "managed" }),
	DEFAULT_NODE_LOG_STRATEGY: str({ default: "docker" }),
	DEFAULT_NODE_LOG_PATH: str({ default: "" }),
	DEFAULT_NODE_SSH_USER: str({ default: "root" }),
	DEFAULT_NODE_SSH_PORT: str({ default: "22" }),
	DEFAULT_NODE_HAPROXY_STATS_URL: str({ default: "" }),
	DEFAULT_NODE_HAPROXY_SOCKET_PATH: str({ default: "" }),
	DEFAULT_NODE_HAPROXY_API_URL: str({ default: "" }),
	DEFAULT_NODE_HAPROXY_CONFIG_PATH: str({ default: "" }),
	DEFAULT_NODE_HAPROXY_LOG_PATH: str({ default: "" }),
	HAPROXY_STATS_URL: str({ default: "http://localhost:8404/stats" }),
	HAPROXY_STATS_USERNAME: str({ default: "" }),
	HAPROXY_STATS_PASSWORD: str({ default: "" }),
	BETTER_AUTH_URL: str({ default: "https://localhost" }),
	BETTER_AUTH_TRUSTED_ORIGINS: str({
		default:
			"https://localhost,https://127.0.0.1,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:4320,http://127.0.0.1:4320",
	}),
	DEFAULT_ADMIN_USERNAME: str({ default: "admin" }),
	DEFAULT_ADMIN_EMAIL: str({ default: "admin@local.dev" }),
	DEFAULT_ADMIN_PASSWORD: str({ default: "admin12345" }),
	DATABASE_URL: url({
		default: "postgres://postgres:changeme@localhost:5432/haproxy_db",
	}),
	OTEL_URL: url({ default: "http://localhost:4318/v1/traces" }),
	OTEL_DASHBOARD_URL: url({ default: "http://localhost:4319" }),
	REDIS_URL: url({ default: "redis://localhost:6379" }),
	HAPROXY_SOCKET_ENABLED: bool({ default: process.platform !== "win32" }),
	HAPROXY_SOCKET_PATH: str({ default: "127.0.0.1:16669" }),
	HAPROXY_CONFIG_DIR: str({ default: "./haproxy/conf.d" }),
	HAPROXY_RELOAD_COMMAND: str({
		default:
			process.platform === "win32"
				? "docker compose restart haproxy"
				: "docker compose restart haproxy",
	}),
	HAPROXY_VALIDATE_COMMAND: str({
		default:
			"docker compose exec -T haproxy haproxy -f /usr/local/etc/haproxy/conf.d -c",
	}),
	SSH_KEY_DIR: str({ default: ".runtime/ssh" }),
	SSH_PRIVATE_KEY_FILE: str({ default: "id_ed25519" }),
	SSH_PUBLIC_KEY_FILE: str({ default: "id_ed25519.pub" }),
	SSH_DEFAULT_PORT: str({ default: "22" }),
	SSH_CONNECT_TIMEOUT_SEC: str({ default: "8" }),
});
