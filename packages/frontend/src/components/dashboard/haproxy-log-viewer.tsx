import { Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	type HAProxyLogContainer,
	type HAProxyLogSource,
	listHAProxyLogContainers,
	listHAProxyLogFiles,
	readHAProxyLogs,
} from "@/lib/api";

type HAProxyLogViewerProps = {
	selectedNodeId: string | null;
	selectedNodeName: string | null;
	selectedNodeLogPath: string | null;
	selectedNodeLogSource: "container" | "forwarded" | null;
	selectedNodeContainerRef: string | null;
};

const DEFAULT_LINE_LIMIT = 200;
const DEFAULT_POLL_MS = 2000;

function normalizeSource(
	source: "container" | "forwarded" | null,
): HAProxyLogSource {
	return source === "container" ? "container" : "file";
}

function getContainerLabel(container: HAProxyLogContainer) {
	const shortId = container.id ? container.id.slice(0, 12) : "unknown";
	return `${container.name} (${shortId})`;
}

export default function HAProxyLogViewer({
	selectedNodeId,
	selectedNodeName,
	selectedNodeLogPath,
	selectedNodeLogSource,
	selectedNodeContainerRef,
}: HAProxyLogViewerProps) {
	const [source, setSource] = useState<HAProxyLogSource>(
		normalizeSource(selectedNodeLogSource),
	);
	const [filePath, setFilePath] = useState(selectedNodeLogPath ?? "");
	const [containerRef, setContainerRef] = useState(
		selectedNodeContainerRef ?? "",
	);
	const [lineLimitInput, setLineLimitInput] = useState(
		String(DEFAULT_LINE_LIMIT),
	);
	const [realtime, setRealtime] = useState(false);
	const [logText, setLogText] = useState("");
	const [resolvedTarget, setResolvedTarget] = useState<string | null>(null);
	const [resolvedFilePath, setResolvedFilePath] = useState<string | null>(null);
	const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
	const [containers, setContainers] = useState<HAProxyLogContainer[]>([]);
	const [selectableFiles, setSelectableFiles] = useState<string[]>([]);
	const [loadingContainers, setLoadingContainers] = useState(false);
	const [loadingSelectableFiles, setLoadingSelectableFiles] = useState(false);
	const [loadingLogs, setLoadingLogs] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const pollTimerRef = useRef<number | null>(null);
	const requestSequenceRef = useRef(0);
	const inFlightRequestRef = useRef(false);
	const logOutputRef = useRef<HTMLPreElement | null>(null);

	useEffect(() => {
		setSource(normalizeSource(selectedNodeLogSource));
		setFilePath(selectedNodeLogPath ?? "");
		setContainerRef(selectedNodeContainerRef ?? "");
		setLogText("");
		setResolvedTarget(null);
		setResolvedFilePath(null);
		setSelectableFiles([]);
		setLastFetchedAt(null);
		setError(null);
		setNotice(null);
	}, [selectedNodeContainerRef, selectedNodeLogPath, selectedNodeLogSource]);

	const parsedLineLimit = useMemo(() => {
		const parsed = Number.parseInt(lineLimitInput.trim(), 10);
		if (!Number.isFinite(parsed)) {
			return DEFAULT_LINE_LIMIT;
		}

		return Math.max(10, Math.min(2000, parsed));
	}, [lineLimitInput]);

	const clearMessages = useCallback(() => {
		setError(null);
		setNotice(null);
	}, []);

	const fetchContainers = useCallback(async () => {
		if (!selectedNodeId || source !== "container") {
			setContainers([]);
			return;
		}

		setLoadingContainers(true);
		clearMessages();
		try {
			const items = await listHAProxyLogContainers(selectedNodeId);
			setContainers(items);

			if (!containerRef && items.length > 0 && items[0]) {
				setContainerRef(items[0].name);
			}
		} catch (loadError) {
			setError(
				loadError instanceof Error
					? loadError.message
					: "Failed to load Docker containers",
			);
		} finally {
			setLoadingContainers(false);
		}
	}, [clearMessages, containerRef, selectedNodeId, source]);

	const fetchLogs = useCallback(async () => {
		if (inFlightRequestRef.current) {
			return;
		}

		if (!selectedNodeId) {
			setError("Please select a node first.");
			return;
		}

		if (source === "file" && !filePath.trim()) {
			setError("Please provide a log file path.");
			return;
		}

		const requestSequence = ++requestSequenceRef.current;
		inFlightRequestRef.current = true;
		setLoadingLogs(true);
		clearMessages();
		try {
			const result = await readHAProxyLogs({
				nodeId: selectedNodeId,
				source,
				filePath: source === "file" ? filePath : undefined,
				containerRef: source === "container" ? containerRef : undefined,
				lines: parsedLineLimit,
			});

			if (requestSequence !== requestSequenceRef.current) {
				return;
			}

			setResolvedTarget(result.target);
			setResolvedFilePath(result.resolvedFilePath ?? null);
			setLastFetchedAt(result.fetchedAt);
			setLogText(result.lines.join("\n"));
			if (source === "container" && result.target.trim()) {
				setContainerRef(result.target);
			}
			setNotice(
				result.lines.length === 0
					? "No log lines returned for the selected target."
					: `Loaded ${result.lines.length} lines.`,
			);
		} catch (loadError) {
			if (requestSequence !== requestSequenceRef.current) {
				return;
			}

			setError(
				loadError instanceof Error ? loadError.message : "Failed to load logs",
			);
		} finally {
			inFlightRequestRef.current = false;
			if (requestSequence === requestSequenceRef.current) {
				setLoadingLogs(false);
			}
		}
	}, [
		clearMessages,
		containerRef,
		filePath,
		parsedLineLimit,
		selectedNodeId,
		source,
	]);

	const fetchSelectableFiles = useCallback(async () => {
		if (!selectedNodeId) {
			setError("Please select a node first.");
			return;
		}

		if (source !== "file") {
			setSelectableFiles([]);
			return;
		}

		if (!filePath.trim()) {
			setError("Please provide a file or folder path first.");
			return;
		}

		setLoadingSelectableFiles(true);
		clearMessages();
		try {
			const files = await listHAProxyLogFiles(selectedNodeId, filePath);
			setSelectableFiles(files);

			if (files.length === 0) {
				setNotice("No selectable log files found for this path.");
				return;
			}

			if (!files.includes(filePath) && files[0]) {
				setFilePath(files[0]);
			}

			setNotice(`Found ${files.length} selectable log file(s).`);
		} catch (loadError) {
			setError(
				loadError instanceof Error
					? loadError.message
					: "Failed to list selectable log files",
			);
		} finally {
			setLoadingSelectableFiles(false);
		}
	}, [clearMessages, filePath, selectedNodeId, source]);

	useEffect(() => {
		void fetchContainers();
	}, [fetchContainers]);

	useEffect(() => {
		if (!realtime) {
			if (pollTimerRef.current !== null) {
				window.clearInterval(pollTimerRef.current);
				pollTimerRef.current = null;
			}
			return;
		}

		const readyForRealtime =
			Boolean(selectedNodeId) &&
			(source === "file" ? Boolean(filePath.trim()) : true);
		if (!readyForRealtime) {
			if (pollTimerRef.current !== null) {
				window.clearInterval(pollTimerRef.current);
				pollTimerRef.current = null;
			}
			return;
		}

		void fetchLogs();
		pollTimerRef.current = window.setInterval(() => {
			void fetchLogs();
		}, DEFAULT_POLL_MS);

		return () => {
			if (pollTimerRef.current !== null) {
				window.clearInterval(pollTimerRef.current);
				pollTimerRef.current = null;
			}
		};
	}, [fetchLogs, filePath, realtime, selectedNodeId, source]);

	useEffect(() => {
		if (!realtime || !logOutputRef.current || !logText) {
			return;
		}

		logOutputRef.current.scrollTop = logOutputRef.current.scrollHeight;
	}, [logText, realtime]);

	useEffect(() => {
		if (source !== "file") {
			setSelectableFiles([]);
		}
	}, [source]);

	const activeSourceLabel =
		source === "container" ? "Docker Container" : "Log File";
	const lastFetchedLabel = lastFetchedAt
		? new Date(lastFetchedAt).toLocaleTimeString()
		: "-";
	const hasRequiredInputs =
		Boolean(selectedNodeId) &&
		(source === "file" ? Boolean(filePath.trim()) : true);

	return (
		<div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Log Source</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
							Node
						</p>
						<p className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
							{selectedNodeName ?? "No node selected"}
						</p>
					</div>

					<div className="space-y-2">
						<label
							htmlFor="log-source"
							className="text-xs uppercase tracking-[0.12em] text-muted-foreground"
						>
							Source
						</label>
						<select
							id="log-source"
							value={source}
							onChange={(event) =>
								setSource(event.target.value as HAProxyLogSource)
							}
							className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
						>
							<option value="file">File Path</option>
							<option value="container">Docker Container</option>
						</select>
					</div>

					{source === "file" ? (
						<div className="space-y-2">
							<label
								htmlFor="log-file-path"
								className="text-xs uppercase tracking-[0.12em] text-muted-foreground"
							>
								Log File Path
							</label>
							<div className="flex gap-2">
								<Input
									id="log-file-path"
									value={filePath}
									onChange={(event) => setFilePath(event.target.value)}
									placeholder="/var/log/haproxy or /var/log/haproxy.log"
								/>
								<Button
									type="button"
									variant="outline"
									onClick={() => void fetchSelectableFiles()}
									disabled={
										loadingSelectableFiles ||
										!selectedNodeId ||
										!filePath.trim()
									}
								>
									{loadingSelectableFiles ? (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									) : null}
									Select
								</Button>
							</div>
							{selectableFiles.length > 0 && (
								<div className="space-y-2">
									<label
										htmlFor="log-file-select"
										className="text-xs uppercase tracking-[0.12em] text-muted-foreground"
									>
										Selectable Files
									</label>
									<select
										id="log-file-select"
										value={filePath}
										onChange={(event) => setFilePath(event.target.value)}
										className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
									>
										{selectableFiles.map((item) => (
											<option key={item} value={item}>
												{item}
											</option>
										))}
									</select>
								</div>
							)}
						</div>
					) : (
						<div className="space-y-2">
							<div className="flex items-center justify-between gap-2">
								<label
									htmlFor="container-select"
									className="text-xs uppercase tracking-[0.12em] text-muted-foreground"
								>
									Container
								</label>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => void fetchContainers()}
									disabled={loadingContainers || !selectedNodeId}
								>
									{loadingContainers ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										<RefreshCw className="h-3.5 w-3.5" />
									)}
								</Button>
							</div>
							<select
								id="container-select"
								value={containerRef}
								onChange={(event) => setContainerRef(event.target.value)}
								className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
							>
								<option value="">Choose container...</option>
								{containers.map((container) => (
									<option key={container.id} value={container.name}>
										{getContainerLabel(container)}
									</option>
								))}
							</select>
						</div>
					)}

					<div className="space-y-2">
						<label
							htmlFor="line-limit"
							className="text-xs uppercase tracking-[0.12em] text-muted-foreground"
						>
							Line Limit
						</label>
						<Input
							id="line-limit"
							type="number"
							min={10}
							max={2000}
							value={lineLimitInput}
							onChange={(event) => setLineLimitInput(event.target.value)}
						/>
					</div>

					<label className="flex items-center gap-2 text-sm text-foreground">
						<input
							type="checkbox"
							checked={realtime}
							onChange={(event) => setRealtime(event.target.checked)}
							className="h-4 w-4 rounded border-border"
						/>
						Realtime (auto refresh every 2s)
					</label>

					<div className="grid grid-cols-2 gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={() => void fetchLogs()}
							disabled={loadingLogs || !hasRequiredInputs}
						>
							{loadingLogs ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Search className="mr-2 h-4 w-4" />
							)}
							Read Logs
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								setLogText("");
								setResolvedTarget(null);
								setResolvedFilePath(null);
								setLastFetchedAt(null);
								clearMessages();
							}}
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Clear
						</Button>
					</div>

					{notice && (
						<p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
							{notice}
						</p>
					)}
					{error && (
						<p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
							{error}
						</p>
					)}
				</CardContent>
			</Card>

			<Card className="min-h-[560px]">
				<CardHeader>
					<CardTitle className="text-base">Live Output</CardTitle>
					<p className="text-xs text-muted-foreground">
						Source: {activeSourceLabel} | Target: {resolvedTarget ?? "-"} | Last
						fetch: {lastFetchedLabel}
					</p>
					{source === "file" && resolvedFilePath && (
						<p className="text-xs text-muted-foreground">
							Resolved file: {resolvedFilePath}
						</p>
					)}
				</CardHeader>
				<CardContent>
					<pre
						ref={logOutputRef}
						className="h-[520px] w-full overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground"
					>
						{logText ||
							"No logs loaded yet. Click 'Read Logs' to fetch output."}
					</pre>
				</CardContent>
			</Card>
		</div>
	);
}
