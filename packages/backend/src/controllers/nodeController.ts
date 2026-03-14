import { Elysia, t } from "elysia";
import { nodeService } from "../services/nodeService";
import { getSshPublicKey, testSshConnection } from "../services/sshService";
import type { ApiResponse, NodeOutput } from "../types/common";

export function createNodeController() {
	const updateNodeHandler = async ({
		params,
		body,
	}: {
		params: { id: string };
		body: Record<string, unknown>;
	}): Promise<ApiResponse<NodeOutput>> => {
		try {
			const updated = await nodeService.updateNode(params.id, body);
			return {
				success: true,
				data: updated,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to update node",
			};
		}
	};

	const updateNodeOptions = {
		params: t.Object({
			id: t.String(),
		}),
		body: t.Partial(
			t.Object({
				name: t.String(),
				ipAddress: t.String(),
				isLocalService: t.Boolean(),
				type: t.Union([t.Literal("managed"), t.Literal("monitored")]),
				source: t.Union([
					t.Literal("manual"),
					t.Literal("docker"),
					t.Literal("remote"),
					t.Literal("api"),
				]),
				logStrategy: t.Union([
					t.Literal("docker"),
					t.Literal("file"),
					t.Literal("journald"),
				]),
				logPath: t.String(),
				haproxyStatsUrl: t.String(),
				haproxySocketPath: t.String(),
				haproxyApiUrl: t.String(),
				haproxyContainerRef: t.String(),
				haproxyConfigPath: t.String(),
				haproxyLogPath: t.String(),
				haproxyLogSource: t.Union([
					t.Literal("container"),
					t.Literal("forwarded"),
				]),
				sshUser: t.String(),
				sshPort: t.Number(),
			}),
		),
	};

	return (
		new Elysia({ prefix: "/api/nodes" })
			.get(
				"/ssh/public-key",
				async (): Promise<ApiResponse<{ publicKey: string }>> => {
					try {
						const publicKey = await getSshPublicKey();
						return {
							success: true,
							data: { publicKey },
						};
					} catch (error) {
						return {
							success: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to read SSH public key",
						};
					}
				},
			)
			.post(
				"/ssh/test",
				async ({
					body,
				}): Promise<ApiResponse<{ ok: boolean; message: string }>> => {
					try {
						const result = await testSshConnection({
							host: body.ipAddress,
							user: body.sshUser,
							port: body.sshPort,
						});

						return {
							success: true,
							data: {
								ok: result.ok,
								message: result.message,
							},
						};
					} catch (error) {
						return {
							success: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to test SSH connection",
						};
					}
				},
				{
					body: t.Object({
						ipAddress: t.String(),
						sshUser: t.Optional(t.String()),
						sshPort: t.Optional(t.Number()),
					}),
				},
			)
			.post(
				"/:id/ssh/test",
				async ({
					params,
				}): Promise<ApiResponse<{ ok: boolean; message: string }>> => {
					try {
						const node = await nodeService.getNodeById(params.id);
						if (!node) {
							return {
								success: false,
								error: "Node not found",
							};
						}

						const result = await testSshConnection({
							host: node.ipAddress,
							user: node.sshUser,
							port: node.sshPort,
						});

						return {
							success: true,
							data: {
								ok: result.ok,
								message: result.message,
							},
						};
					} catch (error) {
						return {
							success: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to test SSH connection",
						};
					}
				},
				{
					params: t.Object({
						id: t.String(),
					}),
				},
			)
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
						isLocalService: t.Optional(t.Boolean()),
						type: t.Optional(
							t.Union([t.Literal("managed"), t.Literal("monitored")]),
						),
						source: t.Optional(
							t.Union([
								t.Literal("manual"),
								t.Literal("docker"),
								t.Literal("remote"),
								t.Literal("api"),
							]),
						),
						logStrategy: t.Optional(
							t.Union([
								t.Literal("docker"),
								t.Literal("file"),
								t.Literal("journald"),
							]),
						),
						logPath: t.Optional(t.String()),
						haproxyStatsUrl: t.Optional(t.String()),
						haproxySocketPath: t.Optional(t.String()),
						haproxyApiUrl: t.Optional(t.String()),
						haproxyContainerRef: t.Optional(t.String()),
						haproxyConfigPath: t.Optional(t.String()),
						haproxyLogPath: t.Optional(t.String()),
						haproxyLogSource: t.Optional(
							t.Union([t.Literal("container"), t.Literal("forwarded")]),
						),
						sshUser: t.Optional(t.String()),
						sshPort: t.Optional(t.Number()),
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
			.patch("/:id", updateNodeHandler, updateNodeOptions)
			.put("/:id", updateNodeHandler, updateNodeOptions)
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
