type FrontendEnv = {
	VITE_BACKEND_URL: string;
};

const defaultBackendUrl =
	typeof window === "undefined"
		? "http://localhost:3000"
		: `${window.location.protocol}//${window.location.hostname}:3000`;

export const env: FrontendEnv = {
	VITE_BACKEND_URL:
		(import.meta.env.VITE_BACKEND_URL as string | undefined) ??
		defaultBackendUrl,
};
