import { Elysia } from "elysia";
import { auth } from "../lib/auth";
import { env } from "../lib/env";
import {
	type HAProxyBackend,
	type HAProxyConfig,
	type HAProxyStats,
	haproxyService,
} from "../services/haproxyService";
import type { ApiResponse } from "../types/common";

type ThemeMode = "light" | "dark";

function getStatsThemeCss(theme: ThemeMode) {
	if (theme !== "dark") {
		return "";
	}

	return `
<style id="haproxy-manager-theme-override">
body { background: #0f172a !important; color: #e2e8f0 !important; }
h1, h2, h3, th, td, li, p { color: #e2e8f0 !important; }
a, a:visited, a:hover { color: #67e8f9 !important; }
.hr { border-color: #334155 !important; }
table.tbl td, table.tbl th { border-color: #334155 !important; }
.titre, .total { background: #0f766e !important; color: #ecfeff !important; }
.frontend, .backend { background: #1e293b !important; }
.socket { background: #334155 !important; }
.active_up, .backup_up { background: #14532d !important; color: #dcfce7 !important; }
.active_down, .backup_down { background: #7f1d1d !important; color: #fee2e2 !important; }
.active_going_up, .backup_going_up { background: #78350f !important; color: #fef3c7 !important; }
.active_going_down, .backup_going_down { background: #4c1d95 !important; color: #ede9fe !important; }
.active_nolb, .backup_nolb, .active_draining, .backup_draining { background: #0c4a6e !important; color: #e0f2fe !important; }
.active_no_check, .backup_no_check, .maintain { background: #334155 !important; color: #e2e8f0 !important; }
</style>
`;
}

export function createHAProxyController() {
	return (
		new Elysia({ prefix: "/haproxy" })
			.get("/stats/ui", async ({ request, set }) => {
				try {
					const themeParam = new URL(request.url).searchParams.get("theme");
					const theme: ThemeMode = themeParam === "dark" ? "dark" : "light";

					const authApi = auth.api as {
						getSession: (args: {
							headers: Headers;
						}) => Promise<{ user?: unknown } | null>;
					};

					const session = await authApi.getSession({
						headers: request.headers,
					});
					if (!session?.user) {
						set.status = 401;
						return {
							success: false,
							error: "Authentication required",
						};
					}

					const basicAuth = Buffer.from(
						`${env.HAPROXY_STATS_USERNAME}:${env.HAPROXY_STATS_PASSWORD}`,
					).toString("base64");
					const upstream = await fetch(env.HAPROXY_STATS_URL, {
						headers: {
							Authorization: `Basic ${basicAuth}`,
						},
					});

					if (!upstream.ok) {
						set.status = 502;
						return {
							success: false,
							error: `HAProxy stats upstream returned ${upstream.status}`,
						};
					}

					const contentType =
						upstream.headers.get("content-type") ?? "text/html; charset=utf-8";
					const html = await upstream.text();
					const themedHtml = html.includes("</head>")
						? html.replace("</head>", `${getStatsThemeCss(theme)}</head>`)
						: `${getStatsThemeCss(theme)}${html}`;

					return new Response(themedHtml, {
						headers: {
							"Content-Type": contentType,
							"Cache-Control": "no-store",
						},
					});
				} catch (error) {
					set.status = 500;
					return {
						success: false,
						error:
							error instanceof Error
								? error.message
								: "Failed to load HAProxy stats dashboard",
					};
				}
			})
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
