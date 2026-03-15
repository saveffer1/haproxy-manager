import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../database/db";
import { user } from "../database/schema";
import type { ApiResponse } from "../types/common";

export function createAuthController() {
	return new Elysia({ prefix: "/auth" })
		.get(
			"/resolve-identity",
			async ({
				query,
			}): Promise<
				ApiResponse<{ username: string | null; email: string | null }>
			> => {
				const raw =
					typeof query.identity === "string" ? query.identity.trim() : "";

				if (!raw) {
					return {
						success: false,
						error: "identity query parameter is required",
					};
				}

				if (raw.includes("@")) {
					return {
						success: true,
						data: {
							username: null,
							email: raw,
						},
					};
				}

				const matchedUser = await db.query.user.findFirst({
					where: eq(user.username, raw),
					columns: {
						username: true,
						email: true,
					},
				});

				if (!matchedUser) {
					return {
						success: false,
						error: "User not found",
					};
				}

				return {
					success: true,
					data: matchedUser,
				};
			},
		)
		.get(
			"/auth-mode",
			(): ApiResponse<{ mode: string; endpoint: string }> => ({
				success: true,
				data: {
					mode: "better-auth-email-password",
					endpoint: "/api/auth/sign-in/email",
				},
			}),
		);
}
