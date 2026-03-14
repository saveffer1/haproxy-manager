import { cleanEnv, str, url } from "envalid";

export const env = cleanEnv(process.env, {
    NODE_ENV: str({ default: 'development', choices: ['development', 'test', 'production', 'staging'] }),
    API_KEY: str({ default: "your-default-api-key" }),
    DATABASE_URL: url({ default: "postgres://postgres:password@localhost:5432/haproxy_db" }),
    OTEL_URL: url({ default: "http://localhost:4318/v1/traces" }),
    REDIS_URL: url({ default: "redis://localhost:6379" }),
})