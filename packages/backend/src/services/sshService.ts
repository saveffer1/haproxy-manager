import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { env } from "../lib/env";

const execFileAsync = promisify(execFile);

export type SshTestInput = {
	host: string;
	user?: string;
	port?: number;
};

export type SshTestResult = {
	ok: boolean;
	message: string;
	stdout?: string;
	stderr?: string;
};

type ExecError = Error & {
	code?: number | string;
	signal?: NodeJS.Signals;
	stdout?: string;
	stderr?: string;
};

function resolveKeyPath(fileName: string) {
	const keyDir = env.SSH_KEY_DIR.trim();
	if (path.isAbsolute(keyDir)) {
		return path.join(keyDir, fileName);
	}

	return path.resolve(process.cwd(), keyDir, fileName);
}

function getPrivateKeyPath() {
	return resolveKeyPath(env.SSH_PRIVATE_KEY_FILE);
}

function getPublicKeyPath() {
	return resolveKeyPath(env.SSH_PUBLIC_KEY_FILE);
}

async function ensureKeyDirectory() {
	const privateKeyPath = getPrivateKeyPath();
	await fs.mkdir(path.dirname(privateKeyPath), { recursive: true });
}

async function generateKeyPair() {
	await ensureKeyDirectory();

	const privateKeyPath = getPrivateKeyPath();
	const args = [
		"-t",
		"ed25519",
		"-N",
		"",
		"-C",
		"haproxy-manager",
		"-f",
		privateKeyPath,
	];

	try {
		await execFileAsync("ssh-keygen", args, {
			timeout: 15000,
			windowsHide: true,
		});
	} catch (error) {
		throw new Error(
			error instanceof Error
				? `Failed to generate SSH keypair: ${error.message}`
				: "Failed to generate SSH keypair",
		);
	}

	if (process.platform !== "win32") {
		await fs.chmod(privateKeyPath, 0o600);
	}
}

export async function ensureSshKeyPair() {
	const privateKeyPath = getPrivateKeyPath();
	const publicKeyPath = getPublicKeyPath();
	if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
		return {
			privateKeyPath,
			publicKeyPath,
		};
	}

	await generateKeyPair();

	return {
		privateKeyPath,
		publicKeyPath,
	};
}

export async function getSshPublicKey() {
	const { publicKeyPath } = await ensureSshKeyPair();
	const key = await fs.readFile(publicKeyPath, "utf8");
	return key.trim();
}

function isLocalHost(host: string) {
	const normalized = host.trim().toLowerCase();
	return (
		normalized === "localhost" ||
		normalized === "127.0.0.1" ||
		normalized === "::1"
	);
}

function buildSshFailureMessage(args: {
	errorMessage: string;
	stderr: string;
	host: string;
	user: string;
	port: number;
}) {
	const stderrLower = args.stderr.toLowerCase();
	const errorLower = args.errorMessage.toLowerCase();

	if (
		stderrLower.includes("connection refused") ||
		errorLower.includes("connection refused")
	) {
		if (process.platform === "win32" && isLocalHost(args.host)) {
			return [
				`SSH connection refused at ${args.user}@${args.host}:${args.port}.`,
				"On Windows, localhost means the backend machine. OpenSSH Server is likely not running on port 22.",
				"For Docker HAProxy, use a reachable Linux host/container that runs sshd, or a remote VM IP instead of localhost.",
			].join(" ");
		}

		return `SSH connection refused at ${args.user}@${args.host}:${args.port}. Ensure sshd is running and reachable from the backend host.`;
	}

	if (
		stderrLower.includes("permission denied") ||
		errorLower.includes("permission denied")
	) {
		return `SSH authentication failed for ${args.user}@${args.host}:${args.port}. Add the generated public key to ~/.ssh/authorized_keys on target host.`;
	}

	if (
		stderrLower.includes("could not resolve hostname") ||
		errorLower.includes("could not resolve hostname")
	) {
		return `Host ${args.host} cannot be resolved. Verify DNS/host value and try again.`;
	}

	if (
		stderrLower.includes("operation timed out") ||
		errorLower.includes("timed out")
	) {
		return `SSH timeout for ${args.user}@${args.host}:${args.port}. Check network route, firewall, and port mapping.`;
	}

	if (args.stderr.trim()) {
		return `SSH test failed: ${args.stderr.trim()}`;
	}

	return args.errorMessage || "SSH connection test failed";
}

export async function testSshConnection(
	input: SshTestInput,
): Promise<SshTestResult> {
	const host = input.host.trim();
	if (!host) {
		throw new Error("Host is required for SSH test");
	}

	const user = (input.user?.trim() || "root").replace(/\s+/g, "");
	const defaultPort = Number.parseInt(env.SSH_DEFAULT_PORT, 10);
	const requestedPort = Number.isFinite(input.port) ? input.port : defaultPort;
	const port = Number.isFinite(requestedPort) ? Number(requestedPort) : 22;
	const timeoutSec = Number.parseInt(env.SSH_CONNECT_TIMEOUT_SEC, 10) || 8;

	const { privateKeyPath } = await ensureSshKeyPair();

	const args = [
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
		"echo",
		"ssh_ok",
	];

	try {
		const { stdout, stderr } = await execFileAsync("ssh", args, {
			timeout: Math.max(timeoutSec, 1) * 1000 + 3000,
			windowsHide: true,
		});

		if (stdout.includes("ssh_ok")) {
			return {
				ok: true,
				message: `SSH connected to ${user}@${host}:${port}`,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
			};
		}

		return {
			ok: false,
			message: "SSH executed but did not return expected probe output",
			stdout: stdout.trim(),
			stderr: stderr.trim(),
		};
	} catch (error) {
		const execError = error as ExecError;
		const stderr = (execError.stderr || "").trim();
		const stdout = (execError.stdout || "").trim();
		const rawMessage =
			error instanceof Error ? error.message : "SSH connection test failed";
		const message = buildSshFailureMessage({
			errorMessage: rawMessage,
			stderr,
			host,
			user,
			port,
		});

		return {
			ok: false,
			message,
			stdout,
			stderr,
		};
	}
}
