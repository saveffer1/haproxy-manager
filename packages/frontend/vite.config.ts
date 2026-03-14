import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

function readEnvValue(filePath: string, key: string) {
	try {
		const raw = readFileSync(filePath, "utf8");
		for (const line of raw.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) {
				continue;
			}

			const idx = trimmed.indexOf("=");
			if (idx < 0) {
				continue;
			}

			const k = trimmed.slice(0, idx).trim();
			if (k !== key) {
				continue;
			}

			let value = trimmed.slice(idx + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}

			return value;
		}
	} catch {
		return undefined;
	}

	return undefined;
}

export default defineConfig(() => {
	const frontendDir = fileURLToPath(new URL(".", import.meta.url));
	const backendEnvPath = path.resolve(frontendDir, "../backend/.env");
	const backendLocalEnvPath = path.resolve(
		frontendDir,
		"../backend/.env.local",
	);

	const apiKeyFromBackend =
		readEnvValue(backendLocalEnvPath, "API_KEY") ??
		readEnvValue(backendEnvPath, "API_KEY") ??
		"";

	const backendUrlFromBackend =
		readEnvValue(backendLocalEnvPath, "BETTER_AUTH_URL") ??
		readEnvValue(backendEnvPath, "BETTER_AUTH_URL") ??
		"http://localhost:3000";

	const envApiKey = process.env.VITE_API_KEY ?? apiKeyFromBackend;
	const envBackendUrl = process.env.VITE_BACKEND_URL ?? backendUrlFromBackend;

	return {
		resolve: {
			alias: {
				"@": fileURLToPath(new URL("./src", import.meta.url)),
			},
		},
		define: {
			"import.meta.env.VITE_API_KEY": JSON.stringify(envApiKey),
			"import.meta.env.VITE_BACKEND_URL": JSON.stringify(envBackendUrl),
		},
	};
});
