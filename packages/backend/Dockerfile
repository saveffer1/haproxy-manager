FROM oven/bun:1-alpine

RUN apk add --no-cache docker-cli logrotate

WORKDIR /workspace

COPY package.json bun.lock tsconfig.json ./
COPY packages/backend/package.json packages/backend/package.json

RUN bun install

COPY packages/backend ./packages/backend
COPY packages/backend/logrotate.cfg /etc/logrotate.d/backend

WORKDIR /workspace/packages/backend

# Run logrotate daily for backend file logs
RUN mkdir -p /var/lib/logrotate \
	&& printf "0 0 * * * /usr/sbin/logrotate -s /var/lib/logrotate/backend.status /etc/logrotate.d/backend\n" > /etc/crontabs/root

EXPOSE 3000

CMD ["sh", "-lc", "mkdir -p ./logs; crond; attempts=0; until bun run db:push; do attempts=$((attempts + 1)); if [ \"$attempts\" -ge 40 ]; then echo \"[backend] db:push failed after multiple retries\"; exit 1; fi; echo \"[backend] waiting for database...\"; sleep 2; done; exec bun run start"]