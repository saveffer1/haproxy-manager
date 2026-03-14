import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { redis } from "../database/redis";
import { env } from "../lib/env";
import { ensureSshKeyPair } from "./sshService";

const execFileAsync = promisify(execFile);

type ExecError = Error & {
	code?: number | string;
	stdout?: string;
	stderr?: string;
};

type ConfigFilePath = {
	relativePath: string;
	absPath: string;
};

export type HAProxyStats = {
	status: string;
	uptime?: string;
	active_sessions: number;
	connections_rate: number;
	version?: string;
	pids?: string;
	nodeRuntime?: HAProxyNodeRuntimeDetails;
	warning?: string;
};

export type HAProxyNodeRuntimeDetailItem = {
	label: string;
	value: string;
};

export type DockerRuntimeNetwork = {
	name: string;
	ipAddress?: string;
};

export type DockerRuntimeDetails = {
	containerId: string;
	containerName: string;
	image: string;
	status: string;
	startedAt?: string;
	createdAt?: string;
	networkMode?: string;
	networks: DockerRuntimeNetwork[];
	uptime?: string;
	note?: string;
};

export type HAProxyNodeRuntimeDetails = {
	nodeId: string;
	nodeName: string;
	nodeType: "managed" | "monitored";
	source: "manual" | "docker" | "remote" | "api";
	collectedAt: string;
	detailItems: HAProxyNodeRuntimeDetailItem[];
	docker?: DockerRuntimeDetails;
	note?: string;
};

export type HAProxyConfig = {
	maxconn: number;
	timeout: {
		connect: number;
		client: number;
		server: number;
	};
	balance: string;
};

export type HAProxyBackend = {
	name: string;
	servers: Array<{
		name: string;
		status: string;
		sessions: number;
		bytes_in: number;
		bytes_out: number;
	}>;
};

export type HAProxyConfigFile = {
	path: string;
	size: number;
	updatedAt: string;
};

export type HAProxyNodeRuntimeConfig = {
	id: string;
	name: string;
	ipAddress: string;
	isLocalService: boolean;
	type: "managed" | "monitored";
	source: "manual" | "docker" | "remote" | "api";
	logStrategy: "docker" | "file" | "journald";
	haproxyStatsUrl: string | null;
	haproxyApiUrl: string | null;
	haproxyContainerRef: string | null;
	haproxyConfigPath: string | null;
	haproxyLogPath: string | null;
	haproxyLogSource: "container" | "forwarded";
	sshUser: string | null;
	sshPort: number | null;
};

type DockerContainerListItem = {
	id: string;
	name: string;
	image: string;
	status: string;
};

export class HAProxyService {
	private socketPath = env.HAPROXY_SOCKET_PATH;
	private socketEnabled = env.HAPROXY_SOCKET_ENABLED;
	private remoteConfigCacheTtlSec = 30;

	private shouldUseSshForConfig(nodeConfig?: HAProxyNodeRuntimeConfig) {
		return Boolean(nodeConfig && !nodeConfig.isLocalService);
	}

	private quoteForSh(value: string) {
		return `'${value.replace(/'/g, `'"'"'`)}'`;
	}

	private getRemoteConfigCacheKey(
		nodeConfig: HAProxyNodeRuntimeConfig,
		suffix: string,
	) {
		return [
			"haproxy",
			"remote-config",
			nodeConfig.id,
			nodeConfig.ipAddress,
			suffix,
		].join(":");
	}

	private async readJsonCache<T>(key: string): Promise<T | null> {
		try {
			const raw = await redis.get(key);
			if (!raw) {
				return null;
			}

			return JSON.parse(raw) as T;
		} catch {
			return null;
		}
	}

	private async writeJsonCache(key: string, value: unknown): Promise<void> {
		try {
			await redis.set(key, JSON.stringify(value));
			await redis.expire(key, this.remoteConfigCacheTtlSec);
		} catch {
			// Ignore cache write failures; requests should still succeed without cache.
		}
	}

	private resolveRemoteConfigRoot(nodeConfig: HAProxyNodeRuntimeConfig) {
		const configured = nodeConfig.haproxyConfigPath?.trim() || "";
		if (!configured) {
			throw new Error(
				"Selected node has no HAProxy config path configured. Please set it in Node Configuration.",
			);
		}

		const normalized = configured.replace(/\\/g, "/").replace(/\/+$/, "");
		if (!normalized.startsWith("/")) {
			throw new Error(
				"Remote HAProxy config path must be an absolute Linux path, e.g. /etc/haproxy/conf.d",
			);
		}

		return normalized;
	}

	private normalizeRemoteConfigFilePath(
		rawPath: string,
		nodeConfig: HAProxyNodeRuntimeConfig,
	): ConfigFilePath {
		const configRoot = this.resolveRemoteConfigRoot(nodeConfig);
		const normalizedPath = rawPath.trim().replace(/\\/g, "/");

		if (!normalizedPath) {
			throw new Error("Config file path is required");
		}

		if (
			normalizedPath.includes("..") ||
			normalizedPath.startsWith("/") ||
			normalizedPath.startsWith(".")
		) {
			throw new Error("Invalid config file path");
		}

		if (!normalizedPath.toLowerCase().endsWith(".cfg")) {
			throw new Error("Only .cfg files are allowed");
		}

		const relativePath = normalizedPath.split("/").filter(Boolean).join("/");
		if (!relativePath) {
			throw new Error("Invalid config file path");
		}

		const absPath = path.posix.join(configRoot, relativePath);
		if (!(absPath === configRoot || absPath.startsWith(`${configRoot}/`))) {
			throw new Error("Config file path escapes conf.d directory");
		}

		return {
			relativePath,
			absPath,
		};
	}

	private async executeSshCommand(
		nodeConfig: HAProxyNodeRuntimeConfig,
		command: string,
	) {
		const host = nodeConfig.ipAddress.trim();
		if (!host) {
			throw new Error("Node host is required for SSH operations");
		}

		const user = (nodeConfig.sshUser?.trim() || "root").replace(/\s+/g, "");
		const defaultPort = Number.parseInt(env.SSH_DEFAULT_PORT, 10);
		const requestedPort = Number.isFinite(nodeConfig.sshPort)
			? Number(nodeConfig.sshPort)
			: defaultPort;
		const port = Number.isFinite(requestedPort)
			? Math.max(1, requestedPort)
			: 22;
		const timeoutSec = Number.parseInt(env.SSH_CONNECT_TIMEOUT_SEC, 10) || 8;
		const { privateKeyPath } = await ensureSshKeyPair();
		const remoteCommand = `sh -lc ${this.quoteForSh(command)}`;

		try {
			const { stdout } = await execFileAsync(
				"ssh",
				[
					"-i",
					privateKeyPath,
					"-p",
					String(port),
					"-o",
					"BatchMode=yes",
					"-o",
					"IdentitiesOnly=yes",
					"-o",
					`ConnectTimeout=${Math.max(timeoutSec, 1)}`,
					"-o",
					"StrictHostKeyChecking=accept-new",
					`${user}@${host}`,
					remoteCommand,
				],
				{
					timeout: Math.max(timeoutSec, 1) * 1000 + 3000,
					windowsHide: true,
				},
			);

			return stdout;
		} catch (error) {
			const execError = error as ExecError;
			const stderr = execError.stderr?.trim() || "";
			const rawMessage =
				error instanceof Error ? error.message : "SSH command failed";
			const details = stderr || rawMessage;
			throw new Error(`SSH command failed for ${user}@${host}:${port}: ${details}`);
		}
	}

	private resolveConfigDir(customPath?: string | null) {
		const configured = customPath?.trim() || env.HAPROXY_CONFIG_DIR;

		if (path.isAbsolute(configured)) {
			return configured;
		}

		const directCandidate = path.resolve(process.cwd(), configured);
		if (existsSync(directCandidate)) {
			return directCandidate;
		}

		const workspaceCandidate = path.resolve(
			process.cwd(),
			"..",
			"..",
			configured,
		);
		if (existsSync(workspaceCandidate)) {
			return workspaceCandidate;
		}

		return directCandidate;
	}

	private isExpectedSocketError(error: unknown) {
		if (!(error instanceof Error)) {
			return false;
		}

		const code = (error as Error & { code?: string }).code;
		return (
			code === "ENOENT" ||
			code === "ECONNREFUSED" ||
			code === "EACCES" ||
			error.message.includes("socket is disabled")
		);
	}

	private formatDuration(totalSeconds: number) {
		if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
			return "n/a";
		}

		const days = Math.floor(totalSeconds / 86400);
		const hours = Math.floor((totalSeconds % 86400) / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = Math.floor(totalSeconds % 60);

		const parts: string[] = [];
		if (days > 0) parts.push(`${days}d`);
		if (hours > 0) parts.push(`${hours}h`);
		if (minutes > 0) parts.push(`${minutes}m`);
		if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

		return parts.join(" ");
	}

	private parseStatsUrlHost(value: string | null) {
		const raw = value?.trim();
		if (!raw) {
			return null;
		}

		try {
			const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
			return parsed.hostname.toLowerCase();
		} catch {
			return null;
		}
	}

	private formatDockerTimestamp(value?: string) {
		if (!value) {
			return undefined;
		}

		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) {
			return undefined;
		}

		return parsed.toISOString();
	}

	private parseDockerPsRows(stdout: string) {
		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [id = "", names = "", image = "", status = "", ports = ""] =
					line.split("\t");
				return { id, names, image, status, ports };
			});
	}

	private pickDockerContainer(
		rows: Array<{
			id: string;
			names: string;
			image: string;
			status: string;
			ports: string;
		}>,
		nodeConfig: HAProxyNodeRuntimeConfig,
	) {
		const statsHost = this.parseStatsUrlHost(nodeConfig.haproxyStatsUrl);
		const normalizedNodeName = nodeConfig.name.trim().toLowerCase();
		const normalizedNodeIp = nodeConfig.ipAddress.trim().toLowerCase();
		const configuredRef = nodeConfig.haproxyContainerRef?.trim().toLowerCase() || "";

		const scored = rows.map((container) => {
			const containerName = container.names.toLowerCase();
			const containerId = container.id.toLowerCase();
			const image = container.image.toLowerCase();
			const ports = container.ports.toLowerCase();

			let score = 0;

			if (configuredRef) {
				if (containerName === configuredRef || containerId === configuredRef) {
					score += 1000;
				} else if (
					containerName.includes(configuredRef) ||
					containerId.startsWith(configuredRef)
				) {
					score += 800;
				}
			}

			if (normalizedNodeName && containerName === normalizedNodeName) {
				score += 140;
			}
			if (
				normalizedNodeName &&
				normalizedNodeName.length > 2 &&
				containerName.includes(normalizedNodeName)
			) {
				score += 90;
			}
			if (statsHost && containerName.includes(statsHost)) {
				score += 100;
			}
			if (image.includes("haproxy")) {
				score += 50;
			}
			if (containerName.includes("haproxy")) {
				score += 40;
			}
			if (ports.includes(":8404")) {
				score += 55;
			}
			if (ports.includes(":8080")) {
				score += 35;
			}
			if (
				normalizedNodeIp &&
				normalizedNodeIp !== "127.0.0.1" &&
				normalizedNodeIp !== "localhost" &&
				ports.includes(normalizedNodeIp)
			) {
				score += 45;
			}

			return {
				...container,
				score,
			};
		});

		scored.sort((a, b) => b.score - a.score);

		return (
			scored.find((row) => row.score > 0) ??
			scored.find((row) => row.image.toLowerCase().includes("haproxy")) ??
			scored[0]
		);
	}

	private async collectDockerRuntimeDetails(
		nodeConfig: HAProxyNodeRuntimeConfig,
	) {
		try {
			const psCommand =
				"docker ps -a --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'";

			const stdout = this.shouldUseSshForConfig(nodeConfig)
				? await this.executeSshCommand(nodeConfig, psCommand)
				: (
						await execFileAsync("docker", [
							"ps",
							"-a",
							"--no-trunc",
							"--format",
							"{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}",
						], {
							timeout: 8000,
							windowsHide: true,
						})
					).stdout;

			const rows = this.parseDockerPsRows(stdout);

			if (rows.length === 0) {
				return {
					note: "Docker CLI is available, but no containers were found.",
				};
			}

			const picked = this.pickDockerContainer(rows, nodeConfig);

			if (!picked) {
				return {
					note: "Unable to resolve a matching Docker container for this node.",
				};
			}

			const inspectStdout = this.shouldUseSshForConfig(nodeConfig)
				? await this.executeSshCommand(
						nodeConfig,
						`docker inspect ${this.quoteForSh(picked.id)}`,
					)
				: (
						await execFileAsync("docker", ["inspect", picked.id], {
							timeout: 8000,
							windowsHide: true,
						})
					).stdout;

			const inspectResult = JSON.parse(inspectStdout) as Array<{
				Id?: string;
				Name?: string;
				Created?: string;
				Config?: {
					Image?: string;
				};
				State?: {
					Status?: string;
					StartedAt?: string;
				};
				HostConfig?: {
					NetworkMode?: string;
				};
				NetworkSettings?: {
					Networks?: Record<string, { IPAddress?: string }>;
				};
			}>;

			const container = inspectResult[0];
			if (!container) {
				return {
					note: "Docker inspect returned no container data.",
				};
			}

			const startedAt = this.formatDockerTimestamp(container.State?.StartedAt);
			const createdAt = this.formatDockerTimestamp(container.Created);

			let uptime: string | undefined;
			if (startedAt) {
				const startedAtMs = new Date(startedAt).getTime();
				if (Number.isFinite(startedAtMs)) {
					const diffSeconds = Math.max(
						0,
						Math.floor((Date.now() - startedAtMs) / 1000),
					);
					uptime = this.formatDuration(diffSeconds);
				}
			}

			const networks = Object.entries(
				container.NetworkSettings?.Networks ?? {},
			).map(([name, config]) => ({
				name,
				ipAddress: config.IPAddress || undefined,
			}));

			return {
				docker: {
					containerId: (container.Id || picked.id).slice(0, 12),
					containerName:
						container.Name?.replace(/^\//, "") || picked.names || "unknown",
					image: container.Config?.Image || picked.image || "unknown",
					status: container.State?.Status || picked.status || "unknown",
					startedAt,
					createdAt,
					networkMode: container.HostConfig?.NetworkMode,
					networks,
					uptime,
					note:
						picked.score < 120
							? "Container match is heuristic. Rename node to container name for precise matching."
							: undefined,
				},
			};
		} catch (error) {
			const execError = error as ExecError;
			const combinedMessage = [
				execError.message,
				execError.stderr,
				execError.stdout,
			]
				.filter((item): item is string => Boolean(item?.trim()))
				.join(" ")
				.toLowerCase();

			if (
				combinedMessage.includes("enoent") ||
				combinedMessage.includes("not recognized") ||
				combinedMessage.includes("cannot find")
			) {
				return {
					note: "Docker CLI is not available on the backend host.",
				};
			}

			return {
				note:
					execError.stderr?.trim() ||
					execError.message ||
					"Unable to read Docker runtime details.",
			};
		}
	}

	private async buildNodeRuntimeDetails(nodeConfig: HAProxyNodeRuntimeConfig) {
		const detailItems: HAProxyNodeRuntimeDetailItem[] = [
			{ label: "Node Type", value: nodeConfig.type },
			{ label: "Source", value: nodeConfig.source },
			{ label: "Node Host", value: nodeConfig.ipAddress },
			{
				label: "Local Service",
				value: nodeConfig.isLocalService ? "yes" : "no",
			},
			{ label: "Log Strategy", value: nodeConfig.logStrategy },
			{
				label: "Stats URL",
				value: nodeConfig.haproxyStatsUrl?.trim() || "not set",
			},
			{
				label: "API URL",
				value: nodeConfig.haproxyApiUrl?.trim() || "not set",
			},
			{
				label: "HAProxy Container",
				value: nodeConfig.haproxyContainerRef?.trim() || "auto-discover",
			},
			{
				label: "Config Path",
				value: nodeConfig.haproxyConfigPath?.trim() || "not set",
			},
			{
				label: "Log Path",
				value: nodeConfig.haproxyLogPath?.trim() || "not set",
			},
			{ label: "Log Source", value: nodeConfig.haproxyLogSource },
			{
				label: "SSH User",
				value: nodeConfig.sshUser?.trim() || "not set",
			},
			{
				label: "SSH Port",
				value:
					typeof nodeConfig.sshPort === "number"
						? String(nodeConfig.sshPort)
						: env.SSH_DEFAULT_PORT,
			},
		];

		const runtime: HAProxyNodeRuntimeDetails = {
			nodeId: nodeConfig.id,
			nodeName: nodeConfig.name,
			nodeType: nodeConfig.type,
			source: nodeConfig.source,
			collectedAt: new Date().toISOString(),
			detailItems,
		};

		if (nodeConfig.source !== "docker") {
			if (nodeConfig.source === "remote") {
				runtime.note =
					"Remote node mode: runtime/container metadata depends on remote integrations and may be limited.";
			}

			if (nodeConfig.source === "api") {
				runtime.note =
					"API node mode: runtime metadata must be provided by upstream APIs.";
			}

			return runtime;
		}

		const dockerRuntime = await this.collectDockerRuntimeDetails(nodeConfig);
		if (dockerRuntime.docker) {
			runtime.docker = dockerRuntime.docker;
		}
		if (dockerRuntime.note) {
			runtime.note = dockerRuntime.note;
		}

		return runtime;
	}

	private parseInfoResponse(response: string) {
		const info: Record<string, string> = {};

		for (const rawLine of response.split("\n")) {
			const line = rawLine.trim();
			if (!line) {
				continue;
			}

			const separator = line.indexOf(":");
			if (separator <= 0) {
				continue;
			}

			const key = line.slice(0, separator).trim();
			const value = line.slice(separator + 1).trim();
			if (key) {
				info[key] = value;
			}
		}

		return info;
	}

	private parseStatResponse(response: string) {
		const lines = response
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);

		const headerLine = lines.find((line) => line.startsWith("#"));
		if (!headerLine) {
			throw new Error("Invalid HAProxy stats response: missing headers");
		}

		const headers = headerLine.replace(/^#\s*/, "").split(",");
		const dataLines = lines.filter((line) => !line.startsWith("#"));

		if (dataLines.length === 0) {
			throw new Error("Invalid HAProxy stats response: missing data rows");
		}

		const rows = dataLines.map((line) => {
			const values = line.split(",");
			const row: Record<string, string> = {};
			for (let i = 0; i < headers.length; i++) {
				const header = headers[i]?.trim();
				if (!header) {
					continue;
				}
				row[header] = values[i]?.trim() ?? "";
			}
			return row;
		});

		return rows;
	}

	private resolveNodeStatsUrl(nodeConfig: HAProxyNodeRuntimeConfig) {
		const rawStatsUrl = nodeConfig.haproxyStatsUrl?.trim();
		if (!rawStatsUrl) {
			return null;
		}

		let url: URL;
		try {
			url = new URL(rawStatsUrl);
		} catch {
			url = new URL(`http://${rawStatsUrl}`);
		}

		return url;
	}

	private async fetchStatsOverHttp(nodeConfig: HAProxyNodeRuntimeConfig) {
		const statsUrl = this.resolveNodeStatsUrl(nodeConfig);
		if (!statsUrl) {
			return null;
		}

		const basicAuth = Buffer.from(
			`${env.HAPROXY_STATS_USERNAME}:${env.HAPROXY_STATS_PASSWORD}`,
		).toString("base64");

		const csvUrl = new URL(statsUrl.toString());
		csvUrl.pathname = "/stats;csv";

		const csvResponse = await fetch(csvUrl.toString(), {
			headers: {
				Authorization: `Basic ${basicAuth}`,
			},
		});

		if (!csvResponse.ok) {
			throw new Error(
				`HAProxy stats CSV upstream returned ${csvResponse.status}`,
			);
		}

		const htmlResponse = await fetch(statsUrl.toString(), {
			headers: {
				Authorization: `Basic ${basicAuth}`,
			},
		});

		if (!htmlResponse.ok) {
			throw new Error(`HAProxy stats upstream returned ${htmlResponse.status}`);
		}

		const csvText = await csvResponse.text();
		const html = await htmlResponse.text();
		const uptimeMatch = html.match(/uptime\s*=\s*([^<\n]+)/i);
		const uptime = uptimeMatch?.[1]?.trim() || "n/a";

		return {
			csvText,
			uptime,
		};
	}

	/**
	 * Connect to HAProxy stats socket and execute a command
	 * Returns the raw response from HAProxy
	 */
	private async executeSocketCommand(command: string): Promise<string> {
		if (!this.socketEnabled) {
			throw new Error("HAProxy socket is disabled by configuration");
		}

		try {
			const net = await import("node:net");
			return new Promise((resolve, reject) => {
				const socket = net.createConnection(this.socketPath, () => {
					socket.write(`${command}\n`);
					socket.end();
				});

				let response = "";
				socket.on("data", (data) => {
					response += data.toString();
				});

				socket.on("end", () => {
					resolve(response);
				});

				socket.on("error", (error) => {
					reject(error);
				});

				// Timeout after 5 seconds
				setTimeout(() => {
					socket.destroy();
					reject(new Error("HAProxy socket timeout"));
				}, 5000);
			});
		} catch (error) {
			if (this.isExpectedSocketError(error)) {
				throw error;
			}

			console.error("Unexpected HAProxy socket error:", error);
			throw new Error("Failed to connect to HAProxy socket");
		}
	}

	/**
	 * Get HAProxy statistics from the stats socket
	 * Uses the 'show stat' command
	 */
	async getStats(nodeConfig?: HAProxyNodeRuntimeConfig): Promise<HAProxyStats> {
		try {
			if (nodeConfig) {
				const nodeRuntime = await this.buildNodeRuntimeDetails(nodeConfig);
				const statsUrl = this.resolveNodeStatsUrl(nodeConfig);
				if (!statsUrl) {
					return {
						status: "not-configured",
						uptime: nodeRuntime.docker?.uptime || "n/a",
						active_sessions: 0,
						connections_rate: 0,
						nodeRuntime,
						warning:
							"HAProxy stats URL is not configured for this node. Runtime information is shown where available.",
					};
				}

				let remoteStats: Awaited<ReturnType<typeof this.fetchStatsOverHttp>>;
				try {
					remoteStats = await this.fetchStatsOverHttp(nodeConfig);
				} catch (error) {
					const warning =
						error instanceof Error
							? `Unable to fetch HAProxy stats from ${statsUrl.toString()}: ${error.message}`
							: `Unable to fetch HAProxy stats from ${statsUrl.toString()}`;

					return {
						status: "degraded",
						uptime: nodeRuntime.docker?.uptime || "n/a",
						active_sessions: 0,
						connections_rate: 0,
						nodeRuntime,
						warning,
					};
				}

				if (!remoteStats) {
					return {
						status: "not-configured",
						uptime: nodeRuntime.docker?.uptime || "n/a",
						active_sessions: 0,
						connections_rate: 0,
						nodeRuntime,
						warning:
							"HAProxy stats URL is not configured for this node. Runtime information is shown where available.",
					};
				}

				const rows = this.parseStatResponse(remoteStats.csvText);
				const frontendRows = rows.filter((row) => row.svname === "FRONTEND");
				const rowsForCounters = frontendRows.length > 0 ? frontendRows : rows;

				const activeConn = rowsForCounters.reduce((sum, row) => {
					return sum + (parseInt(row.scur || "0", 10) || 0);
				}, 0);

				const connectRate = rowsForCounters.reduce((sum, row) => {
					return sum + (parseInt(row.rate || "0", 10) || 0);
				}, 0);

				const statusCandidates = rows
					.map((row) => row.status)
					.filter((value): value is string => Boolean(value));

				const hasOnlineStatus = statusCandidates.some((value) => {
					const upper = value.toUpperCase();
					return upper.includes("UP") || upper.includes("OPEN");
				});

				return {
					status: hasOnlineStatus ? "online" : "offline",
					uptime: nodeRuntime.docker?.uptime || remoteStats.uptime,
					active_sessions: activeConn,
					connections_rate: connectRate,
					nodeRuntime,
				};
			}

			const [statResponse, infoResponse] = await Promise.all([
				this.executeSocketCommand("show stat"),
				this.executeSocketCommand("show info"),
			]);

			const rows = this.parseStatResponse(statResponse);
			const info = this.parseInfoResponse(infoResponse);

			const frontendRows = rows.filter((row) => row.svname === "FRONTEND");
			const rowsForCounters = frontendRows.length > 0 ? frontendRows : rows;

			const activeConn = rowsForCounters.reduce((sum, row) => {
				return sum + (parseInt(row.scur || "0", 10) || 0);
			}, 0);

			const connectRate = rowsForCounters.reduce((sum, row) => {
				return sum + (parseInt(row.rate || "0", 10) || 0);
			}, 0);

			const statusCandidates = rows
				.map((row) => row.status)
				.filter((value): value is string => Boolean(value));
			const hasOnlineStatus = statusCandidates.some((value) => {
				const upper = value.toUpperCase();
				return upper.includes("UP") || upper.includes("OPEN");
			});

			const isStopping = info.Stopping === "1";
			const uptimeSeconds = parseInt(info.Uptime_sec || "0", 10) || 0;
			const formattedUptime = this.formatDuration(uptimeSeconds);

			const status = isStopping
				? "stopping"
				: hasOnlineStatus
					? "online"
					: "offline";

			return {
				status,
				uptime: formattedUptime,
				active_sessions: activeConn,
				connections_rate: connectRate,
				version: info.Version || undefined,
				pids: info.Pid || undefined,
			};
		} catch (error) {
			if (!this.isExpectedSocketError(error)) {
				console.error("Error fetching HAProxy stats:", error);
			}

			// Return fallback data if socket unavailable
			return {
				status: "offline",
				uptime: "n/a",
				active_sessions: 0,
				connections_rate: 0,
			};
		}
	}

	/**
	 * Get HAProxy configuration
	 */
	async getConfig(): Promise<HAProxyConfig> {
		try {
			// For now, return known configuration from the config file
			// In production, could parse the actual haproxy.cfg
			return {
				maxconn: 4096,
				timeout: {
					connect: 5000,
					client: 50000,
					server: 50000,
				},
				balance: "roundrobin",
			};
		} catch (error) {
			console.error("Error fetching HAProxy config:", error);
			throw new Error("Failed to fetch HAProxy configuration");
		}
	}

	/**
	 * Get detailed backend information with servers
	 */
	async getBackends(
		_nodeConfig?: HAProxyNodeRuntimeConfig,
	): Promise<HAProxyBackend[]> {
		try {
			const response = await this.executeSocketCommand("show stat");
			const lines = response.split("\n").filter((l) => l && !l.startsWith("#"));

			if (lines.length === 0) {
				return [];
			}

			const headers = lines[0].split(",");
			const backends: Map<string, HAProxyBackend> = new Map();

			// Parse each stat line
			for (let i = 1; i < lines.length; i++) {
				const values = lines[i].split(",");
				const pxname = values[headers.indexOf("pxname")]?.trim();
				const svname = values[headers.indexOf("svname")]?.trim();
				const status = values[headers.indexOf("status")]?.trim();
				const scur = parseInt(values[headers.indexOf("scur")]?.trim(), 10) || 0;
				const bin = parseInt(values[headers.indexOf("bin")]?.trim(), 10) || 0;
				const bout = parseInt(values[headers.indexOf("bout")]?.trim(), 10) || 0;

				if (svname !== "BACKEND" && pxname) {
					if (!backends.has(pxname)) {
						backends.set(pxname, {
							name: pxname,
							servers: [],
						});
					}

					backends.get(pxname)?.servers.push({
						name: svname,
						status: status || "unknown",
						sessions: scur,
						bytes_in: bin,
						bytes_out: bout,
					});
				}
			}

			return Array.from(backends.values());
		} catch (error) {
			if (!this.isExpectedSocketError(error)) {
				console.error("Error fetching HAProxy backends:", error);
			}

			return [];
		}
	}

	/**
	 * Enable/Disable a server via socket command
	 */
	async setServerState(
		backend: string,
		server: string,
		state: "enable" | "disable",
	): Promise<boolean> {
		try {
			const command = `${state} server ${backend}/${server}`;
			const response = await this.executeSocketCommand(command);

			return !response.includes("error");
		} catch (error) {
			console.error(`Error setting server state:`, error);
			throw new Error(`Failed to ${state} server`);
		}
	}

	private async listRemoteDockerContainers(
		nodeConfig: HAProxyNodeRuntimeConfig,
	): Promise<DockerContainerListItem[]> {
		const stdout = await this.executeSshCommand(
			nodeConfig,
			"docker ps --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'",
		);

		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [id = "", name = "", image = "", status = ""] =
					line.split("\t");
				return {
					id: id.trim(),
					name: name.trim(),
					image: image.trim(),
					status: status.trim(),
				};
			})
			.filter((item) => Boolean(item.name));
	}

	private formatContainerChoices(containers: DockerContainerListItem[]) {
		return containers
			.slice(0, 8)
			.map(
				(container) =>
					`${container.name} [${container.id.slice(0, 12)}] (${container.image})`,
			)
			.join(", ");
	}

	private async resolveRemoteReloadTarget(
		nodeConfig: HAProxyNodeRuntimeConfig,
	): Promise<string> {
		const containers = await this.listRemoteDockerContainers(nodeConfig);
		const haproxyContainers = containers.filter((container) => {
			const name = container.name.toLowerCase();
			const image = container.image.toLowerCase();
			return name.includes("haproxy") || image.includes("haproxy");
		});

		if (haproxyContainers.length === 0) {
			throw new Error(
				"No running HAProxy container found on remote node. Ensure docker is installed and container name/image includes 'haproxy'.",
			);
		}

		const configuredRef = nodeConfig.haproxyContainerRef?.trim() || "";
		if (configuredRef) {
			const normalizedRef = configuredRef.toLowerCase();
			const matched = haproxyContainers.filter((container) => {
				const name = container.name.toLowerCase();
				const id = container.id.toLowerCase();
				return name === normalizedRef || id.startsWith(normalizedRef);
			});

			if (matched.length === 1 && matched[0]) {
				return matched[0].name;
			}

			if (matched.length > 1) {
				const choices = this.formatContainerChoices(matched);
				throw new Error(
					`Container reference '${configuredRef}' matched multiple HAProxy containers: ${choices}. Use full container name or longer container ID prefix.`,
				);
			}

			const choices = this.formatContainerChoices(haproxyContainers);
			throw new Error(
				`Configured container reference '${configuredRef}' was not found among running HAProxy containers: ${choices}`,
			);
		}

		const nodeName = nodeConfig.name.trim().toLowerCase();
		if (nodeName) {
			const exact = haproxyContainers.filter(
				(container) => container.name.toLowerCase() === nodeName,
			);
			if (exact.length === 1 && exact[0]) {
				return exact[0].name;
			}

			const partial = haproxyContainers.filter((container) =>
				container.name.toLowerCase().includes(nodeName),
			);
			if (partial.length === 1 && partial[0]) {
				return partial[0].name;
			}
		}

		if (haproxyContainers.length === 1 && haproxyContainers[0]) {
			return haproxyContainers[0].name;
		}

		const choices = this.formatContainerChoices(haproxyContainers);
		throw new Error(
			`Multiple HAProxy containers found on remote node: ${choices}. Set 'HAProxy Container (Name or ID)' in Node Configuration for deterministic reload.`,
		);
	}

	private async validateRemoteConfig(
		nodeConfig: HAProxyNodeRuntimeConfig,
		targetContainer: string,
	) {
		const validationScript = [
			"if ! command -v haproxy >/dev/null 2>&1; then",
			"  echo 'haproxy binary not found in container' >&2",
			"  exit 127",
			"fi",
			"for cfg in /usr/local/etc/haproxy/haproxy.cfg /etc/haproxy/haproxy.cfg; do",
			"  if [ -f \"$cfg\" ]; then",
			"    haproxy -c -f \"$cfg\"",
			"    exit $?",
			"  fi",
			"done",
			"echo 'No haproxy.cfg found in common paths' >&2",
			"exit 1",
		].join("; ");

		await this.executeSshCommand(
			nodeConfig,
			`docker exec ${this.quoteForSh(targetContainer)} sh -lc ${this.quoteForSh(validationScript)}`,
		);
	}

	async reloadConfig(nodeConfig?: HAProxyNodeRuntimeConfig): Promise<boolean> {
		if (nodeConfig && this.shouldUseSshForConfig(nodeConfig)) {
			try {
				const targetContainer = await this.resolveRemoteReloadTarget(nodeConfig);
				await this.validateRemoteConfig(nodeConfig, targetContainer);
				await this.executeSshCommand(
					nodeConfig,
					`docker restart ${this.quoteForSh(targetContainer)}`,
				);
				console.log(
					`HAProxy container '${targetContainer}' reloaded on remote node ${nodeConfig.name}`,
				);
				return true;
			} catch (error) {
				console.error("Error reloading remote HAProxy config:", error);
				throw new Error(
					error instanceof Error
						? error.message
						: "Failed to reload remote HAProxy configuration",
				);
			}
		}

		try {
			const { exec } = await import("node:child_process");
			const { promisify } = await import("node:util");

			const execAsync = promisify(exec);
			const command = env.HAPROXY_RELOAD_COMMAND.trim();

			if (!command) {
				throw new Error("HAProxy reload command is not configured");
			}

			await this.validateConfig();

			await execAsync(command, {
				cwd: process.cwd(),
				timeout: 15_000,
			});

			console.log("HAProxy config reloaded successfully");
			return true;
		} catch (error) {
			console.error("Error reloading HAProxy config:", error);
			throw new Error("Failed to reload HAProxy configuration");
		}
	}

	private async validateConfig(): Promise<void> {
		const { exec } = await import("node:child_process");
		const { promisify } = await import("node:util");

		const execAsync = promisify(exec);
		const command = env.HAPROXY_VALIDATE_COMMAND.trim();

		if (!command) {
			throw new Error("HAProxy validation command is not configured");
		}

		try {
			await execAsync(command, {
				cwd: process.cwd(),
				timeout: 15_000,
			});
		} catch (error) {
			const commandError = error as {
				stderr?: string;
				stdout?: string;
				message?: string;
			};

			const details =
				commandError.stderr?.trim() ||
				commandError.stdout?.trim() ||
				commandError.message ||
				"Unknown validation error";

			throw new Error(`HAProxy config validation failed: ${details}`);
		}
	}

	private normalizeConfigFilePath(
		rawPath: string,
		configDirOverride?: string | null,
	): ConfigFilePath {
		const configDir = this.resolveConfigDir(configDirOverride);
		const normalizedPath = rawPath.trim().replace(/\\/g, "/");

		if (!normalizedPath) {
			throw new Error("Config file path is required");
		}

		if (
			normalizedPath.includes("..") ||
			normalizedPath.startsWith("/") ||
			normalizedPath.startsWith(".")
		) {
			throw new Error("Invalid config file path");
		}

		if (!normalizedPath.toLowerCase().endsWith(".cfg")) {
			throw new Error("Only .cfg files are allowed");
		}

		const normalized = normalizedPath.split("/").filter(Boolean).join("/");
		if (!normalized) {
			throw new Error("Invalid config file path");
		}

		const joined = path.join(configDir, normalized);
		const resolvedRoot = path.resolve(configDir);
		const resolvedFile = path.resolve(joined);

		if (!resolvedFile.startsWith(resolvedRoot)) {
			throw new Error("Config file path escapes conf.d directory");
		}

		return {
			relativePath: normalized,
			absPath: resolvedFile,
		};
	}

	private async walkConfigFiles(
		dirPath: string,
		rootPath: string,
		files: HAProxyConfigFile[],
	): Promise<void> {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");

		const entries = await fs.readdir(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const absEntryPath = path.join(dirPath, entry.name);

			if (entry.isDirectory()) {
				await this.walkConfigFiles(absEntryPath, rootPath, files);
				continue;
			}

			if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".cfg")) {
				continue;
			}

			const stat = await fs.stat(absEntryPath);
			const relativePath = path
				.relative(rootPath, absEntryPath)
				.replace(/\\/g, "/");

			files.push({
				path: relativePath,
				size: stat.size,
				updatedAt: stat.mtime.toISOString(),
			});
		}
	}

	async listConfigFiles(
		nodeConfig?: HAProxyNodeRuntimeConfig,
		options?: {
			forceRefresh?: boolean;
		},
	): Promise<HAProxyConfigFile[]> {
		if (nodeConfig && this.shouldUseSshForConfig(nodeConfig)) {
			const cacheKey = this.getRemoteConfigCacheKey(nodeConfig, "file-list");
			if (!options?.forceRefresh) {
				const cached = await this.readJsonCache<HAProxyConfigFile[]>(cacheKey);
				if (cached) {
					return cached;
				}
			}

			const configRoot = this.resolveRemoteConfigRoot(nodeConfig);
			const command = `if [ -d ${this.quoteForSh(configRoot)} ]; then find ${this.quoteForSh(configRoot)} -type f -name '*.cfg' -exec stat -c '%n\t%s\t%Y' {} ';'; fi`;
			const stdout = await this.executeSshCommand(nodeConfig, command);

			const rows = stdout
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean);

			const parsed: HAProxyConfigFile[] = [];
			for (const row of rows) {
				const [absPath = "", sizeRaw = "0", mtimeRaw = "0"] = row.split("\t");
				if (!absPath.startsWith(configRoot)) {
					continue;
				}

				const relativePath = path
					.posix.relative(configRoot, absPath)
					.replace(/\\/g, "/");
				if (!relativePath || relativePath.startsWith("..")) {
					continue;
				}

				const mtimeSec = Number.parseInt(mtimeRaw, 10);
				const updatedAt = Number.isFinite(mtimeSec)
					? new Date(mtimeSec * 1000).toISOString()
					: new Date(0).toISOString();

				parsed.push({
					path: relativePath,
					size: Number.parseInt(sizeRaw, 10) || 0,
					updatedAt,
				});
			}

			const sorted = parsed.sort((a, b) => a.path.localeCompare(b.path));
			await this.writeJsonCache(cacheKey, sorted);
			return sorted;
		}

		const fs = await import("node:fs/promises");
		const configDir = this.resolveConfigDir(nodeConfig?.haproxyConfigPath);

		await fs.mkdir(configDir, { recursive: true });

		const files: HAProxyConfigFile[] = [];
		await this.walkConfigFiles(configDir, configDir, files);

		return files.sort((a, b) => a.path.localeCompare(b.path));
	}

	async getConfigFileContent(
		filePath: string,
		nodeConfig?: HAProxyNodeRuntimeConfig,
		options?: {
			forceRefresh?: boolean;
		},
	): Promise<string> {
		if (nodeConfig && this.shouldUseSshForConfig(nodeConfig)) {
			const target = this.normalizeRemoteConfigFilePath(filePath, nodeConfig);
			const cacheKey = this.getRemoteConfigCacheKey(
				nodeConfig,
				`content:${target.relativePath}`,
			);
			if (!options?.forceRefresh) {
				const cached = await this.readJsonCache<{ content: string }>(cacheKey);
				if (cached?.content !== undefined) {
					return cached.content;
				}
			}

			const command = `cat -- ${this.quoteForSh(target.absPath)}`;
			const content = await this.executeSshCommand(nodeConfig, command);
			await this.writeJsonCache(cacheKey, { content });
			return content;
		}

		const fs = await import("node:fs/promises");
		const target = this.normalizeConfigFilePath(
			filePath,
			nodeConfig?.haproxyConfigPath,
		);

		return fs.readFile(target.absPath, "utf8");
	}

	async saveConfigFile(
		filePath: string,
		content: string,
		nodeConfig?: HAProxyNodeRuntimeConfig,
	): Promise<void> {
		if (nodeConfig && this.shouldUseSshForConfig(nodeConfig)) {
			throw new Error(
				"Saving config files for remote SSH nodes is not supported yet. Use SSH directly or run backend on the target host.",
			);
		}

		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const target = this.normalizeConfigFilePath(
			filePath,
			nodeConfig?.haproxyConfigPath,
		);
		const previousContent = await fs.readFile(target.absPath, "utf8");

		await fs.mkdir(path.dirname(target.absPath), { recursive: true });
		await fs.writeFile(target.absPath, content, "utf8");

		try {
			await this.validateConfig();
		} catch (error) {
			await fs.writeFile(target.absPath, previousContent, "utf8");
			throw new Error(
				error instanceof Error
					? `${error.message}. Save was rolled back.`
					: "HAProxy config validation failed. Save was rolled back.",
			);
		}
	}

	async createConfigFile(
		filePath: string,
		content = "",
		nodeConfig?: HAProxyNodeRuntimeConfig,
	): Promise<void> {
		if (nodeConfig && this.shouldUseSshForConfig(nodeConfig)) {
			throw new Error(
				"Creating config files for remote SSH nodes is not supported yet. Use SSH directly or run backend on the target host.",
			);
		}

		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const target = this.normalizeConfigFilePath(
			filePath,
			nodeConfig?.haproxyConfigPath,
		);

		await fs.mkdir(path.dirname(target.absPath), { recursive: true });
		const handle = await fs.open(target.absPath, "wx");
		try {
			if (content) {
				await handle.writeFile(content, "utf8");
			}
		} finally {
			await handle.close();
		}

		try {
			await this.validateConfig();
		} catch (error) {
			await fs.rm(target.absPath, { force: true });
			throw new Error(
				error instanceof Error
					? `${error.message}. File creation was rolled back.`
					: "HAProxy config validation failed. File creation was rolled back.",
			);
		}
	}

	async deleteConfigFile(
		filePath: string,
		nodeConfig?: HAProxyNodeRuntimeConfig,
	): Promise<void> {
		if (nodeConfig && this.shouldUseSshForConfig(nodeConfig)) {
			throw new Error(
				"Deleting config files for remote SSH nodes is not supported yet. Use SSH directly or run backend on the target host.",
			);
		}

		const fs = await import("node:fs/promises");
		const target = this.normalizeConfigFilePath(
			filePath,
			nodeConfig?.haproxyConfigPath,
		);
		const previousContent = await fs.readFile(target.absPath, "utf8");
		await fs.rm(target.absPath, { force: false });

		try {
			await this.validateConfig();
		} catch (error) {
			await fs.writeFile(target.absPath, previousContent, "utf8");
			throw new Error(
				error instanceof Error
					? `${error.message}. Delete was rolled back.`
					: "HAProxy config validation failed. Delete was rolled back.",
			);
		}
	}
}

export const haproxyService = new HAProxyService();
