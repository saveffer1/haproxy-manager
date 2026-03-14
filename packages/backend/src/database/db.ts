import { sql } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

export const db = drizzle({
	client: sql,
	schema,
});
