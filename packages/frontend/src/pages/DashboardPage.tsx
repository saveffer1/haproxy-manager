import { AlertTriangle, RefreshCw } from "lucide-react";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import {
	HAProxyStatsGraphs,
	type StatsHistoryPoint,
} from "@/components/dashboard/haproxy-stats-graphs";
import { StatsCard } from "@/components/dashboard/stats-card";
import { type DashboardTab, Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	type DashboardSummary,
	getDashboardSummary,
	getHAProxyStatsCapabilities,
	getHAProxyStatsSnapshot,
	type HAProxyStatsCapabilities,
	type HAProxyStatsRequestedSource,
} from "@/lib/api";
import { env } from "@/lib/env";
import { useAuth } from "@/providers/auth-provider";
import { useTheme } from "@/providers/theme-provider";

const HAPROXY_STATS_SETUP_DOCS_URL =
	"https://www.haproxy.com/documentation/haproxy-configuration-tutorials/alerts-and-monitoring/statistics/";
const STATS_POLL_INTERVAL_MS = 5000;
const STATS_HISTORY_WINDOW_MS = 15 * 60 * 1000;

const QuickActions = lazy(() => import("@/components/dashboard/quick-actions"));
const HAProxyConfigEditor = lazy(
	() => import("@/components/dashboard/haproxy-config-editor"),
);
const HAProxyLogViewer = lazy(
	() => import("@/components/dashboard/haproxy-log-viewer"),
);
const NodeConfiguration = lazy(
	() => import("@/components/dashboard/node-configuration"),
);
const UserAccount = lazy(() => import("@/components/dashboard/user-account"));

const initialState: DashboardSummary = {
	health: null,
	stats: null,
	nodes: [],
};

const NODE_SELECTION_DEBOUNCE_MS = 250;

export default function DashboardPage() {
	const { logout } = useAuth();
	const { theme } = useTheme();
	const [searchParams, setSearchParams] = useSearchParams();
	const [mobileOpen, setMobileOpen] = useState(false);
	const [loading, setLoading] = useState(true);
	const [summary, setSummary] = useState<DashboardSummary>(initialState);
	const [statsError, setStatsError] = useState<string | null>(null);
	const [statsLoading, setStatsLoading] = useState(false);
	const [statsCapabilities, setStatsCapabilities] =
		useState<HAProxyStatsCapabilities | null>(null);
	const [statsSnapshot, setStatsSnapshot] =
		useState<DashboardSummary["stats"]>(null);
	const [statsHistory, setStatsHistory] = useState<StatsHistoryPoint[]>([]);
	const [statsSource, setStatsSource] =
		useState<HAProxyStatsRequestedSource>("auto");
	const [statsView, setStatsView] = useState<
		"auto" | "graph" | "classic" | "split"
	>("auto");
	const summaryRequestSequenceRef = useRef(0);

	const activeTab = useMemo<DashboardTab>(() => {
		const tab = searchParams.get("tab");
		if (
			tab === "stats" ||
			tab === "config" ||
			tab === "logs" ||
			tab === "node-config" ||
			tab === "account"
		) {
			return tab;
		}

		return "overview";
	}, [searchParams]);

	const setActiveTab = useCallback(
		(tab: DashboardTab) => {
			setSearchParams((current) => {
				const next = new URLSearchParams(current);
				next.set("tab", tab);
				return next;
			});
		},
		[setSearchParams],
	);

	const selectedNodeId = searchParams.get("nodeId");
	const [debouncedSelectedNodeId, setDebouncedSelectedNodeId] = useState<
		string | null
	>(selectedNodeId);

	const setSelectedNodeId = useCallback(
		(nodeId: string) => {
			setSearchParams((current) => {
				const next = new URLSearchParams(current);
				next.set("nodeId", nodeId);
				return next;
			});
		},
		[setSearchParams],
	);

	useEffect(() => {
		const debounceTimer = setTimeout(() => {
			setDebouncedSelectedNodeId(selectedNodeId);
		}, NODE_SELECTION_DEBOUNCE_MS);

		return () => {
			clearTimeout(debounceTimer);
		};
	}, [selectedNodeId]);

	const refreshSummary = useCallback(async () => {
		return getDashboardSummary(debouncedSelectedNodeId, {
			includeStats:
				(activeTab === "overview" || activeTab === "stats") &&
				Boolean(debouncedSelectedNodeId),
			statsSource,
		});
	}, [activeTab, debouncedSelectedNodeId, statsSource]);

	const loadSummary = useCallback(async () => {
		let mounted = true;
		const requestSequence = ++summaryRequestSequenceRef.current;
		setLoading(true);
		setSummary((current) => ({
			...current,
			stats: null,
		}));

		await refreshSummary()
			.then((response) => {
				if (!mounted || requestSequence !== summaryRequestSequenceRef.current) {
					return;
				}

				setSummary(response);

				const hasSelectedNode = response.nodes.some(
					(node) => node.id === selectedNodeId,
				);
				if (
					(!selectedNodeId || !hasSelectedNode) &&
					response.nodes.length > 0 &&
					response.nodes[0]
				) {
					setSelectedNodeId(response.nodes[0].id);
				}
			})
			.finally(() => {
				if (mounted && requestSequence === summaryRequestSequenceRef.current) {
					setLoading(false);
				}
			});

		return () => {
			mounted = false;
		};
	}, [refreshSummary, selectedNodeId, setSelectedNodeId]);

	useEffect(() => {
		let mounted = true;

		loadSummary().then((cleanup) => {
			if (!mounted && cleanup) {
				cleanup();
			}
		});

		return () => {
			mounted = false;
		};
	}, [loadSummary]);

	useEffect(() => {
		if (activeTab !== "stats") {
			return;
		}

		if (!debouncedSelectedNodeId) {
			setStatsCapabilities(null);
			setStatsSnapshot(null);
			setStatsHistory([]);
			setStatsLoading(false);
			setStatsError("Please select a node before opening HAProxy stats.");
			return;
		}

		let mounted = true;
		setStatsLoading(true);
		setStatsError(null);

		getHAProxyStatsCapabilities(debouncedSelectedNodeId)
			.then((capabilities) => {
				if (!mounted) {
					return;
				}

				setStatsCapabilities(capabilities);
			})
			.catch((error) => {
				if (!mounted) {
					return;
				}

				setStatsCapabilities(null);
				setStatsError(
					error instanceof Error
						? error.message
						: "Unable to load HAProxy stats capabilities",
				);
			})
			.finally(() => {
				if (mounted) {
					setStatsLoading(false);
				}
			});

		return () => {
			mounted = false;
		};
	}, [activeTab, debouncedSelectedNodeId]);

	useEffect(() => {
		if (
			activeTab !== "stats" ||
			!debouncedSelectedNodeId ||
			!statsCapabilities
		) {
			return;
		}

		const supportsGraph = statsCapabilities.availableViews.includes("graph");
		if (!supportsGraph) {
			setStatsSnapshot(null);
			setStatsHistory([]);
			return;
		}

		let mounted = true;
		let intervalId: ReturnType<typeof setInterval> | null = null;

		const pollSnapshot = async () => {
			try {
				const snapshot = await getHAProxyStatsSnapshot({
					nodeId: debouncedSelectedNodeId,
					source: statsSource,
				});

				if (!mounted) {
					return;
				}

				setStatsSnapshot(snapshot);
				setStatsError((current) =>
					current?.includes("snapshot") ? null : current,
				);

				if (!snapshot.snapshot) {
					return;
				}

				const snapshotData = snapshot.snapshot;

				const collectedAtMs = Number.isFinite(
					Date.parse(snapshotData.collectedAt),
				)
					? Date.parse(snapshotData.collectedAt)
					: Date.now();

				setStatsHistory((previous) => {
					const latestPoint = previous[previous.length - 1];
					const elapsedSeconds = latestPoint
						? Math.max(1, (collectedAtMs - latestPoint.timestamp) / 1000)
						: 1;

					const throughputInBps = latestPoint
						? Math.max(
								0,
								(snapshotData.totals.bytesIn -
									latestPoint.bytesInCounter) /
									elapsedSeconds,
							)
						: 0;

					const throughputOutBps = latestPoint
						? Math.max(
								0,
								(snapshotData.totals.bytesOut -
									latestPoint.bytesOutCounter) /
									elapsedSeconds,
							)
						: 0;

					const nextPoint: StatsHistoryPoint = {
						timestamp: collectedAtMs,
						activeSessions: snapshotData.totals.activeSessions,
						connectionsRate: snapshotData.totals.connectionsRate,
						throughputInBps,
						throughputOutBps,
						bytesInCounter: snapshotData.totals.bytesIn,
						bytesOutCounter: snapshotData.totals.bytesOut,
					};

					const withNext = [...previous, nextPoint];
					const threshold = collectedAtMs - STATS_HISTORY_WINDOW_MS;
					return withNext
						.filter((point) => point.timestamp >= threshold)
						.slice(-240);
				});
			} catch (error) {
				if (!mounted) {
					return;
				}

				setStatsError(
					error instanceof Error
						? `Unable to refresh stats snapshot: ${error.message}`
						: "Unable to refresh stats snapshot",
				);
			}
		};

		void pollSnapshot();
		intervalId = setInterval(() => {
			void pollSnapshot();
		}, STATS_POLL_INTERVAL_MS);

		return () => {
			mounted = false;
			if (intervalId) {
				clearInterval(intervalId);
			}
		};
	}, [activeTab, debouncedSelectedNodeId, statsCapabilities, statsSource]);

	const statsCards = useMemo(
		() => [
			{
				title: "API Health",
				value: summary.health?.status ?? "Unknown",
				hint: summary.health ? "Backend reachable" : "Waiting for backend",
				state: summary.health ? "ok" : "warn",
			},
			{
				title: "Nodes",
				value: String(summary.nodes.length),
				hint: "Monitored and managed nodes",
				state: "neutral",
			},
		],
		[summary],
	);

	const handleLogout = async () => {
		await logout();
	};

	const statsUiSrc = useMemo(() => {
		if (!debouncedSelectedNodeId) {
			return null;
		}

		const query = new URLSearchParams({ theme });
		query.set("nodeId", debouncedSelectedNodeId);
		return `${env.VITE_BACKEND_URL}/haproxy/stats/ui?${query.toString()}`;
	}, [debouncedSelectedNodeId, theme]);

	const supportsGraphView =
		statsCapabilities?.availableViews.includes("graph") ?? false;
	const supportsClassicView =
		statsCapabilities?.availableViews.includes("classic") ?? false;

	const resolvedStatsView = useMemo<
		"none" | "graph" | "classic" | "split"
	>(() => {
		if (!statsCapabilities) {
			return "none";
		}

		if (statsView === "graph") {
			if (supportsGraphView) {
				return "graph";
			}
			if (supportsClassicView) {
				return "classic";
			}
			return "none";
		}

		if (statsView === "classic") {
			if (supportsClassicView) {
				return "classic";
			}
			if (supportsGraphView) {
				return "graph";
			}
			return "none";
		}

		if (statsView === "split") {
			if (supportsGraphView && supportsClassicView) {
				return "split";
			}
			if (supportsGraphView) {
				return "graph";
			}
			if (supportsClassicView) {
				return "classic";
			}
			return "none";
		}

		if (supportsGraphView && supportsClassicView) {
			return "split";
		}
		if (supportsGraphView) {
			return "graph";
		}
		if (supportsClassicView) {
			return "classic";
		}

		return "none";
	}, [statsCapabilities, statsView, supportsClassicView, supportsGraphView]);

	const selectedNode = useMemo(
		() => summary.nodes.find((node) => node.id === selectedNodeId) ?? null,
		[selectedNodeId, summary.nodes],
	);

	const selectedNodeRuntime = useMemo(() => {
		if (!selectedNode) {
			return null;
		}

		const runtime = summary.stats?.nodeRuntime;
		if (!runtime || runtime.nodeId !== selectedNode.id) {
			return null;
		}

		return runtime;
	}, [selectedNode, summary.stats?.nodeRuntime]);

	const scopedStats = useMemo(() => {
		if (!summary.stats || !selectedNodeId) {
			return null;
		}

		const runtimeNodeId = summary.stats.nodeRuntime?.nodeId;
		if (runtimeNodeId && runtimeNodeId !== selectedNodeId) {
			return null;
		}

		return summary.stats;
	}, [selectedNodeId, summary.stats]);

	const handleNodeConfigSaved = useCallback(
		(updatedNode: (typeof summary.nodes)[number]) => {
			setSummary((current) => ({
				...current,
				nodes: current.nodes.map((node) =>
					node.id === updatedNode.id ? updatedNode : node,
				),
			}));
		},
		[],
	);

	const managedNodes = useMemo(
		() => summary.nodes.filter((node) => node.type === "managed"),
		[summary.nodes],
	);

	const monitoredNodes = useMemo(
		() => summary.nodes.filter((node) => node.type === "monitored"),
		[summary.nodes],
	);

	const showMonitoredWarning =
		selectedNode?.type === "monitored" &&
		(activeTab === "stats" || activeTab === "config" || activeTab === "logs");

	const selectedNodeUptime =
		scopedStats?.uptime ?? selectedNodeRuntime?.docker?.uptime ?? "n/a";
	const statsWarning = scopedStats?.warning?.trim() || null;

	const haproxyStatus = (scopedStats?.status ?? "unknown").toLowerCase();
	const haproxyStatusDotClass =
		haproxyStatus === "online"
			? "bg-emerald-500"
			: haproxyStatus === "stopping"
				? "bg-amber-500"
				: haproxyStatus === "degraded" || haproxyStatus === "not-configured"
					? "bg-amber-500"
					: haproxyStatus === "offline"
						? "bg-rose-500"
						: "bg-slate-400";
	const haproxyStatusLabel =
		haproxyStatus === "online"
			? "Online"
			: haproxyStatus === "stopping"
				? "Stopping"
				: haproxyStatus === "degraded"
					? "Degraded"
					: haproxyStatus === "not-configured"
						? "No Stats Config"
						: haproxyStatus === "offline"
							? "Offline"
							: "Unknown";

	const handleNodeCreated = useCallback(
		(createdNode: (typeof summary.nodes)[number]) => {
			setSummary((current) => ({
				...current,
				nodes: [...current.nodes, createdNode],
			}));
			setSelectedNodeId(createdNode.id);
		},
		[setSelectedNodeId],
	);

	const handleNodeDeleted = useCallback(
		(deletedNodeId: string, nextNodeId: string | null) => {
			setSummary((current) => ({
				...current,
				nodes: current.nodes.filter((node) => node.id !== deletedNodeId),
			}));

			setSearchParams((current) => {
				const next = new URLSearchParams(current);
				if (nextNodeId) {
					next.set("nodeId", nextNodeId);
				} else {
					next.delete("nodeId");
				}
				return next;
			});
		},
		[setSearchParams],
	);

	const handleReloadStatus = useCallback(() => {
		void loadSummary();
	}, [loadSummary]);

	return (
		<div className="flex min-h-screen bg-background">
			<Sidebar
				mobileOpen={mobileOpen}
				onClose={() => setMobileOpen(false)}
				activeTab={activeTab}
				onSelectTab={setActiveTab}
			/>
			<div className="flex min-h-screen flex-1 flex-col md:pl-0">
				<Topbar
					onToggleSidebar={() => setMobileOpen((prev) => !prev)}
					onLogout={handleLogout}
				/>

				<main className="flex-1 space-y-6 p-4 sm:p-6">
					{activeTab !== "account" && (
						<section
							className={
								activeTab === "overview"
									? "grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]"
									: "space-y-3"
							}
						>
							<div className="space-y-3">
								<div>
									<h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">
										HAProxy Node Selection
									</h2>
									<p className="text-sm text-muted-foreground">
										Choose a node to scope stats and HAProxy operations.
									</p>
								</div>
								{summary.nodes.length === 0 ? (
									<div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
										No nodes found yet. Add at least one node to start scoped
										actions.
									</div>
								) : (
									<div className="w-full space-y-2">
										<label
											htmlFor="node-select"
											className="mb-2 block text-xs uppercase tracking-[0.12em] text-muted-foreground"
										>
											Select Node ({summary.nodes.length})
										</label>
										<select
											id="node-select"
											value={selectedNodeId ?? ""}
											onChange={(event) =>
												setSelectedNodeId(event.target.value)
											}
											className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
										>
											{managedNodes.length > 0 && (
												<optgroup label="Managed Nodes">
													{managedNodes.map((node) => (
														<option key={node.id} value={node.id}>
															{node.name} - {node.ipAddress}
														</option>
													))}
												</optgroup>
											)}
											{monitoredNodes.length > 0 && (
												<optgroup label="Monitored Nodes">
													{monitoredNodes.map((node) => (
														<option key={node.id} value={node.id}>
															{node.name} - {node.ipAddress}
														</option>
													))}
												</optgroup>
											)}
										</select>
									</div>
								)}
								{selectedNode && (
									<p className="text-sm text-muted-foreground">
										Selected:{" "}
										<span className="font-medium text-foreground">
											{selectedNode.name}
										</span>{" "}
										({selectedNode.ipAddress})
									</p>
								)}

								{activeTab === "overview" && (
									<section className="grid w-full gap-2 sm:grid-cols-2">
										{statsCards.map((item) => (
											<StatsCard
												key={item.title}
												title={item.title}
												value={item.value}
												hint={item.hint}
												state={item.state as "ok" | "warn" | "neutral"}
												compact
											/>
										))}
									</section>
								)}
							</div>

							{activeTab === "overview" && (
								<Suspense fallback={<DashboardSkeleton />}>
									<QuickActions
										onOpenStats={() => setActiveTab("stats")}
										onOpenConfigEditor={() => setActiveTab("config")}
										onOpenLogs={() => setActiveTab("logs")}
									/>
								</Suspense>
							)}
						</section>
					)}

					{activeTab === "overview" && loading ? (
						<DashboardSkeleton />
					) : activeTab === "overview" ? (
						<>
							{summary.error && (
								<div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
									<AlertTriangle className="h-4 w-4" />
									{summary.error}
								</div>
							)}

							{statsWarning && (
								<div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
									<AlertTriangle className="h-4 w-4" />
									{statsWarning}
								</div>
							)}

							<section className="grid gap-4">
								<Card>
									<CardHeader className="flex flex-row items-center justify-between gap-3">
										<CardTitle>Selected Node Status</CardTitle>
										<div className="flex items-center gap-2">
											<div className="inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
												<span
													className={`h-2.5 w-2.5 rounded-full ${haproxyStatusDotClass}`}
													title={`HAProxy ${haproxyStatusLabel}`}
												/>
												<span>{haproxyStatusLabel}</span>
											</div>
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={handleReloadStatus}
												disabled={loading}
											>
												<RefreshCw
													className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
												/>
												Reload Status
											</Button>
										</div>
									</CardHeader>
									<CardContent>
										{!selectedNode ? (
											<p className="text-sm text-muted-foreground">
												No node selected yet.
											</p>
										) : (
											<div className="space-y-3 text-sm">
												<div className="rounded-md border border-border bg-background p-3">
													<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
														Node
													</p>
													<p className="mt-1 font-medium text-foreground">
														{selectedNode.name}
													</p>
													<p className="text-muted-foreground">
														{selectedNode.ipAddress}
													</p>
												</div>
												<div className="grid gap-2 sm:grid-cols-2">
													<div className="rounded-md border border-border bg-background p-3">
														<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
															Node Type
														</p>
														<p className="mt-1 font-medium text-foreground">
															{selectedNode.type}
														</p>
													</div>
													<div className="rounded-md border border-border bg-background p-3">
														<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
															Node Source
														</p>
														<p className="mt-1 font-medium text-foreground">
															{selectedNode.source}
														</p>
													</div>
													<div className="rounded-md border border-border bg-background p-3">
														<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
															Uptime
														</p>
														<p className="mt-1 font-medium text-foreground">
															{selectedNodeUptime}
														</p>
													</div>
													<div className="rounded-md border border-border bg-background p-3">
														<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
															Active Sessions
														</p>
														<p className="mt-1 font-medium text-foreground">
															{scopedStats?.active_sessions ?? 0}
														</p>
													</div>
													<div className="rounded-md border border-border bg-background p-3 sm:col-span-2">
														<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
															Connections Rate
														</p>
														<p className="mt-1 font-medium text-foreground">
															{scopedStats?.connections_rate ?? 0}/s
														</p>
													</div>
												</div>

												{selectedNodeRuntime?.detailItems &&
													selectedNodeRuntime.detailItems.length > 0 && (
														<div className="space-y-2 rounded-md border border-border bg-background p-3">
															<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
																Node Runtime Details
															</p>
															<div className="grid gap-2 sm:grid-cols-2">
																{selectedNodeRuntime.detailItems.map((item) => (
																	<div
																		key={`${item.label}-${item.value}`}
																		className="rounded-md border border-border/60 bg-card p-2"
																	>
																		<p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
																			{item.label}
																		</p>
																		<p className="mt-1 break-all text-xs font-medium text-foreground">
																			{item.value}
																		</p>
																	</div>
																))}
															</div>
															{selectedNodeRuntime.note && (
																<p className="text-xs text-muted-foreground">
																	{selectedNodeRuntime.note}
																</p>
															)}
														</div>
													)}

												{selectedNodeRuntime?.docker && (
													<div className="space-y-2 rounded-md border border-border bg-background p-3">
														<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
															Docker Runtime
														</p>
														<div className="grid gap-2 sm:grid-cols-2">
															<div className="rounded-md border border-border/60 bg-card p-2">
																<p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
																	Container ID
																</p>
																<p className="mt-1 break-all text-xs font-medium text-foreground">
																	{selectedNodeRuntime.docker.containerId}
																</p>
															</div>
															<div className="rounded-md border border-border/60 bg-card p-2">
																<p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
																	Container Name
																</p>
																<p className="mt-1 break-all text-xs font-medium text-foreground">
																	{selectedNodeRuntime.docker.containerName}
																</p>
															</div>
															<div className="rounded-md border border-border/60 bg-card p-2">
																<p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
																	Image
																</p>
																<p className="mt-1 break-all text-xs font-medium text-foreground">
																	{selectedNodeRuntime.docker.image}
																</p>
															</div>
															<div className="rounded-md border border-border/60 bg-card p-2">
																<p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
																	Container Status
																</p>
																<p className="mt-1 break-all text-xs font-medium text-foreground">
																	{selectedNodeRuntime.docker.status}
																</p>
															</div>
															<div className="rounded-md border border-border/60 bg-card p-2">
																<p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
																	Network Mode
																</p>
																<p className="mt-1 break-all text-xs font-medium text-foreground">
																	{selectedNodeRuntime.docker.networkMode ??
																		"n/a"}
																</p>
															</div>
															<div className="rounded-md border border-border/60 bg-card p-2">
																<p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
																	Networks
																</p>
																<p className="mt-1 break-all text-xs font-medium text-foreground">
																	{selectedNodeRuntime.docker.networks.length >
																	0
																		? selectedNodeRuntime.docker.networks
																				.map((network) =>
																					network.ipAddress
																						? `${network.name} (${network.ipAddress})`
																						: network.name,
																				)
																				.join(", ")
																		: "n/a"}
																</p>
															</div>
														</div>
														{selectedNodeRuntime.docker.note && (
															<p className="text-xs text-muted-foreground">
																{selectedNodeRuntime.docker.note}
															</p>
														)}
													</div>
												)}
											</div>
										)}
									</CardContent>
								</Card>
							</section>
						</>
					) : activeTab === "stats" ? (
						<section className="space-y-4">
							<div>
								<h2 className="text-xl font-semibold text-foreground">
									HAProxy Stats
								</h2>
								<p className="text-sm text-muted-foreground">
									Live stats dashboard with Graph View (socket/CSV) and Classic
									View (iframe).
								</p>
								<a
									href={HAPROXY_STATS_SETUP_DOCS_URL}
									target="_blank"
									rel="noopener noreferrer"
									className="mt-2 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
								>
									How to configure HAProxy Stats dashboard
								</a>
								{showMonitoredWarning && (
									<span className="mt-2 inline-flex rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-200">
										Monitored node selected: stats/config actions may be
										limited.
									</span>
								)}
							</div>

							<Card>
								<CardContent className="grid gap-3 pt-6 md:grid-cols-[1fr_auto]">
									<div className="space-y-2">
										<p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
											Display Mode
										</p>
										<div className="flex flex-wrap gap-2">
											<Button
												type="button"
												variant={statsView === "auto" ? "default" : "outline"}
												size="sm"
												onClick={() => setStatsView("auto")}
											>
												Auto
											</Button>
											<Button
												type="button"
												variant={statsView === "graph" ? "default" : "outline"}
												size="sm"
												onClick={() => setStatsView("graph")}
												disabled={!supportsGraphView}
											>
												Graph
											</Button>
											<Button
												type="button"
												variant={
													statsView === "classic" ? "default" : "outline"
												}
												size="sm"
												onClick={() => setStatsView("classic")}
												disabled={!supportsClassicView}
											>
												Classic
											</Button>
											<Button
												type="button"
												variant={statsView === "split" ? "default" : "outline"}
												size="sm"
												onClick={() => setStatsView("split")}
												disabled={!(supportsGraphView && supportsClassicView)}
											>
												Split
											</Button>
										</div>
									</div>

									<div className="space-y-2">
										<p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
											Graph Source
										</p>
										<div className="flex flex-wrap gap-2">
											<Button
												type="button"
												variant={statsSource === "auto" ? "default" : "outline"}
												size="sm"
												onClick={() => setStatsSource("auto")}
											>
												Auto
											</Button>
											<Button
												type="button"
												variant={
													statsSource === "socket" ? "default" : "outline"
												}
												size="sm"
												onClick={() => setStatsSource("socket")}
												disabled={!statsCapabilities?.supportsSocket}
											>
												Socket
											</Button>
											<Button
												type="button"
												variant={statsSource === "url" ? "default" : "outline"}
												size="sm"
												onClick={() => setStatsSource("url")}
												disabled={!statsCapabilities?.supportsUrl}
											>
												URL
											</Button>
										</div>
									</div>
								</CardContent>
							</Card>

							{statsLoading && (
								<div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
									Loading stats capabilities...
								</div>
							)}

							{statsCapabilities?.notes &&
								statsCapabilities.notes.length > 0 && (
									<div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
										{statsCapabilities.notes.join(" ")}
									</div>
								)}

							{statsError && (
								<div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
									<AlertTriangle className="h-4 w-4" />
									{statsError}
								</div>
							)}

							{(resolvedStatsView === "graph" ||
								resolvedStatsView === "split") &&
								(statsSnapshot?.snapshot ? (
									<HAProxyStatsGraphs
										snapshot={statsSnapshot.snapshot}
										history={statsHistory}
										dataSource={statsSnapshot.dataSource}
									/>
								) : (
									<div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
										Waiting for graph data snapshot...
									</div>
								))}

							{(resolvedStatsView === "classic" ||
								resolvedStatsView === "split") &&
								supportsClassicView &&
								statsUiSrc && (
									<iframe
										title="HAProxy Stats Dashboard"
										src={statsUiSrc}
										className="h-[calc(100vh-180px)] w-full rounded-lg border border-border bg-white"
										sandbox="allow-same-origin allow-scripts allow-forms"
									/>
								)}

							{resolvedStatsView === "none" && (
								<div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
									No HAProxy stats source is available for this node yet.
									Configure a stats socket or stats URL in Node Configuration.
								</div>
							)}
						</section>
					) : activeTab === "config" ? (
						<section className="space-y-4">
							<div>
								<h2 className="text-xl font-semibold text-foreground">
									HAProxy Config Management
								</h2>
								<p className="text-sm text-muted-foreground">
									Create and edit files from the selected node config root with
									Monaco editor and reload HAProxy when ready.
								</p>
								{showMonitoredWarning && (
									<span className="mt-2 inline-flex rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-200">
										Monitored node selected: configuration and reload actions
										are restricted.
									</span>
								)}
							</div>

							<Suspense fallback={<DashboardSkeleton />}>
								<HAProxyConfigEditor
									selectedNodeId={selectedNodeId}
									selectedNodeName={selectedNode?.name ?? null}
									selectedNodeIsRemote={Boolean(
										selectedNode && !selectedNode.isLocalService,
									)}
									selectedNodeConfigPath={
										selectedNode?.haproxyConfigPath ?? null
									}
								/>
							</Suspense>
						</section>
					) : activeTab === "logs" ? (
						<section className="space-y-4">
							<div>
								<h2 className="text-xl font-semibold text-foreground">
									HAProxy Logs
								</h2>
								<p className="text-sm text-muted-foreground">
									Read logs from a file path or Docker container with optional
									realtime polling.
								</p>
								{showMonitoredWarning && (
									<span className="mt-2 inline-flex rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-200">
										Monitored node selected: log actions may be restricted.
									</span>
								)}
							</div>

							<Suspense fallback={<DashboardSkeleton />}>
								<HAProxyLogViewer
									selectedNodeId={selectedNodeId}
									selectedNodeName={selectedNode?.name ?? null}
									selectedNodeLogPath={selectedNode?.haproxyLogPath ?? null}
									selectedNodeLogSource={selectedNode?.haproxyLogSource ?? null}
									selectedNodeContainerRef={
										selectedNode?.haproxyContainerRef ?? null
									}
								/>
							</Suspense>
						</section>
					) : activeTab === "node-config" ? (
						<Suspense fallback={<DashboardSkeleton />}>
							<NodeConfiguration
								nodes={summary.nodes}
								selectedNode={selectedNode}
								onSaved={handleNodeConfigSaved}
								onNodeCreated={handleNodeCreated}
								onNodeDeleted={handleNodeDeleted}
							/>
						</Suspense>
					) : (
						<Suspense fallback={<DashboardSkeleton />}>
							<UserAccount />
						</Suspense>
					)}
				</main>
			</div>
		</div>
	);
}
