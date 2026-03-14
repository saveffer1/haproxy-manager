import { Elysia } from "elysia";
import { env } from "./env";

export type ApiKeyAuthState = {
	provided: boolean;
	valid: boolean;
	key: string | null;
	source: "x-api-key" | "authorization" | null;
};

function getBearerToken(authorizationHeader: string | undefined) {
	if (!authorizationHeader) {
		return null;
	}

	const [scheme, value] = authorizationHeader.split(" ");
	if (scheme?.toLowerCase() !== "bearer" || !value) {
		return null;
	}

	return value;
}

export function apiKeySupportPlugin() {
	return new Elysia({ name: "api-key-support" }).derive(({ request }) => {
		const keyFromHeader = request.headers.get("x-api-key");
		const keyFromBearer = getBearerToken(
			request.headers.get("authorization") ?? undefined,
		);
		const resolvedKey = keyFromHeader ?? keyFromBearer ?? null;

		const apiKeyAuth: ApiKeyAuthState = {
			provided: Boolean(resolvedKey),
			valid: Boolean(resolvedKey && resolvedKey === env.API_KEY),
			key: resolvedKey,
			source: keyFromHeader
				? "x-api-key"
				: keyFromBearer
					? "authorization"
					: null,
		};

		if (apiKeyAuth.provided && !apiKeyAuth.valid) {
			console.warn("[api-key] Invalid API key provided.");
		}

		return {
			apiKeyAuth,
		};
	});
}
