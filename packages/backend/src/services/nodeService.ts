import { eq } from "drizzle-orm";
import { db } from "../database/db";
import { nodes } from "../database/schema";
import type {
	CreateNodeInput,
	NodeOutput,
	UpdateNodeInput,
} from "../types/common";

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
			const newNode = await db
				.insert(nodes)
				.values({
					name: input.name,
					ipAddress: input.ipAddress,
					type: input.type || "monitored",
					logStrategy: input.logStrategy || "docker",
					logPath: input.logPath || null,
					sshUser: input.sshUser || "root",
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

			const updates: Partial<typeof input> = {};
			if (input.name !== undefined) updates.name = input.name;
			if (input.ipAddress !== undefined) updates.ipAddress = input.ipAddress;
			if (input.type !== undefined) updates.type = input.type;
			if (input.logStrategy !== undefined)
				updates.logStrategy = input.logStrategy;
			if (input.logPath !== undefined) updates.logPath = input.logPath;
			if (input.sshUser !== undefined) updates.sshUser = input.sshUser;

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
