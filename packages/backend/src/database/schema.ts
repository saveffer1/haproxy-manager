// src/database/schema.ts
import {
	boolean,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const nodeTypeEnum = pgEnum("node_type", ["managed", "monitored"]);
export const nodeSourceEnum = pgEnum("node_source", [
	"manual",
	"docker",
	"remote",
	"api",
]);
export const logStrategyEnum = pgEnum("log_strategy", [
	"docker",
	"file",
	"journald",
]);
export const haproxyLogSourceEnum = pgEnum("haproxy_log_source", [
	"container",
	"forwarded",
]);

export const nodes = pgTable("nodes", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text("name").notNull(),
	ipAddress: text("ip_address").notNull(),
	type: nodeTypeEnum("type").default("monitored").notNull(),
	source: nodeSourceEnum("source").default("manual").notNull(),
	logStrategy: logStrategyEnum("log_strategy").default("docker").notNull(),
	logPath: text("log_path"),
	haproxyStatsUrl: text("haproxy_stats_url"),
	haproxySocketPath: text("haproxy_socket_path"),
	haproxyApiUrl: text("haproxy_api_url"),
	haproxyContainerRef: text("haproxy_container_ref"),
	haproxyConfigPath: text("haproxy_config_path"),
	haproxyLogPath: text("haproxy_log_path"),
	haproxyLogSource: haproxyLogSourceEnum("haproxy_log_source")
		.default("container")
		.notNull(),
	isLocalService: boolean("is_local_service").default(false).notNull(),
	sshUser: text("ssh_user").default("root"),
	sshPort: integer("ssh_port").default(22).notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	username: text("username").unique(),
	displayUsername: text("display_username"),
	emailVerified: boolean("email_verified").notNull(),
	image: text("image"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at").notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => user.id),
});

export const account = pgTable("account", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at"),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at"),
	updatedAt: timestamp("updated_at"),
});
