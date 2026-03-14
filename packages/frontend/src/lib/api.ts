import type { App as AppServer } from "@app/backend";
import { treaty } from "@elysiajs/eden";

export const apiClient = treaty<AppServer>("localhost:3000");
