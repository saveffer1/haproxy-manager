FROM oven/bun:1-alpine

RUN apk add --no-cache docker-cli

WORKDIR /workspace

COPY package.json bun.lock tsconfig.json ./
COPY packages/backend/package.json packages/backend/package.json

RUN bun install

COPY packages/backend ./packages/backend

WORKDIR /workspace/packages/backend

EXPOSE 3000

CMD ["sh", "-lc", "attempts=0; until bun run db:push; do attempts=$((attempts + 1)); if [ \"$attempts\" -ge 40 ]; then echo \"[backend] db:push failed after multiple retries\"; exit 1; fi; echo \"[backend] waiting for database...\"; sleep 2; done; exec bun run start"]