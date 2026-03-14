import { AlertTriangle, Server, ShieldCheck, Users } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { StatsCard } from "@/components/dashboard/stats-card";
import { type DashboardTab, Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	type DashboardSummary,
	getDashboardSummary,
	getHAProxyStatsDashboardHtml,
} from "@/lib/api";
import { env } from "@/lib/env";
import { useAuth } from "@/providers/auth-provider";
import { useTheme } from "@/providers/theme-provider";

const QuickActions = lazy(() => import("@/components/dashboard/quick-actions"));

const initialState: DashboardSummary = {
	health: null,
	stats: null,
	nodes: [],
};

export default function DashboardPage() {
	const { logout } = useAuth();
	const { theme } = useTheme();
	const [searchParams, setSearchParams] = useSearchParams();
	const [mobileOpen, setMobileOpen] = useState(false);
	const [loading, setLoading] = useState(true);
	const [summary, setSummary] = useState<DashboardSummary>(initialState);
	const [statsError, setStatsError] = useState<string | null>(null);
	const [statsLoading, setStatsLoading] = useState(false);

	const activeTab = useMemo<DashboardTab>(() => {
		const tab = searchParams.get("tab");
		return tab === "stats" ? "stats" : "overview";
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

	useEffect(() => {
		let mounted = true;
		setLoading(true);

		getDashboardSummary()
			.then((response) => {
				if (mounted) {
					setSummary(response);
				}
			})
			.finally(() => {
				if (mounted) {
					setLoading(false);
				}
			});

		return () => {
			mounted = false;
		};
	}, []);

	useEffect(() => {
		if (activeTab !== "stats" || statsLoading) {
			return;
		}

		let mounted = true;
		setStatsLoading(true);
		setStatsError(null);

		getHAProxyStatsDashboardHtml(theme)
			.then(() => {
				// We don't need to store HTML; the iframe will load the stats UI directly.
			})
			.catch((error) => {
				if (mounted) {
					setStatsError(
						error instanceof Error
							? error.message
							: "Unable to load HAProxy stats screen",
					);
				}
			})
			.finally(() => {
				if (mounted) {
					setStatsLoading(false);
				}
			});

		return () => {
			mounted = false;
		};
	}, [activeTab, statsLoading, theme]);

	const statsCards = useMemo(
		() => [
			{
				title: "API Health",
				icon: ShieldCheck,
				value: summary.health?.status ?? "Unknown",
				hint: summary.health ? "Backend reachable" : "Waiting for backend",
				state: summary.health ? "ok" : "warn",
			},
			{
				title: "HAProxy",
				icon: Server,
				value: summary.stats?.status ?? "Unknown",
				hint: summary.stats ? summary.stats.uptime : "No stats available",
				state: summary.stats ? "ok" : "warn",
			},
			{
				title: "Active Sessions",
				icon: Users,
				value: String(summary.stats?.active_sessions ?? 0),
				hint: "Current live sessions",
				state: "neutral",
			},
			{
				title: "Nodes",
				icon: Server,
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
		const query = new URLSearchParams({ theme });
		return `${env.VITE_BACKEND_URL}/haproxy/stats/ui?${query.toString()}`;
	}, [theme]);

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

							<section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
								{statsCards.map((item, index) => (
									<div
										key={item.title}
										style={{ animationDelay: `${index * 60}ms` }}
									>
										<div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-muted-foreground">
											<item.icon className="h-4 w-4" />
											{item.title}
										</div>
										<StatsCard
											title={item.title}
											value={item.value}
											hint={item.hint}
											state={item.state as "ok" | "warn" | "neutral"}
										/>
									</div>
								))}
							</section>

							<section className="grid gap-4 lg:grid-cols-3">
								<Card className="lg:col-span-2">
									<CardHeader>
										<CardTitle>Recent Nodes</CardTitle>
									</CardHeader>
									<CardContent>
										{summary.nodes.length === 0 ? (
											<p className="text-sm text-muted-foreground">
												No nodes available yet. Add nodes from backend API.
											</p>
										) : (
											<div className="space-y-2">
												{summary.nodes.slice(0, 6).map((node) => (
													<div
														key={node.id}
														className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background p-3"
													>
														<div>
															<p className="font-medium text-foreground">
																{node.name}
															</p>
															<p className="text-sm text-muted-foreground">
																{node.ipAddress}
															</p>
														</div>
														<div className="rounded-full bg-secondary px-3 py-1 text-xs uppercase tracking-wide text-secondary-foreground">
															{node.type}
														</div>
													</div>
												))}
											</div>
										)}
									</CardContent>
								</Card>

								<Suspense fallback={<DashboardSkeleton />}>
									<QuickActions onOpenStats={() => setActiveTab("stats")} />
								</Suspense>
							</section>
						</>
					) : (
						<section className="space-y-4">
							<div>
								<h2 className="text-xl font-semibold text-foreground">
									HAProxy Stats
								</h2>
								<p className="text-sm text-muted-foreground">
									Live stats dashboard rendered inside your secure workspace.
								</p>
							</div>

							{statsLoading && (
								<div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
									Loading stats dashboard...
								</div>
							)}

							{statsError && (
								<div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
									<AlertTriangle className="h-4 w-4" />
									{statsError}
								</div>
							)}

							{!statsError && (
								<iframe
									title="HAProxy Stats Dashboard"
									src={statsUiSrc}
									className="h-[calc(100vh-180px)] w-full rounded-lg border border-border bg-white"
									sandbox="allow-same-origin allow-scripts allow-forms"
								/>
							)}
						</section>
					)}
				</main>
			</div>
		</div>
	);
}
