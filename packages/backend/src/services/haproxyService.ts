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
	dataSource?: HAProxyStatsDataSource;
	snapshot?: HAProxyStatsSnapshot;
	nodeRuntime?: HAProxyNodeRuntimeDetails;
	warning?: string;
};

export type HAProxyStatsDataSource = "socket" | "url" | "none";
export type HAProxyStatsRequestedSource = "auto" | "socket" | "url";

export type HAProxyStatsSnapshot = {
	collectedAt: string;
	totals: {
		activeSessions: number;
		connectionsRate: number;
		bytesIn: number;
		bytesOut: number;
		queueCurrent: number;
		queueMax: number;
		errors: number;
	};
	httpResponses: {
		xx2: number;
		xx3: number;
		xx4: number;
		xx5: number;
		other: number;
	};
	health: {
		up: number;
		down: number;
		other: number;
	};
	servers: Array<{
		proxy: string;
		server: string;
		status: string;
		activeSessions: number;
		connectionsRate: number;
		bytesIn: number;
		bytesOut: number;
		errors: number;
	}>;
};

export type HAProxyStatsCapabilities = {
	supportsSocket: boolean;
	supportsUrl: boolean;
	availableViews: Array<"graph" | "classic">;
	defaultSource: "socket" | "url" | "none";
	notes: string[];
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

export type RemoteConfigMutationFeedback = {
	mode: "remote";
	action: "save" | "create" | "delete";
	sshTarget: string;
	container: string;
	path: string;
	validation: "passed";
	rollbackApplied: boolean;
	details: string[];
	validationOutput?: string;
};

export type HAProxyLogSource = "container" | "file";

export type HAProxyLogContainer = {
	id: string;
	name: string;
	image: string;
	status: string;
};

export type HAProxyLogReadResult = {
	source: HAProxyLogSource;
	target: string;
	resolvedFilePath?: string;
	lines: string[];
	fetchedAt: string;
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
	haproxySocketPath: string | null;
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

type HAProxySocketTarget =
	| { kind: "unix"; path: string }
	| { kind: "tcp"; host: string; port: number };

export class HAProxyService {
	private socketPath = env.HAPROXY_SOCKET_PATH;
	private socketEnabled = env.HAPROXY_SOCKET_ENABLED;
	private remoteConfigCacheTtlSec = 30;

	private resolveSocketPath(nodeConfig?: HAProxyNodeRuntimeConfig) {
		if (nodeConfig) {
			const scopedPath = nodeConfig.haproxySocketPath?.trim();
			return scopedPath || null;
		}

		if (!this.socketEnabled) {
			return null;
		}

		const globalPath = this.socketPath.trim();
		return globalPath || null;
	}

	private resolveSocketTarget(rawSocketPath: string): HAProxySocketTarget {
		const normalized = rawSocketPath.trim();
		if (!normalized) {
			throw new Error("HAProxy socket path is not configured");
		}

		if (normalized.startsWith("/")) {
			return {
				kind: "unix",
				path: normalized,
			};
		}

		const bracketIpv6Match = normalized.match(/^\[([^\]]+)\]:(\d{1,5})$/);
		if (bracketIpv6Match?.[1] && bracketIpv6Match[2]) {
			const port = Number.parseInt(bracketIpv6Match[2], 10);
			if (Number.isInteger(port) && port >= 1 && port <= 65535) {
				return {
					kind: "tcp",
					host: bracketIpv6Match[1],
					port,
				};
			}
		}

		const hostPortMatch = normalized.match(/^([^\s:]+):(\d{1,5})$/);
		if (hostPortMatch?.[1] && hostPortMatch[2]) {
			const port = Number.parseInt(hostPortMatch[2], 10);
			if (Number.isInteger(port) && port >= 1 && port <= 65535) {
				return {
					kind: "tcp",
					host: hostPortMatch[1],
					port,
				};
			}
		}

		return {
			kind: "unix",
			path: normalized,
		};
	}

	private shouldUseSshForConfig(nodeConfig?: HAProxyNodeRuntimeConfig) {
		return Boolean(nodeConfig && !nodeConfig.isLocalService);
	}

	private quoteForSh(value: string) {
		return `'${value.replace(/'/g, `'"'"'`)}'`;
	}

	private resolveSshTarget(nodeConfig: HAProxyNodeRuntimeConfig) {
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

		return {
			host,
			user,
			port,
			timeoutSec: Math.max(timeoutSec, 1),
		};
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

	private async deleteCacheKeys(keys: string[]): Promise<void> {
		if (keys.length === 0) {
			return;
		}

		try {
			await Promise.all(keys.map((key) => redis.del(key)));
		} catch {
			// Ignore cache invalidation failures; requests should still succeed without cache.
		}
	}

	private getRemoteConfigContentCacheKey(
		nodeConfig: HAProxyNodeRuntimeConfig,
		relativePath: string,
	) {
		return this.getRemoteConfigCacheKey(nodeConfig, `content:${relativePath}`);
	}

	private getRemoteConfigListCacheKey(nodeConfig: HAProxyNodeRuntimeConfig) {
		return this.getRemoteConfigCacheKey(nodeConfig, "file-list");
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
		const { host, user, port, timeoutSec } = this.resolveSshTarget(nodeConfig);
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
					timeout: timeoutSec * 1000 + 3000,
					windowsHide: true,
				},
			);

			return stdout;
		} catch (error) {
			const execError = error as ExecError;
			const stderr = execError.stderr?.trim() || "";
			const stdout = execError.stdout?.trim() || "";
			const rawMessage =
				error instanceof Error ? error.message : "SSH command failed";
			const details = [stderr, stdout, rawMessage]
				.filter((item) => item.length > 0)
				.join(" | ");
			throw new Error(
				`SSH command failed for ${user}@${host}:${port}: ${details}`,
			);
		}
	}

	private getRemoteValidationScript() {
		return [
			"if ! command -v haproxy >/dev/null 2>&1; then",
			"  echo 'haproxy binary not found in container' >&2",
			"  exit 127",
			"fi",
			"for cfg in /usr/local/etc/haproxy/haproxy.cfg /etc/haproxy/haproxy.cfg; do",
			'  if [ -f "$cfg" ]; then',
			'    haproxy -c -f "$cfg"',
			"    exit $?",
			"  fi",
			"done",
			"echo 'No haproxy.cfg found in common paths' >&2",
			"exit 1",
		].join("\n");
	}

	private extractValidationConfigArgsFromDockerInspect(
		inspectResult: Array<{
			Path?: string;
			Args?: string[];
		}>,
	) {
		const container = inspectResult[0];
		if (!container) {
			return [] as string[];
		}

		const pathValue = container.Path?.trim() || "";
		const args = Array.isArray(container.Args) ? container.Args : [];

		const normalizedCommand = [pathValue, ...args]
			.map((part) => part.trim())
			.filter(Boolean);

		if (normalizedCommand.length === 0) {
			return [] as string[];
		}

		const configArgs: string[] = [];
		for (let i = 0; i < normalizedCommand.length; i++) {
			const token = normalizedCommand[i];
			if (!token) {
				continue;
			}

			if (token === "-f") {
				const next = normalizedCommand[i + 1];
				if (next && !next.startsWith("-")) {
					configArgs.push("-f", next);
					i += 1;
				}
				continue;
			}

			if (token.startsWith("-f") && token.length > 2) {
				configArgs.push("-f", token.slice(2));
			}
		}

		return configArgs;
	}

	private async buildRemoteValidateDockerCommand(
		nodeConfig: HAProxyNodeRuntimeConfig,
		targetContainer: string,
	) {
		try {
			const inspectStdout = await this.executeSshCommand(
				nodeConfig,
				`docker inspect ${this.quoteForSh(targetContainer)}`,
			);

			const inspectResult = JSON.parse(inspectStdout) as Array<{
				Path?: string;
				Args?: string[];
			}>;

			const configArgs =
				this.extractValidationConfigArgsFromDockerInspect(inspectResult);
			if (configArgs.length > 0) {
				const validationCommand = ["haproxy", "-c", ...configArgs]
					.map((part) => this.quoteForSh(part))
					.join(" ");

				return `docker exec ${this.quoteForSh(targetContainer)} sh -lc ${this.quoteForSh(validationCommand)}`;
			}
		} catch {
			// Fall back to common-path validation script when inspect parsing is not available.
		}

		return `docker exec ${this.quoteForSh(targetContainer)} sh -lc ${this.quoteForSh(this.getRemoteValidationScript())}`;
	}

	private compactRemoteOutput(stdout: string) {
		const normalized = stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);

		if (normalized.length === 0) {
			return undefined;
		}

		return normalized.slice(-3).join(" | ");
	}

	private buildRemoteMutationFeedback(params: {
		action: "save" | "create" | "delete";
		nodeConfig: HAProxyNodeRuntimeConfig;
		targetPath: string;
		targetContainer: string;
		validationOutput?: string;
	}): RemoteConfigMutationFeedback {
		const { user, host, port } = this.resolveSshTarget(params.nodeConfig);
		return {
			mode: "remote",
			action: params.action,
			sshTarget: `${user}@${host}:${port}`,
			container: params.targetContainer,
			path: params.targetPath,
			validation: "passed",
			rollbackApplied: false,
			details: [
				`Remote ${params.action} completed.`,
				`SSH target: ${user}@${host}:${port}`,
				`Container validated: ${params.targetContainer}`,
				`Config path: ${params.targetPath}`,
			],
			validationOutput: params.validationOutput,
		};
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

	private isInvalidStatsResponseError(error: unknown) {
		return (
			error instanceof Error &&
			error.message.startsWith("Invalid HAProxy stats response")
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
		const configuredRef =
			nodeConfig.haproxyContainerRef?.trim().toLowerCase() || "";

		const scored = rows.map((container) => {
			const containerName = container.names.toLowerCase();
			const containerId = container.id.toLowerCase();
			const image = container.image.toLowerCase();
			const imageBase = this.normalizeImageReference(image);
			const ports = container.ports.toLowerCase();

			let score = 0;

			if (configuredRef) {
				if (
					containerName === configuredRef ||
					containerId === configuredRef ||
					image === configuredRef ||
					imageBase === configuredRef
				) {
					score += 1000;
				} else if (
					containerName.includes(configuredRef) ||
					containerId.startsWith(configuredRef) ||
					image.includes(configuredRef) ||
					imageBase.includes(configuredRef)
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
						await execFileAsync(
							"docker",
							[
								"ps",
								"-a",
								"--no-trunc",
								"--format",
								"{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}",
							],
							{
								timeout: 8000,
								windowsHide: true,
							},
						)
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
				label: "Stats Socket",
				value: nodeConfig.haproxySocketPath?.trim() || "not set",
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

	private parseCounter(value: string | undefined) {
		return Number.parseInt(value || "0", 10) || 0;
	}

	private deriveRuntimeStatus(rows: Array<Record<string, string>>) {
		const statusCandidates = rows
			.map((row) => row.status)
			.filter((value): value is string => Boolean(value));

		const hasOnlineStatus = statusCandidates.some((value) => {
			const upper = value.toUpperCase();
			return upper.includes("UP") || upper.includes("OPEN");
		});

		return hasOnlineStatus ? "online" : "offline";
	}

	private buildSnapshotFromRows(
		rows: Array<Record<string, string>>,
	): HAProxyStatsSnapshot {
		const frontendRows = rows.filter((row) => row.svname === "FRONTEND");
		const rowsForCounters = frontendRows.length > 0 ? frontendRows : rows;

		const totals = rowsForCounters.reduce(
			(acc, row) => {
				acc.activeSessions += this.parseCounter(row.scur);
				acc.connectionsRate += this.parseCounter(row.rate);
				acc.bytesIn += this.parseCounter(row.bin);
				acc.bytesOut += this.parseCounter(row.bout);
				acc.queueCurrent += this.parseCounter(row.qcur);
				acc.queueMax += this.parseCounter(row.qmax);
				acc.errors +=
					this.parseCounter(row.econ) +
					this.parseCounter(row.eresp) +
					this.parseCounter(row.ereq) +
					this.parseCounter(row.dreq) +
					this.parseCounter(row.dresp);
				return acc;
			},
			{
				activeSessions: 0,
				connectionsRate: 0,
				bytesIn: 0,
				bytesOut: 0,
				queueCurrent: 0,
				queueMax: 0,
				errors: 0,
			},
		);

		const httpResponses = rowsForCounters.reduce(
			(acc, row) => {
				acc.xx2 += this.parseCounter(row.hrsp_2xx);
				acc.xx3 += this.parseCounter(row.hrsp_3xx);
				acc.xx4 += this.parseCounter(row.hrsp_4xx);
				acc.xx5 += this.parseCounter(row.hrsp_5xx);
				return acc;
			},
			{ xx2: 0, xx3: 0, xx4: 0, xx5: 0, other: 0 },
		);

		const knownResponses =
			httpResponses.xx2 +
			httpResponses.xx3 +
			httpResponses.xx4 +
			httpResponses.xx5;
		httpResponses.other = Math.max(0, totals.connectionsRate - knownResponses);

		const serverRows = rows.filter(
			(row) =>
				row.svname && row.svname !== "FRONTEND" && row.svname !== "BACKEND",
		);

		const health = serverRows.reduce(
			(acc, row) => {
				const status = (row.status || "").toUpperCase();
				if (status.includes("UP") || status.includes("OPEN")) {
					acc.up += 1;
				} else if (
					status.includes("DOWN") ||
					status.includes("MAINT") ||
					status.includes("NOLB")
				) {
					acc.down += 1;
				} else {
					acc.other += 1;
				}
				return acc;
			},
			{ up: 0, down: 0, other: 0 },
		);

		const servers = serverRows
			.map((row) => ({
				proxy: row.pxname || "unknown",
				server: row.svname || "unknown",
				status: row.status || "UNKNOWN",
				activeSessions: this.parseCounter(row.scur),
				connectionsRate: this.parseCounter(row.rate),
				bytesIn: this.parseCounter(row.bin),
				bytesOut: this.parseCounter(row.bout),
				errors:
					this.parseCounter(row.econ) +
					this.parseCounter(row.eresp) +
					this.parseCounter(row.ereq) +
					this.parseCounter(row.dreq) +
					this.parseCounter(row.dresp),
			}))
			.sort((a, b) => b.connectionsRate - a.connectionsRate)
			.slice(0, 12);

		return {
			collectedAt: new Date().toISOString(),
			totals,
			httpResponses,
			health,
			servers,
		};
	}

	private buildStatsFromRows(
		rows: Array<Record<string, string>>,
		params: {
			uptime: string;
			dataSource: HAProxyStatsDataSource;
			nodeRuntime?: HAProxyNodeRuntimeDetails;
			status?: string;
			version?: string;
			pids?: string;
			warning?: string;
		},
	): HAProxyStats {
		const snapshot = this.buildSnapshotFromRows(rows);
		return {
			status: params.status ?? this.deriveRuntimeStatus(rows),
			uptime: params.uptime,
			active_sessions: snapshot.totals.activeSessions,
			connections_rate: snapshot.totals.connectionsRate,
			version: params.version,
			pids: params.pids,
			dataSource: params.dataSource,
			snapshot,
			nodeRuntime: params.nodeRuntime,
			warning: params.warning,
		};
	}

	private parseStatResponse(response: string) {
		const lines = response
			.split(/\r?\n/)
			.map((line) => line.replace(/^\uFEFF/, "").trim())
			.filter(Boolean);

		const headerIndex = lines.findIndex((line) => {
			if (line.startsWith("#")) {
				return true;
			}

			const lower = line.toLowerCase();
			return lower.startsWith("pxname,") || lower.startsWith("pxname;");
		});

		if (headerIndex < 0) {
			const preview = lines.slice(0, 2).join(" | ").slice(0, 180);
			throw new Error(
				`Invalid HAProxy stats response: missing headers${preview ? ` (preview: ${preview})` : ""}`,
			);
		}

		const headerLine = lines[headerIndex] || "";
		const delimiter =
			headerLine.includes(";") && !headerLine.includes(",") ? ";" : ",";
		const headers = headerLine
			.replace(/^#\s*/, "")
			.split(delimiter)
			.map((header) => header.trim())
			.filter(Boolean);

		const dataLines = lines
			.slice(headerIndex + 1)
			.filter((line) => !line.startsWith("#") && line.includes(delimiter));

		if (dataLines.length === 0) {
			throw new Error("Invalid HAProxy stats response: missing data rows");
		}

		const rows = dataLines.map((line) => {
			const values = line.split(delimiter);
			const row: Record<string, string> = {};
			for (let i = 0; i < headers.length; i++) {
				const header = headers[i];
				if (!header) {
					continue;
				}
				row[header] = values[i]?.trim() ?? "";
			}
			return row;
		});

		if (!rows[0]?.pxname || !rows[0]?.svname) {
			throw new Error("Invalid HAProxy stats response: malformed CSV headers");
		}

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

		const headers: Record<string, string> = {};
		if (env.HAPROXY_STATS_USERNAME && env.HAPROXY_STATS_PASSWORD) {
			const basicAuth = Buffer.from(
				`${env.HAPROXY_STATS_USERNAME}:${env.HAPROXY_STATS_PASSWORD}`,
			).toString("base64");
			headers.Authorization = `Basic ${basicAuth}`;
		}

		const csvUrl = new URL(statsUrl.toString());
		csvUrl.pathname = "/stats;csv";

		const csvResponse = await fetch(csvUrl.toString(), {
			headers,
		});

		if (!csvResponse.ok) {
			throw new Error(
				`HAProxy stats CSV upstream returned ${csvResponse.status}`,
			);
		}

		const htmlResponse = await fetch(statsUrl.toString(), {
			headers,
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

	getStatsCapabilities(
		nodeConfig?: HAProxyNodeRuntimeConfig,
	): HAProxyStatsCapabilities {
		const socketPath = this.resolveSocketPath(nodeConfig);
		const supportsSocket = Boolean(socketPath);
		const supportsUrl = nodeConfig
			? Boolean(this.resolveNodeStatsUrl(nodeConfig))
			: Boolean(env.HAPROXY_STATS_URL?.trim());

		const availableViews: Array<"graph" | "classic"> = [];
		if (supportsSocket || supportsUrl) {
			availableViews.push("graph");
		}
		if (supportsUrl) {
			availableViews.push("classic");
		}

		const notes: string[] = [];
		if (!supportsSocket) {
			notes.push(
				nodeConfig
					? "Socket stats are unavailable. Set HAProxy socket endpoint in Node Configuration (for example /var/run/haproxy.sock, /var/lib/haproxy/haproxy.sock, or 127.0.0.1:9999)."
					: "Socket stats are unavailable. Enable HAProxy socket and set HAPROXY_SOCKET_ENABLED=true.",
			);
		}
		if (!supportsUrl) {
			notes.push(
				"Classic stats UI is unavailable because no HAProxy stats URL is configured.",
			);
		}

		return {
			supportsSocket,
			supportsUrl,
			availableViews,
			defaultSource: supportsSocket ? "socket" : supportsUrl ? "url" : "none",
			notes,
		};
	}

	/**
	 * Connect to HAProxy stats socket and execute a command
	 * Returns the raw response from HAProxy
	 */
	private async executeSocketCommand(
		command: string,
		nodeConfig?: HAProxyNodeRuntimeConfig,
	): Promise<string> {
		const socketPath = this.resolveSocketPath(nodeConfig);
		if (!socketPath) {
			throw new Error("HAProxy socket path is not configured");
		}
		const socketTarget = this.resolveSocketTarget(socketPath);

		if (nodeConfig && !nodeConfig.isLocalService) {
			const remoteCommand =
				socketTarget.kind === "tcp"
					? [
							`printf '%s\\n' ${this.quoteForSh(command)} | if command -v nc >/dev/null 2>&1; then nc -w 3 ${this.quoteForSh(socketTarget.host)} ${this.quoteForSh(String(socketTarget.port))}; else socat - ${this.quoteForSh(`TCP:${socketTarget.host}:${socketTarget.port}`)}; fi`,
						].join(" ")
					: `printf '%s\\n' ${this.quoteForSh(command)} | socat - ${this.quoteForSh(socketTarget.path)}`;

			const stdout = await this.executeSshCommand(nodeConfig, remoteCommand);
			return stdout;
		}

		try {
			const net = await import("node:net");
			return new Promise((resolve, reject) => {
				const socket =
					socketTarget.kind === "tcp"
						? net.createConnection(
								{
									host: socketTarget.host,
									port: socketTarget.port,
								},
								() => {
									socket.write(`${command}\n`);
									socket.end();
								},
							)
						: net.createConnection(socketTarget.path, () => {
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
	async getStats(
		nodeConfig?: HAProxyNodeRuntimeConfig,
		options?: { source?: HAProxyStatsRequestedSource },
	): Promise<HAProxyStats> {
		try {
			const source = options?.source ?? "auto";
			const capabilities = this.getStatsCapabilities(nodeConfig);
			let shouldUseSocket =
				source === "socket" ||
				(source === "auto" && capabilities.supportsSocket);
			let shouldUseUrl =
				source === "url" ||
				(source === "auto" && !shouldUseSocket && capabilities.supportsUrl);

			if (shouldUseSocket && capabilities.supportsSocket) {
				try {
					const [statResponse, infoResponse] = await Promise.all([
						this.executeSocketCommand("show stat", nodeConfig),
						this.executeSocketCommand("show info", nodeConfig),
					]);

					const rows = this.parseStatResponse(statResponse);
					const info = this.parseInfoResponse(infoResponse);
					const isStopping = info.Stopping === "1";
					const uptimeSeconds = parseInt(info.Uptime_sec || "0", 10) || 0;
					const formattedUptime = this.formatDuration(uptimeSeconds);
					const status = isStopping
						? "stopping"
						: this.deriveRuntimeStatus(rows);

					let nodeRuntime: HAProxyNodeRuntimeDetails | undefined;
					if (nodeConfig) {
						nodeRuntime = await this.buildNodeRuntimeDetails(nodeConfig);
					}

					return this.buildStatsFromRows(rows, {
						uptime: nodeRuntime?.docker?.uptime || formattedUptime,
						dataSource: "socket",
						nodeRuntime,
						status,
						version: info.Version || undefined,
						pids: info.Pid || undefined,
					});
				} catch (socketError) {
					const canFallbackToUrl =
						source === "auto" &&
						capabilities.supportsUrl &&
						Boolean(nodeConfig);

					if (!canFallbackToUrl) {
						throw socketError;
					}

					if (!this.isExpectedSocketError(socketError)) {
						console.warn(
							"Socket stats unavailable or malformed; falling back to URL stats:",
							socketError,
						);
					}

					shouldUseSocket = false;
					shouldUseUrl = true;
				}
			}

			if (nodeConfig) {
				const nodeRuntime = await this.buildNodeRuntimeDetails(nodeConfig);
				const statsUrl = this.resolveNodeStatsUrl(nodeConfig);
				if (!statsUrl || !shouldUseUrl) {
					return {
						status: "not-configured",
						uptime: nodeRuntime.docker?.uptime || "n/a",
						active_sessions: 0,
						connections_rate: 0,
						dataSource: "none",
						nodeRuntime,
						warning:
							capabilities.supportsUrl || capabilities.supportsSocket
								? "Selected source is unavailable for this node. Runtime information is shown where available."
								: "HAProxy stats URL is not configured for this node. Runtime information is shown where available.",
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
						dataSource: "url",
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
						dataSource: "none",
						nodeRuntime,
						warning:
							"HAProxy stats URL is not configured for this node. Runtime information is shown where available.",
					};
				}

				const rows = this.parseStatResponse(remoteStats.csvText);
				return this.buildStatsFromRows(rows, {
					status: this.deriveRuntimeStatus(rows),
					uptime: nodeRuntime.docker?.uptime || remoteStats.uptime,
					dataSource: "url",
					nodeRuntime,
				});
			}

			return {
				status: "offline",
				uptime: "n/a",
				active_sessions: 0,
				connections_rate: 0,
				dataSource: "none",
				warning:
					"No stats source is available. Configure HAProxy socket or stats URL.",
			};
		} catch (error) {
			if (
				!this.isExpectedSocketError(error) &&
				!this.isInvalidStatsResponseError(error)
			) {
				console.error("Error fetching HAProxy stats:", error);
			}

			// Return fallback data if socket unavailable
			return {
				status: "offline",
				uptime: "n/a",
				active_sessions: 0,
				connections_rate: 0,
				dataSource: "none",
				warning:
					error instanceof Error
						? error.message
						: "Unable to fetch HAProxy stats from configured sources",
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
			const response = await this.executeSocketCommand(
				"show stat",
				_nodeConfig,
			);
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
				const [id = "", name = "", image = "", status = ""] = line.split("\t");
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

	private async listLocalDockerContainers(): Promise<
		DockerContainerListItem[]
	> {
		const { stdout } = await execFileAsync(
			"docker",
			[
				"ps",
				"--no-trunc",
				"--format",
				"{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}",
			],
			{
				timeout: 8000,
				windowsHide: true,
			},
		);

		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [id = "", name = "", image = "", status = ""] = line.split("\t");
				return {
					id: id.trim(),
					name: name.trim(),
					image: image.trim(),
					status: status.trim(),
				};
			})
			.filter((item) => Boolean(item.name));
	}

	private parseLineLimit(limit?: number) {
		if (!Number.isFinite(limit)) {
			return 200;
		}

		return Math.max(10, Math.min(2000, Math.trunc(limit ?? 200)));
	}

	private splitLogLines(content: string, limit: number) {
		const trimmed = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		const lines = trimmed.split("\n");
		if (lines.length > 0 && lines[lines.length - 1] === "") {
			lines.pop();
		}

		if (lines.length <= limit) {
			return lines;
		}

		return lines.slice(lines.length - limit);
	}

	private isAllowedLogFileName(fileName: string) {
		return /\.log(?:\.\d+)?$/i.test(fileName);
	}

	private async readLastLinesFromLocalFile(
		filePath: string,
		lineLimit: number,
	) {
		const fs = await import("node:fs/promises");
		const stat = await fs.stat(filePath);
		const maxBytes = 512 * 1024;
		const bytesToRead = Math.min(Math.max(stat.size, 0), maxBytes);

		const handle = await fs.open(filePath, "r");
		try {
			const buffer = Buffer.alloc(bytesToRead);
			const start = Math.max(0, stat.size - bytesToRead);
			const { bytesRead } = await handle.read(buffer, 0, bytesToRead, start);
			const raw = buffer.subarray(0, bytesRead).toString("utf8");
			return this.splitLogLines(raw, lineLimit);
		} finally {
			await handle.close();
		}
	}

	private normalizeLocalLogPath(rawPath: string) {
		const trimmed = rawPath.trim();
		if (!trimmed) {
			throw new Error("Log file path is required");
		}

		const normalized = trimmed.replace(/\//g, path.sep);
		if (path.isAbsolute(normalized)) {
			return path.resolve(normalized);
		}

		return path.resolve(process.cwd(), normalized);
	}

	private normalizeRemoteLogPath(rawPath: string) {
		const trimmed = rawPath.trim().replace(/\\/g, "/");
		if (!trimmed) {
			throw new Error("Log file path is required");
		}

		if (!trimmed.startsWith("/")) {
			throw new Error(
				"Remote log path must be an absolute Linux path, e.g. /var/log/haproxy.log",
			);
		}

		return trimmed;
	}

	private async resolveLocalLogReadTarget(requestedPath: string) {
		const fs = await import("node:fs/promises");
		const normalizedPath = this.normalizeLocalLogPath(requestedPath);
		const stat = await fs.stat(normalizedPath);

		if (stat.isFile()) {
			if (!this.isAllowedLogFileName(path.basename(normalizedPath))) {
				throw new Error(
					"Only .log and .log.<number> files are allowed for log reading.",
				);
			}

			return normalizedPath;
		}

		if (!stat.isDirectory()) {
			throw new Error("Log path must be a file or directory.");
		}

		const entries = await fs.readdir(normalizedPath, { withFileTypes: true });
		const candidates = entries.filter(
			(entry) => entry.isFile() && this.isAllowedLogFileName(entry.name),
		);

		if (candidates.length === 0) {
			throw new Error(
				"No allowed log files found in directory. Only .log and .log.<number> are supported.",
			);
		}

		const withMtime = await Promise.all(
			candidates.map(async (entry) => {
				const absPath = path.join(normalizedPath, entry.name);
				const candidateStat = await fs.stat(absPath);
				return {
					absPath,
					mtimeMs: candidateStat.mtimeMs,
				};
			}),
		);

		withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);

		const newest = withMtime[0];
		if (!newest) {
			throw new Error("Unable to resolve a log file from directory path.");
		}

		return newest.absPath;
	}

	private async listLocalLogFilesFromPath(requestedPath: string) {
		const fs = await import("node:fs/promises");
		const normalizedPath = this.normalizeLocalLogPath(requestedPath);
		const stat = await fs.stat(normalizedPath);

		if (stat.isFile()) {
			if (!this.isAllowedLogFileName(path.basename(normalizedPath))) {
				throw new Error(
					"Only .log and .log.<number> files are allowed for log reading.",
				);
			}

			return [normalizedPath];
		}

		if (!stat.isDirectory()) {
			throw new Error("Log path must be a file or directory.");
		}

		const entries = await fs.readdir(normalizedPath, { withFileTypes: true });
		const candidates = entries.filter(
			(entry) => entry.isFile() && this.isAllowedLogFileName(entry.name),
		);

		const withMtime = await Promise.all(
			candidates.map(async (entry) => {
				const absPath = path.join(normalizedPath, entry.name);
				const candidateStat = await fs.stat(absPath);
				return {
					absPath,
					mtimeMs: candidateStat.mtimeMs,
				};
			}),
		);

		withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
		return withMtime.map((item) => item.absPath);
	}

	private async resolveRemoteLogReadTarget(
		nodeConfig: HAProxyNodeRuntimeConfig,
		requestedPath: string,
	) {
		const remotePath = this.normalizeRemoteLogPath(requestedPath);
		const resolverScript = [
			`target=${this.quoteForSh(remotePath)}`,
			"is_allowed_log_file() {",
			'  case "$1" in',
			"    *.log|*.log.[0-9]*) return 0 ;;",
			"    *) return 1 ;;",
			"  esac",
			"}",
			'if [ -f "$target" ]; then',
			'  if is_allowed_log_file "$target"; then',
			"    printf '%s\\n' \"$target\"",
			"    exit 0",
			"  fi",
			"  echo 'Only .log and .log.<number> files are allowed for log reading.' >&2",
			"  exit 1",
			"fi",
			'if [ -d "$target" ]; then',
			"  newest=''",
			"  newest_mtime='-1'",
			'  for candidate in "$target"/*.log "$target"/*.log.[0-9]*; do',
			'    [ -f "$candidate" ] || continue',
			'    is_allowed_log_file "$candidate" || continue',
			'    mtime=$(stat -c %Y "$candidate" 2>/dev/null || stat -f %m "$candidate" 2>/dev/null || echo 0)',
			'    if [ "$mtime" -ge "$newest_mtime" ]; then',
			'      newest_mtime="$mtime"',
			'      newest="$candidate"',
			"    fi",
			"  done",
			'  if [ -n "$newest" ]; then',
			"    printf '%s\\n' \"$newest\"",
			"    exit 0",
			"  fi",
			"  echo 'No allowed log files found in directory. Only .log and .log.<number> are supported.' >&2",
			"  exit 1",
			"fi",
			"echo 'Log path does not exist or is not readable on remote host.' >&2",
			"exit 1",
		].join("\n");

		const resolved = await this.executeSshCommand(nodeConfig, resolverScript);
		const firstLine = resolved
			.split("\n")
			.map((line) => line.trim())
			.find(Boolean);

		if (!firstLine) {
			throw new Error("Unable to resolve remote log file path.");
		}

		return firstLine;
	}

	private async listRemoteLogFilesFromPath(
		nodeConfig: HAProxyNodeRuntimeConfig,
		requestedPath: string,
	) {
		const remotePath = this.normalizeRemoteLogPath(requestedPath);
		const listScript = [
			`target=${this.quoteForSh(remotePath)}`,
			"is_allowed_log_file() {",
			'  case "$1" in',
			"    *.log|*.log.[0-9]*) return 0 ;;",
			"    *) return 1 ;;",
			"  esac",
			"}",
			'if [ -f "$target" ]; then',
			'  if is_allowed_log_file "$target"; then',
			"    printf '%s\\n' \"$target\"",
			"    exit 0",
			"  fi",
			"  echo 'Only .log and .log.<number> files are allowed for log reading.' >&2",
			"  exit 1",
			"fi",
			'if [ -d "$target" ]; then',
			'  for candidate in "$target"/*.log "$target"/*.log.[0-9]*; do',
			'    [ -f "$candidate" ] || continue',
			'    is_allowed_log_file "$candidate" || continue',
			'    mtime=$(stat -c %Y "$candidate" 2>/dev/null || stat -f %m "$candidate" 2>/dev/null || echo 0)',
			'    printf \'%s\\t%s\\n\' "$mtime" "$candidate"',
			"  done | sort -rn | cut -f2-",
			"  exit 0",
			"fi",
			"echo 'Log path does not exist or is not readable on remote host.' >&2",
			"exit 1",
		].join("\n");

		const stdout = await this.executeSshCommand(nodeConfig, listScript);
		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	}

	private resolvePreferredContainerRef(nodeConfig?: HAProxyNodeRuntimeConfig) {
		return (
			nodeConfig?.haproxyContainerRef?.trim() || nodeConfig?.name?.trim() || ""
		);
	}

	private normalizeImageReference(image: string) {
		const normalized = image.trim().toLowerCase();
		if (!normalized) {
			return "";
		}

		const digestIndex = normalized.indexOf("@");
		if (digestIndex > -1) {
			return normalized.slice(0, digestIndex);
		}

		const lastSlash = normalized.lastIndexOf("/");
		const lastColon = normalized.lastIndexOf(":");
		if (lastColon > lastSlash) {
			return normalized.slice(0, lastColon);
		}

		return normalized;
	}

	private resolveLogContainer(
		containers: DockerContainerListItem[],
		requestedRef?: string,
		nodeConfig?: HAProxyNodeRuntimeConfig,
	) {
		if (containers.length === 0) {
			throw new Error("No running Docker containers found.");
		}

		const normalizedRef =
			requestedRef?.trim().toLowerCase() ||
			this.resolvePreferredContainerRef(nodeConfig).toLowerCase();

		if (normalizedRef) {
			const exact = containers.filter((container) => {
				const name = container.name.toLowerCase();
				const id = container.id.toLowerCase();
				const image = container.image.toLowerCase();
				const imageBase = this.normalizeImageReference(image);
				return (
					name === normalizedRef ||
					id === normalizedRef ||
					image === normalizedRef ||
					imageBase === normalizedRef
				);
			});

			if (exact.length === 1 && exact[0]) {
				return exact[0];
			}

			const partial = containers.filter((container) => {
				const name = container.name.toLowerCase();
				const id = container.id.toLowerCase();
				const image = container.image.toLowerCase();
				const imageBase = this.normalizeImageReference(image);
				return (
					name.includes(normalizedRef) ||
					id.startsWith(normalizedRef) ||
					image.includes(normalizedRef) ||
					imageBase.includes(normalizedRef)
				);
			});

			if (partial.length === 1 && partial[0]) {
				return partial[0];
			}

			if (partial.length > 1) {
				throw new Error(
					`Container reference '${requestedRef ?? normalizedRef}' matched multiple containers. Please choose a specific container.`,
				);
			}
		}

		const haproxyMatches = containers.filter((container) => {
			const name = container.name.toLowerCase();
			const image = container.image.toLowerCase();
			return name.includes("haproxy") || image.includes("haproxy");
		});

		if (haproxyMatches.length === 1 && haproxyMatches[0]) {
			return haproxyMatches[0];
		}

		if (containers.length === 1 && containers[0]) {
			return containers[0];
		}

		throw new Error(
			"Multiple running containers found. Select a container from the list before reading container logs.",
		);
	}

	async listLogContainers(
		nodeConfig?: HAProxyNodeRuntimeConfig,
	): Promise<HAProxyLogContainer[]> {
		try {
			const rawContainers = nodeConfig
				? this.shouldUseSshForConfig(nodeConfig)
					? await this.listRemoteDockerContainers(nodeConfig)
					: await this.listLocalDockerContainers()
				: await this.listLocalDockerContainers();

			return rawContainers
				.map((container) => ({
					id: container.id,
					name: container.name,
					image: container.image,
					status: container.status,
				}))
				.sort((a, b) => a.name.localeCompare(b.name));
		} catch (error) {
			const execError = error as ExecError;
			const stderr = execError.stderr?.trim() || "";
			const message =
				error instanceof Error
					? error.message
					: "Failed to list Docker containers";

			if (
				stderr.toLowerCase().includes("docker") ||
				message.includes("docker")
			) {
				throw new Error(
					`Unable to list Docker containers: ${stderr || message}. Ensure Docker is installed and accessible.`,
				);
			}

			throw new Error(message);
		}
	}

	async listLogFiles(
		options: {
			path?: string;
		},
		nodeConfig?: HAProxyNodeRuntimeConfig,
	): Promise<string[]> {
		const configuredPath = nodeConfig?.haproxyLogPath?.trim() || "";
		const requestedPath = options.path?.trim() || configuredPath;

		if (!requestedPath) {
			throw new Error(
				"Log file path is required. Set HAProxy log path in Node Configuration or provide path in the request.",
			);
		}

		if (nodeConfig && this.shouldUseSshForConfig(nodeConfig)) {
			return this.listRemoteLogFilesFromPath(nodeConfig, requestedPath);
		}

		return this.listLocalLogFilesFromPath(requestedPath);
	}

	async readLogs(
		options: {
			source?: HAProxyLogSource;
			lines?: number;
			filePath?: string;
			containerRef?: string;
		},
		nodeConfig?: HAProxyNodeRuntimeConfig,
	): Promise<HAProxyLogReadResult> {
		const lineLimit = this.parseLineLimit(options.lines);
		const source: HAProxyLogSource =
			options.source ??
			(nodeConfig?.haproxyLogSource === "container" ? "container" : "file");

		if (source === "file") {
			const configuredPath = nodeConfig?.haproxyLogPath?.trim() || "";
			const requestedPath = options.filePath?.trim() || configuredPath;

			if (!requestedPath) {
				throw new Error(
					"Log file path is required. Set HAProxy log path in Node Configuration or provide filePath in the request.",
				);
			}

			if (nodeConfig && this.shouldUseSshForConfig(nodeConfig)) {
				const remotePath = await this.resolveRemoteLogReadTarget(
					nodeConfig,
					requestedPath,
				);
				const command = `tail -n ${lineLimit} -- ${this.quoteForSh(remotePath)}`;
				const stdout = await this.executeSshCommand(nodeConfig, command);
				return {
					source,
					target: remotePath,
					resolvedFilePath: remotePath,
					lines: this.splitLogLines(stdout, lineLimit),
					fetchedAt: new Date().toISOString(),
				};
			}

			const localPath = await this.resolveLocalLogReadTarget(requestedPath);
			const lines = await this.readLastLinesFromLocalFile(localPath, lineLimit);
			return {
				source,
				target: localPath,
				resolvedFilePath: localPath,
				lines,
				fetchedAt: new Date().toISOString(),
			};
		}

		const containers = nodeConfig
			? this.shouldUseSshForConfig(nodeConfig)
				? await this.listRemoteDockerContainers(nodeConfig)
				: await this.listLocalDockerContainers()
			: await this.listLocalDockerContainers();

		const resolvedContainer = this.resolveLogContainer(
			containers,
			options.containerRef,
			nodeConfig,
		);

		if (nodeConfig && this.shouldUseSshForConfig(nodeConfig)) {
			const command = `docker logs --tail ${lineLimit} --timestamps ${this.quoteForSh(resolvedContainer.name)} 2>&1`;
			const stdout = await this.executeSshCommand(nodeConfig, command);
			return {
				source,
				target: resolvedContainer.name,
				lines: this.splitLogLines(stdout, lineLimit),
				fetchedAt: new Date().toISOString(),
			};
		}

		const { stdout, stderr } = await execFileAsync(
			"docker",
			[
				"logs",
				"--tail",
				String(lineLimit),
				"--timestamps",
				resolvedContainer.name,
			],
			{
				timeout: 8000,
				windowsHide: true,
			},
		);

		const merged = [stdout, stderr]
			.filter((value): value is string => Boolean(value))
			.join("\n");

		return {
			source,
			target: resolvedContainer.name,
			lines: this.splitLogLines(merged, lineLimit),
			fetchedAt: new Date().toISOString(),
		};
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
				const image = container.image.toLowerCase();
				const imageBase = this.normalizeImageReference(image);
				return (
					name === normalizedRef ||
					id.startsWith(normalizedRef) ||
					image === normalizedRef ||
					imageBase === normalizedRef ||
					image.includes(normalizedRef)
				);
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
		const validateCommand = await this.buildRemoteValidateDockerCommand(
			nodeConfig,
			targetContainer,
		);
		await this.executeSshCommand(nodeConfig, validateCommand);
	}

	private describeCommandError(error: unknown, fallback: string) {
		if (error instanceof Error && error.message.trim()) {
			return error.message;
		}

		const commandError = error as {
			stderr?: string;
			stdout?: string;
			message?: string;
		};

		const details =
			commandError.stderr?.trim() ||
			commandError.stdout?.trim() ||
			commandError.message ||
			fallback;

		return details;
	}

	async reloadConfig(nodeConfig?: HAProxyNodeRuntimeConfig): Promise<boolean> {
		if (nodeConfig && this.shouldUseSshForConfig(nodeConfig)) {
			try {
				const targetContainer =
					await this.resolveRemoteReloadTarget(nodeConfig);
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
			throw new Error(
				`Failed to reload HAProxy configuration: ${this.describeCommandError(error, "Unknown reload error")}`,
			);
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

	private normalizeConfigContent(content: string) {
		const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		if (normalized.length === 0) {
			return normalized;
		}

		return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
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

				const relativePath = path.posix
					.relative(configRoot, absPath)
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
	): Promise<{ remoteFeedback?: RemoteConfigMutationFeedback }> {
		const normalizedContent = this.normalizeConfigContent(content);

		if (nodeConfig && this.shouldUseSshForConfig(nodeConfig)) {
			const target = this.normalizeRemoteConfigFilePath(filePath, nodeConfig);
			const targetContainer = await this.resolveRemoteReloadTarget(nodeConfig);
			const validateCommand = await this.buildRemoteValidateDockerCommand(
				nodeConfig,
				targetContainer,
			);
			const backupPath = `${target.absPath}.haproxy-manager.bak.$$`;
			const writeScript = [
				"set -eu",
				`target_path=${this.quoteForSh(target.absPath)}`,
				`backup_path=${this.quoteForSh(backupPath)}`,
				`if [ ! -f ${this.quoteForSh(target.absPath)} ]; then`,
				`  echo ${this.quoteForSh(`Config file not found: ${target.relativePath}`)} >&2`,
				"  exit 1",
				"fi",
				`cp -- "$target_path" "$backup_path"`,
				`printf %s ${this.quoteForSh(normalizedContent)} > "$target_path"`,
				`if ${validateCommand}; then`,
				'  rm -f -- "$backup_path"',
				"  exit 0",
				"fi",
				"validation_exit=$?",
				'cp -- "$backup_path" "$target_path"',
				'rm -f -- "$backup_path"',
				`echo ${this.quoteForSh("Remote HAProxy validation failed after save. Changes were rolled back.")} >&2`,
				'exit "$validation_exit"',
			].join("\n");

			const validationStdout = await this.executeSshCommand(
				nodeConfig,
				writeScript,
			);
			await this.writeJsonCache(
				this.getRemoteConfigContentCacheKey(nodeConfig, target.relativePath),
				{ content: normalizedContent },
			);
			await this.deleteCacheKeys([
				this.getRemoteConfigListCacheKey(nodeConfig),
			]);
			return {
				remoteFeedback: this.buildRemoteMutationFeedback({
					action: "save",
					nodeConfig,
					targetPath: target.relativePath,
					targetContainer,
					validationOutput: this.compactRemoteOutput(validationStdout),
				}),
			};
		}

		const fs = await import("node:fs/promises");
		const nodePath = await import("node:path");
		const target = this.normalizeConfigFilePath(
			filePath,
			nodeConfig?.haproxyConfigPath,
		);
		const previousContent = await fs.readFile(target.absPath, "utf8");

		await fs.mkdir(nodePath.dirname(target.absPath), { recursive: true });
		await fs.writeFile(target.absPath, normalizedContent, "utf8");

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

		return {};
	}

	async createConfigFile(
		filePath: string,
		content = "",
		nodeConfig?: HAProxyNodeRuntimeConfig,
	): Promise<{ remoteFeedback?: RemoteConfigMutationFeedback }> {
		const normalizedContent = this.normalizeConfigContent(content);

		if (nodeConfig && this.shouldUseSshForConfig(nodeConfig)) {
			const target = this.normalizeRemoteConfigFilePath(filePath, nodeConfig);
			const targetContainer = await this.resolveRemoteReloadTarget(nodeConfig);
			const validateCommand = await this.buildRemoteValidateDockerCommand(
				nodeConfig,
				targetContainer,
			);
			const dirPath = path.posix.dirname(target.absPath);
			const createScript = [
				"set -eu",
				`target_path=${this.quoteForSh(target.absPath)}`,
				`mkdir -p -- ${this.quoteForSh(dirPath)}`,
				`if [ -e ${this.quoteForSh(target.absPath)} ]; then`,
				`  echo ${this.quoteForSh(`Config file already exists: ${target.relativePath}`)} >&2`,
				"  exit 1",
				"fi",
				`printf %s ${this.quoteForSh(normalizedContent)} > "$target_path"`,
				`if ${validateCommand}; then`,
				"  exit 0",
				"fi",
				"validation_exit=$?",
				'rm -f -- "$target_path"',
				`echo ${this.quoteForSh("Remote HAProxy validation failed after create. New file was removed.")} >&2`,
				'exit "$validation_exit"',
			].join("\n");

			const validationStdout = await this.executeSshCommand(
				nodeConfig,
				createScript,
			);
			await this.writeJsonCache(
				this.getRemoteConfigContentCacheKey(nodeConfig, target.relativePath),
				{ content: normalizedContent },
			);
			await this.deleteCacheKeys([
				this.getRemoteConfigListCacheKey(nodeConfig),
			]);
			return {
				remoteFeedback: this.buildRemoteMutationFeedback({
					action: "create",
					nodeConfig,
					targetPath: target.relativePath,
					targetContainer,
					validationOutput: this.compactRemoteOutput(validationStdout),
				}),
			};
		}

		const fs = await import("node:fs/promises");
		const nodePath = await import("node:path");
		const target = this.normalizeConfigFilePath(
			filePath,
			nodeConfig?.haproxyConfigPath,
		);

		await fs.mkdir(nodePath.dirname(target.absPath), { recursive: true });
		const handle = await fs.open(target.absPath, "wx");
		try {
			if (normalizedContent) {
				await handle.writeFile(normalizedContent, "utf8");
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

		return {};
	}

	async deleteConfigFile(
		filePath: string,
		nodeConfig?: HAProxyNodeRuntimeConfig,
	): Promise<{ remoteFeedback?: RemoteConfigMutationFeedback }> {
		if (nodeConfig && this.shouldUseSshForConfig(nodeConfig)) {
			const target = this.normalizeRemoteConfigFilePath(filePath, nodeConfig);
			const targetContainer = await this.resolveRemoteReloadTarget(nodeConfig);
			const validateCommand = await this.buildRemoteValidateDockerCommand(
				nodeConfig,
				targetContainer,
			);
			const backupPath = `${target.absPath}.haproxy-manager.bak.$$`;
			const deleteScript = [
				"set -eu",
				`target_path=${this.quoteForSh(target.absPath)}`,
				`backup_path=${this.quoteForSh(backupPath)}`,
				`if [ ! -f ${this.quoteForSh(target.absPath)} ]; then`,
				`  echo ${this.quoteForSh(`Config file not found: ${target.relativePath}`)} >&2`,
				"  exit 1",
				"fi",
				'cp -- "$target_path" "$backup_path"',
				'rm -- "$target_path"',
				`if ${validateCommand}; then`,
				'  rm -f -- "$backup_path"',
				"  exit 0",
				"fi",
				"validation_exit=$?",
				'cp -- "$backup_path" "$target_path"',
				'rm -f -- "$backup_path"',
				`echo ${this.quoteForSh("Remote HAProxy validation failed after delete. File was restored.")} >&2`,
				'exit "$validation_exit"',
			].join("\n");

			const validationStdout = await this.executeSshCommand(
				nodeConfig,
				deleteScript,
			);
			await this.deleteCacheKeys([
				this.getRemoteConfigListCacheKey(nodeConfig),
				this.getRemoteConfigContentCacheKey(nodeConfig, target.relativePath),
			]);
			return {
				remoteFeedback: this.buildRemoteMutationFeedback({
					action: "delete",
					nodeConfig,
					targetPath: target.relativePath,
					targetContainer,
					validationOutput: this.compactRemoteOutput(validationStdout),
				}),
			};
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

		return {};
	}
}

export const haproxyService = new HAProxyService();
