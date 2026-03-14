type FrontendEnv = {
	VITE_BACKEND_URL: string;
	VITE_API_KEY: string;
	OTEL_DASHBOARD_URL: string;
};

const defaultBackendUrl =
	typeof window === "undefined"
		? "http://localhost:3000"
		: `${window.location.protocol}//${window.location.hostname}:3000`;

export const env: FrontendEnv = {
	VITE_BACKEND_URL:
		(import.meta.env.VITE_BACKEND_URL as string | undefined) ??
		defaultBackendUrl,
	VITE_API_KEY: (import.meta.env.VITE_API_KEY as string | undefined) ?? "",
	OTEL_DASHBOARD_URL:
		(import.meta.env.OTEL_DASHBOARD_URL as string | undefined) ??
		"http://localhost:16686",
};
