import { RedisClient } from "bun";
import { env } from "../lib/env";

export const redis = new RedisClient(env.REDIS_URL, {
	connectionTimeout: 5000,
});
