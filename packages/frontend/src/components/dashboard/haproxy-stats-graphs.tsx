import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HAProxyStats } from "@/lib/api";
import { cn } from "@/lib/utils";

type StatsHistoryPoint = {
	timestamp: number;
	activeSessions: number;
	connectionsRate: number;
	throughputInBps: number;
	throughputOutBps: number;
	bytesInCounter: number;
	bytesOutCounter: number;
};

type HAProxyStatsGraphsProps = {
	snapshot: HAProxyStats["snapshot"];
	history: StatsHistoryPoint[];
	dataSource?: HAProxyStats["dataSource"];
};

function formatCompactNumber(value: number) {
	return Intl.NumberFormat("en", {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value);
}

function formatBytesPerSecond(value: number) {
	if (!Number.isFinite(value) || value <= 0) {
		return "0 B/s";
	}

	const units = ["B/s", "KB/s", "MB/s", "GB/s"];
	let current = value;
	let index = 0;
	while (current >= 1024 && index < units.length - 1) {
		current /= 1024;
		index += 1;
	}

	return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[index]}`;
}

function buildSparklinePoints(values: number[], width: number, height: number) {
	if (values.length === 0) {
		return "";
	}

	const max = Math.max(...values, 1);
	const min = Math.min(...values, 0);
	const range = Math.max(max - min, 1);

	return values
		.map((value, index) => {
			const x =
				values.length === 1 ? width : (index / (values.length - 1)) * width;
			const normalized = (value - min) / range;
			const y = height - normalized * height;
			return `${x},${y}`;
		})
		.join(" ");
}

function SparklineCard(props: {
	title: string;
	value: string;
	series: number[];
	lineClassName: string;
}) {
	const width = 320;
	const height = 90;
	const points = buildSparklinePoints(props.series, width, height);

	return (
		<Card>
			<CardHeader className="pb-2">
				<CardTitle className="text-sm font-semibold text-muted-foreground">
					{props.title}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="text-2xl font-semibold tracking-tight text-foreground">
					{props.value}
				</p>
				<div className="h-[90px] rounded-md border border-border/70 bg-muted/25 p-2">
					<svg
						viewBox={`0 0 ${width} ${height}`}
						className="h-full w-full"
						preserveAspectRatio="none"
					>
						<title>{`${props.title} trend`}</title>
						<polyline
							fill="none"
							strokeWidth="3"
							points={points}
							className={cn("stroke-primary", props.lineClassName)}
						/>
					</svg>
				</div>
			</CardContent>
		</Card>
	);
}

export function HAProxyStatsGraphs({
	snapshot,
	history,
	dataSource,
}: HAProxyStatsGraphsProps) {
	if (!snapshot) {
		return null;
	}

	const sourceLabel =
		dataSource === "socket"
			? "Unix Socket"
			: dataSource === "url"
				? "Stats URL"
				: "Unknown";

	return (
		<div className="space-y-4">
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-semibold text-muted-foreground">
							Data Source
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-xl font-semibold text-foreground">
							{sourceLabel}
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-semibold text-muted-foreground">
							Backend Health
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-xl font-semibold text-foreground">
							UP {snapshot.health.up} / DOWN {snapshot.health.down}
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-semibold text-muted-foreground">
							Queue
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-xl font-semibold text-foreground">
							{snapshot.totals.queueCurrent} / {snapshot.totals.queueMax}
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-semibold text-muted-foreground">
							Errors
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-xl font-semibold text-foreground">
							{snapshot.totals.errors}
						</p>
					</CardContent>
				</Card>
			</div>

			<div className="grid gap-3 lg:grid-cols-3">
				<SparklineCard
					title="Active Sessions"
					value={formatCompactNumber(snapshot.totals.activeSessions)}
					series={history.map((point) => point.activeSessions)}
					lineClassName="stroke-cyan-500"
				/>
				<SparklineCard
					title="Connection Rate"
					value={`${formatCompactNumber(snapshot.totals.connectionsRate)}/s`}
					series={history.map((point) => point.connectionsRate)}
					lineClassName="stroke-emerald-500"
				/>
				<SparklineCard
					title="Throughput"
					value={`${formatBytesPerSecond(history.at(-1)?.throughputInBps ?? 0)} in / ${formatBytesPerSecond(history.at(-1)?.throughputOutBps ?? 0)} out`}
					series={history.map(
						(point) => point.throughputInBps + point.throughputOutBps,
					)}
					lineClassName="stroke-amber-500"
				/>
			</div>

			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-base">Top Active Servers</CardTitle>
				</CardHeader>
				<CardContent className="overflow-x-auto">
					<table className="w-full min-w-[640px] text-sm">
						<thead>
							<tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted-foreground">
								<th className="py-2 pr-3">Proxy</th>
								<th className="py-2 pr-3">Server</th>
								<th className="py-2 pr-3">Status</th>
								<th className="py-2 pr-3">Sessions</th>
								<th className="py-2 pr-3">Rate/s</th>
								<th className="py-2 pr-3">Errors</th>
							</tr>
						</thead>
						<tbody>
							{snapshot.servers.map((row) => (
								<tr
									key={`${row.proxy}-${row.server}`}
									className="border-b border-border/60"
								>
									<td className="py-2 pr-3 font-medium text-foreground">
										{row.proxy}
									</td>
									<td className="py-2 pr-3 text-foreground">{row.server}</td>
									<td className="py-2 pr-3 text-muted-foreground">
										{row.status}
									</td>
									<td className="py-2 pr-3 text-foreground">
										{row.activeSessions}
									</td>
									<td className="py-2 pr-3 text-foreground">
										{row.connectionsRate}
									</td>
									<td className="py-2 pr-3 text-foreground">{row.errors}</td>
								</tr>
							))}
						</tbody>
					</table>
				</CardContent>
			</Card>
		</div>
	);
}

export type { StatsHistoryPoint };
