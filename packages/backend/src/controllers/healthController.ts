import { Elysia } from "elysia";
import { type HealthStatus, healthService } from "../services/healthService";
import type { ApiResponse } from "../types/common";

export function createHealthController() {
	return (
		new Elysia()
			// API status
			.get("/", () => healthService.getApiStatus())
			// Health check endpoint
			.get("/health", async (): Promise<ApiResponse<HealthStatus>> => {
				try {
					const health = await healthService.checkHealth();
					return {
						success: true,
						data: health,
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error ? error.message : "Health check failed",
					};
				}
			})
	);
}
