type FrontendEnv = {
	VITE_BACKEND_URL: string;
};

const defaultBackendUrl =
	typeof window === "undefined"
		? "https://localhost"
		: window.location.origin;

const configuredBackendUrl = (import.meta.env.VITE_BACKEND_URL as
	| string
	| undefined)?.trim();

export const env: FrontendEnv = {
	VITE_BACKEND_URL: configuredBackendUrl || defaultBackendUrl,
};
