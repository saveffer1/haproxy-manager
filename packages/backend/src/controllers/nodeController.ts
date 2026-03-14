import { Elysia, t } from "elysia";
import { nodeService } from "../services/nodeService";
import type { ApiResponse, NodeOutput } from "../types/common";

export function createNodeController() {
	return (
		new Elysia({ prefix: "/api/nodes" })
			// Get all nodes
			.get("/", async (): Promise<ApiResponse<NodeOutput[]>> => {
				try {
					const allNodes = await nodeService.getAllNodes();
					return {
						success: true,
						data: allNodes,
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error ? error.message : "Failed to fetch nodes",
					};
				}
			})
			// Create node
			.post(
				"/",
				async ({ body }): Promise<ApiResponse<NodeOutput>> => {
					try {
						const newNode = await nodeService.createNode(body);
						return {
							success: true,
							data: newNode,
						};
					} catch (error) {
						return {
							success: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to create node",
						};
					}
				},
				{
					body: t.Object({
						name: t.String(),
						ipAddress: t.String(),
						type: t.Optional(
							t.Union([t.Literal("managed"), t.Literal("monitored")]),
						),
						logStrategy: t.Optional(
							t.Union([
								t.Literal("docker"),
								t.Literal("file"),
								t.Literal("journald"),
							]),
						),
						logPath: t.Optional(t.String()),
						sshUser: t.Optional(t.String()),
					}),
				},
			)
			// Get node by ID
			.get(
				"/:id",
				async ({ params }): Promise<ApiResponse<NodeOutput>> => {
					try {
						const node = await nodeService.getNodeById(params.id);
						if (!node) {
							return {
								success: false,
								error: "Node not found",
							};
						}
						return {
							success: true,
							data: node,
						};
					} catch (error) {
						return {
							success: false,
							error:
								error instanceof Error ? error.message : "Failed to fetch node",
						};
					}
				},
				{
					params: t.Object({
						id: t.String(),
					}),
				},
			)
			// Update node
			.patch(
				"/:id",
				async ({ params, body }): Promise<ApiResponse<NodeOutput>> => {
					try {
						const updated = await nodeService.updateNode(params.id, body);
						return {
							success: true,
							data: updated,
						};
					} catch (error) {
						return {
							success: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to update node",
						};
					}
				},
				{
					params: t.Object({
						id: t.String(),
					}),
					body: t.Partial(
						t.Object({
							name: t.String(),
							ipAddress: t.String(),
							type: t.Union([t.Literal("managed"), t.Literal("monitored")]),
							logStrategy: t.Union([
								t.Literal("docker"),
								t.Literal("file"),
								t.Literal("journald"),
							]),
							logPath: t.String(),
							sshUser: t.String(),
						}),
					),
				},
			)
			// Delete node
			.delete(
				"/:id",
				async ({ params }): Promise<ApiResponse> => {
					try {
						await nodeService.deleteNode(params.id);
						return {
							success: true,
							message: "Node deleted successfully",
						};
					} catch (error) {
						return {
							success: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to delete node",
						};
					}
				},
				{
					params: t.Object({
						id: t.String(),
					}),
				},
			)
	);
}
