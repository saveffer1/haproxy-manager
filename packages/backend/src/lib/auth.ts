// src/lib/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { db } from "../database/db";
import { env } from "./env";

const trustedOrigins = env.BETTER_AUTH_TRUSTED_ORIGINS.split(",")
	.map((origin) => origin.trim())
	.filter(Boolean);

export const auth = betterAuth({
	baseURL: env.BETTER_AUTH_URL,
	basePath: "/api/auth",
	trustedOrigins,
	database: drizzleAdapter(db, {
		provider: "pg",
	}),
	emailAndPassword: {
		enabled: true,
		sendResetPassword: async ({ user, url }) => {
			console.log(`[auth] Password reset requested for ${user.email}: ${url}`);
		},
		onPasswordReset: async ({ user }) => {
			console.log(`[auth] Password was reset for ${user.email}`);
		},
	},
	plugins: [username()],
});

export async function ensureDefaultAdminUser() {
	// Only seed a default user when both email and password are explicitly configured.
	// This avoids shipping a build that automatically authorizes a weak hardcoded account.
	if (!env.DEFAULT_ADMIN_EMAIL || !env.DEFAULT_ADMIN_PASSWORD) {
		console.log(
			"[auth] Skipping default admin user seed because DEFAULT_ADMIN_EMAIL or DEFAULT_ADMIN_PASSWORD is not set.",
		);
		return;
	}

	const authApi = auth.api as {
		signInEmail: (args: {
			body: {
				email: string;
				password: string;
			};
		}) => Promise<unknown>;
		signUpEmail: (args: {
			body: {
				email: string;
				password: string;
				name: string;
				username: string;
			};
		}) => Promise<unknown>;
	};

	try {
		await authApi.signInEmail({
			body: {
				email: env.DEFAULT_ADMIN_EMAIL,
				password: env.DEFAULT_ADMIN_PASSWORD,
			},
		});
		return;
	} catch {
		// User likely doesn't exist yet. Continue to sign-up attempt.
	}

	try {
		await authApi.signUpEmail({
			body: {
				email: env.DEFAULT_ADMIN_EMAIL,
				password: env.DEFAULT_ADMIN_PASSWORD,
				name: "Administrator",
				username: env.DEFAULT_ADMIN_USERNAME,
			},
		});
		console.log("[auth] Seeded default dev user for Better Auth.");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('relation "user" does not exist')) {
			console.warn(
				"[auth] Auth tables are missing. Run bun --filter @app/backend run db:push.",
			);
			return;
		}

		console.warn("[auth] Could not seed default user:", message);
	}
}
