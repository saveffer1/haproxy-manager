import { existsSync } from "node:fs";
import * as path from "node:path";
import { env } from "../lib/env";

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

export class HAProxyService {
	private socketPath = env.HAPROXY_SOCKET_PATH;
	private socketEnabled = env.HAPROXY_SOCKET_ENABLED;
	private configDir = this.resolveConfigDir();

	private resolveConfigDir() {
		const configured = env.HAPROXY_CONFIG_DIR;

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
	async getStats(): Promise<HAProxyStats> {
		try {
			const response = await this.executeSocketCommand("show stat");
			const lines = response.split("\n");

			// Parse CSV format output from HAProxy
			// First line is headers, subsequent lines are data
			if (lines.length < 2) {
				throw new Error("Invalid HAProxy stats response");
			}

			const headers = lines[0].replace(/^# /, "").split(",");
			const firstDataLine = lines[1].split(",");

			// Find relevant columns
			const getPsvValue = (key: string) => {
				const index = headers.indexOf(key);
				return index !== -1 ? firstDataLine[index]?.trim() : "0";
			};

			const activeConn = parseInt(getPsvValue("scur"), 10) || 0;
			const connectRate = parseInt(getPsvValue("rate"), 10) || 0;

			return {
				status: "online",
				active_sessions: activeConn,
				connections_rate: connectRate,
				version: "2.8-alpine",
				pids: process.pid.toString(),
			};
		} catch (error) {
			if (!this.isExpectedSocketError(error)) {
				console.error("Error fetching HAProxy stats:", error);
			}

			// Return fallback data if socket unavailable
			return {
				status: "offline",
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
	async getBackends(): Promise<HAProxyBackend[]> {
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

	async reloadConfig(): Promise<boolean> {
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

	private normalizeConfigFilePath(rawPath: string): ConfigFilePath {
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

		const joined = path.join(this.configDir, normalized);
		const resolvedRoot = path.resolve(this.configDir);
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

	async listConfigFiles(): Promise<HAProxyConfigFile[]> {
		const fs = await import("node:fs/promises");

		await fs.mkdir(this.configDir, { recursive: true });

		const files: HAProxyConfigFile[] = [];
		await this.walkConfigFiles(this.configDir, this.configDir, files);

		return files.sort((a, b) => a.path.localeCompare(b.path));
	}

	async getConfigFileContent(filePath: string): Promise<string> {
		const fs = await import("node:fs/promises");
		const target = this.normalizeConfigFilePath(filePath);

		return fs.readFile(target.absPath, "utf8");
	}

	async saveConfigFile(filePath: string, content: string): Promise<void> {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const target = this.normalizeConfigFilePath(filePath);
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

	async createConfigFile(filePath: string, content = ""): Promise<void> {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const target = this.normalizeConfigFilePath(filePath);

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

	async deleteConfigFile(filePath: string): Promise<void> {
		const fs = await import("node:fs/promises");
		const target = this.normalizeConfigFilePath(filePath);
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
