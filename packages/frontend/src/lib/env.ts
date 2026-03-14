import { cleanEnv, str } from "envalid";

export const env = cleanEnv(process.env, {
    NODE_ENV: str({ choices: ['development', 'test', 'production', 'staging'] }),
    API_KEY: str(),
})