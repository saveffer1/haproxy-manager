import { and, desc, eq, like } from "drizzle-orm";
import { db } from "../database/db";
import { user, verification } from "../database/schema";
import { auth } from "../lib/auth";

type ResetArgs = {
	username?: string;
	email?: string;
	password: string;
};

function getArgValue(args: string[], key: string) {
	const idx = args.indexOf(key);
	if (idx < 0) {
		return undefined;
	}

	return args[idx + 1];
}

function parseArgs(argv: string[]): ResetArgs {
	const password =
		getArgValue(argv, "--password") ?? getArgValue(argv, "-p") ?? "";
	const email = getArgValue(argv, "--email");
	const username = getArgValue(argv, "--username");

	if (!password) {
		throw new Error("Missing required --password argument");
	}

	if (password.length < 8) {
		throw new Error("Password must be at least 8 characters long");
	}

	if (!email && !username) {
		throw new Error("Missing user selector: provide --username or --email");
	}

	if (email && username) {
		throw new Error("Use either --username or --email, not both");
	}

	return {
		password,
		email,
		username,
	};
}

function printUsage() {
	console.log("Usage:");
	console.log(
		"  bun run auth:reset-password -- --username admin --password newStrongPassword",
	);
	console.log(
		"  bun run auth:reset-password -- --email admin@local.dev --password newStrongPassword",
	);
	console.log(
		"  bun run auth:reset-admin -- --password newStrongPassword (shortcut for admin)",
	);
}

async function resolveTargetUser(args: ResetArgs) {
	if (args.email) {
		return db.query.user.findFirst({
			where: eq(user.email, args.email),
		});
	}

	const username = args.username;
	if (!username) {
		throw new Error("Missing username");
	}

	return db.query.user.findFirst({
		where: eq(user.username, username),
	});
}

async function run() {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		printUsage();
		return;
	}

	const args = parseArgs(argv);
	const targetUser = await resolveTargetUser(args);

	if (!targetUser) {
		throw new Error("Target user not found");
	}

	const authApi = auth.api as {
		requestPasswordReset: (args: {
			body: {
				email: string;
				redirectTo: string;
			};
		}) => Promise<unknown>;
		resetPassword: (args: {
			body: {
				token: string;
				newPassword: string;
			};
		}) => Promise<unknown>;
	};

	await authApi.requestPasswordReset({
		body: {
			email: targetUser.email,
			redirectTo: "http://localhost/reset-password",
		},
	});

	const latestResetToken = await db.query.verification.findFirst({
		where: and(
			like(verification.identifier, "reset-password:%"),
			eq(verification.value, targetUser.id),
		),
		orderBy: [desc(verification.expiresAt)],
	});

	if (!latestResetToken) {
		throw new Error("Could not resolve reset token for target user");
	}

	const token = latestResetToken.identifier.replace("reset-password:", "");
	if (!token) {
		throw new Error("Invalid reset token format");
	}

	await authApi.resetPassword({
		body: {
			token,
			newPassword: args.password,
		},
	});

	console.log(`Password reset complete for ${targetUser.email}`);
}

run().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[auth:reset-password] ${message}`);
	printUsage();
	process.exit(1);
});
