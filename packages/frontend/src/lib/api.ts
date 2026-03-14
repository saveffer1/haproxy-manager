import type { App as AppServer } from "@app/backend";
import { treaty } from "@elysiajs/eden";
import { env } from "./env";

const baseURL = (() => {
  if (typeof window === "undefined") {
    // Server-side
    return process.env.BACKEND_URL || "http://localhost:3000";
  }
  // Client-side
  const protocol = window.location.protocol;
  const host = window.location.hostname;
  const port = process.env.NODE_ENV === "production" ? 80 : 3000;
  return `${protocol}//${host}:${port}`;
})();

export const apiClient = treaty<AppServer>(baseURL);
