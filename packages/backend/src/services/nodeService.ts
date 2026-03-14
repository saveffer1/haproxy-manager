import { eq, or } from "drizzle-orm";
import { db } from "../database/db";
import { nodes } from "../database/schema";
import { env } from "../lib/env";
import type {
	CreateNodeInput,
	NodeOutput,
	UpdateNodeInput,
} from "../types/common";

function isLocalHostValue(value: string) {
	const host = value.trim().toLowerCase();
	return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export class NodeService {
	async getAllNodes(): Promise<NodeOutput[]> {
		try {
			const allNodes = await db.query.nodes.findMany();
			return allNodes as NodeOutput[];
		} catch (error) {
			console.error("Error fetching nodes:", error);
			throw new Error("Failed to fetch nodes from database");
		}
	}

	async getNodeById(id: string): Promise<NodeOutput | null> {
		try {
			const node = await db.query.nodes.findFirst({
				where: eq(nodes.id, id),
			});
			return (node as NodeOutput) || null;
		} catch (error) {
			console.error("Error fetching node:", error);
			throw new Error("Failed to fetch node from database");
		}
	}

	async createNode(input: CreateNodeInput): Promise<NodeOutput> {
		try {
			const sshPort = Number.isFinite(input.sshPort)
				? Math.max(1, Number(input.sshPort))
				: 22;

			const isLocalService =
				typeof input.isLocalService === "boolean"
					? input.isLocalService
					: isLocalHostValue(input.ipAddress) &&
						(input.source || "manual") === "manual";

			const newNode = await db
				.insert(nodes)
				.values({
					name: input.name,
					ipAddress: input.ipAddress,
					isLocalService,
					type: input.type || "monitored",
					source: input.source || "manual",
					logStrategy: input.logStrategy || "docker",
					logPath: input.logPath || null,
					haproxyStatsUrl: input.haproxyStatsUrl || null,
					haproxyApiUrl: input.haproxyApiUrl || null,
					haproxyContainerRef:
						input.haproxyContainerRef?.trim() || null,
					haproxyConfigPath: input.haproxyConfigPath || null,
					haproxyLogPath: input.haproxyLogPath || null,
					haproxyLogSource: input.haproxyLogSource || "container",
					sshUser: input.sshUser || "root",
					sshPort,
				})
				.returning();

			if (!newNode[0]) {
				throw new Error("Failed to create node");
			}

			return newNode[0] as NodeOutput;
		} catch (error) {
			console.error("Error creating node:", error);
			throw new Error("Failed to create node in database");
		}
	}

	async updateNode(id: string, input: UpdateNodeInput): Promise<NodeOutput> {
		try {
			// Verify node exists
			const existing = await this.getNodeById(id);
			if (!existing) {
				throw new Error("Node not found");
			}

			const normalizeOptional = (value: string | undefined) => {
				if (value === undefined) {
					return undefined;
				}

				const trimmed = value.trim();
				return trimmed ? trimmed : null;
			};

			const updates: Partial<typeof nodes.$inferInsert> = {};
			if (input.name !== undefined) updates.name = input.name;
			if (input.ipAddress !== undefined) updates.ipAddress = input.ipAddress;
			if (input.isLocalService !== undefined)
				updates.isLocalService = input.isLocalService;
			if (input.type !== undefined) updates.type = input.type;
			if (input.source !== undefined) updates.source = input.source;
			if (input.logStrategy !== undefined)
				updates.logStrategy = input.logStrategy;
			if (input.logPath !== undefined)
				updates.logPath = normalizeOptional(input.logPath);
			if (input.haproxyStatsUrl !== undefined)
				updates.haproxyStatsUrl = normalizeOptional(input.haproxyStatsUrl);
			if (input.haproxyApiUrl !== undefined)
				updates.haproxyApiUrl = normalizeOptional(input.haproxyApiUrl);
			if (input.haproxyContainerRef !== undefined)
				updates.haproxyContainerRef = normalizeOptional(input.haproxyContainerRef);
			if (input.haproxyConfigPath !== undefined)
				updates.haproxyConfigPath = normalizeOptional(input.haproxyConfigPath);
			if (input.haproxyLogPath !== undefined)
				updates.haproxyLogPath = normalizeOptional(input.haproxyLogPath);
			if (input.haproxyLogSource !== undefined)
				updates.haproxyLogSource = input.haproxyLogSource;
			if (input.sshUser !== undefined) updates.sshUser = input.sshUser;
			if (input.sshPort !== undefined) {
				updates.sshPort = Math.max(1, Number(input.sshPort));
			}

			const updated = await db
				.update(nodes)
				.set(updates)
				.where(eq(nodes.id, id))
				.returning();

			if (!updated[0]) {
				throw new Error("Failed to update node");
			}

			return updated[0] as NodeOutput;
		} catch (error) {
			console.error("Error updating node:", error);
			throw new Error(
				`Failed to update node: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	async deleteNode(id: string): Promise<boolean> {
		try {
			// Verify node exists
			const existing = await this.getNodeById(id);
			if (!existing) {
				throw new Error("Node not found");
			}

			const _result = await db.delete(nodes).where(eq(nodes.id, id));
			return true;
		} catch (error) {
			console.error("Error deleting node:", error);
			throw new Error(
				`Failed to delete node: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}
}

export const nodeService = new NodeService();

export async function ensureDefaultNode() {
	const nodeType =
		env.DEFAULT_NODE_TYPE === "managed" || env.DEFAULT_NODE_TYPE === "monitored"
			? env.DEFAULT_NODE_TYPE
			: "managed";

	const logStrategy =
		env.DEFAULT_NODE_LOG_STRATEGY === "docker" ||
		env.DEFAULT_NODE_LOG_STRATEGY === "file" ||
		env.DEFAULT_NODE_LOG_STRATEGY === "journald"
			? env.DEFAULT_NODE_LOG_STRATEGY
			: "docker";

	try {
		const existing = await db
			.select({ id: nodes.id })
			.from(nodes)
			.where(
				or(
					eq(nodes.name, env.DEFAULT_NODE_NAME),
					eq(nodes.ipAddress, env.DEFAULT_NODE_IP_ADDRESS),
				),
			)
			.limit(1);

		if (existing[0]) {
			return;
		}

		await db.insert(nodes).values({
			name: env.DEFAULT_NODE_NAME,
			ipAddress: env.DEFAULT_NODE_IP_ADDRESS,
			isLocalService: isLocalHostValue(env.DEFAULT_NODE_IP_ADDRESS),
			type: nodeType,
			source: "manual",
			logStrategy,
			logPath: env.DEFAULT_NODE_LOG_PATH || null,
			haproxyStatsUrl: `http://${env.DEFAULT_NODE_IP_ADDRESS}:8404/stats`,
			haproxyApiUrl: `http://${env.DEFAULT_NODE_IP_ADDRESS}:3000`,
			haproxyConfigPath: env.HAPROXY_CONFIG_DIR,
			haproxyLogPath: env.DEFAULT_NODE_LOG_PATH || null,
			haproxyLogSource: "container",
			sshUser: env.DEFAULT_NODE_SSH_USER,
			sshPort: Number.parseInt(env.DEFAULT_NODE_SSH_PORT, 10) || 22,
		});

		console.log(
			`[nodes] Seeded default node: ${env.DEFAULT_NODE_NAME} (${env.DEFAULT_NODE_IP_ADDRESS}).`,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (
			message.includes('relation "nodes" does not exist') ||
			message.includes('column "source" of relation "nodes" does not exist') ||
			message.includes(
				'column "haproxy_stats_url" of relation "nodes" does not exist',
			) ||
			message.includes(
				'column "haproxy_api_url" of relation "nodes" does not exist',
			) ||
			message.includes(
				'column "haproxy_config_path" of relation "nodes" does not exist',
			) ||
			message.includes(
				'column "haproxy_container_ref" of relation "nodes" does not exist',
			) ||
			message.includes(
				'column "haproxy_log_path" of relation "nodes" does not exist',
			) ||
			message.includes(
				'column "haproxy_log_source" of relation "nodes" does not exist',
			) ||
			message.includes(
				'column "is_local_service" of relation "nodes" does not exist',
			) ||
			message.includes('column "ssh_port" of relation "nodes" does not exist')
		) {
			console.warn(
				"[nodes] Nodes schema is out of date. Run bun --filter @app/backend run db:push.",
			);
			return;
		}

		console.warn("[nodes] Could not seed default node:", message);
	}
}
