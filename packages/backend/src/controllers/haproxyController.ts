import { Elysia, t } from "elysia";
import {
	type HAProxyBackend,
	type HAProxyConfig,
	type HAProxyStats,
	haproxyService,
} from "../services/haproxyService";
import type { ApiResponse } from "../types/common";

export function createHAProxyController() {
	return (
		new Elysia({ prefix: "/haproxy" })
			// Get HAProxy stats - connects to socket and fetches real-time stats
			.get("/stats", async (): Promise<ApiResponse<HAProxyStats>> => {
				try {
					const stats = await haproxyService.getStats();
					return {
						success: true,
						data: stats,
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error
								? error.message
								: "Failed to fetch HAProxy stats",
					};
				}
			})
			// Get HAProxy configuration
			.get("/config", async (): Promise<ApiResponse<HAProxyConfig>> => {
				try {
					const config = await haproxyService.getConfig();
					return {
						success: true,
						data: config,
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error
								? error.message
								: "Failed to fetch HAProxy config",
					};
				}
			})
			// Get all backends with their servers - fetches via socket
			.get("/backends", async (): Promise<ApiResponse<HAProxyBackend[]>> => {
				try {
					const backends = await haproxyService.getBackends();
					return {
						success: true,
						data: backends,
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error
								? error.message
								: "Failed to fetch HAProxy backends",
					};
				}
			})
			// Set server state (enable/disable)
			.post(
				"/server/:backend/:server/:state",
				async ({
					params,
				}: {
					params: { backend: string; server: string; state: string };
				}): Promise<ApiResponse<{ message: string }>> => {
					try {
						const { backend, server, state } = params;
						if (!["enable", "disable"].includes(state)) {
							return {
								success: false,
								error: "Invalid state. Use 'enable' or 'disable'",
							};
						}

						const result = await haproxyService.setServerState(
							backend,
							server,
							state as "enable" | "disable",
						);

						if (result) {
							return {
								success: true,
								message: `Server ${server} in ${backend} has been ${state}d`,
							};
						} else {
							return {
								success: false,
								error: `Failed to ${state} server`,
							};
						}
					} catch (error) {
						return {
							success: false,
							error:
								error instanceof Error
									? error.message
									: `Failed to ${params.state} server`,
						};
					}
				},
			)
			// Reload HAProxy config
			.post("/reload", async (): Promise<ApiResponse> => {
				try {
					await haproxyService.reloadConfig();
					return {
						success: true,
						message: "HAProxy configuration reloaded",
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error
								? error.message
								: "Failed to reload HAProxy config",
					};
				}
			})
	);
}
