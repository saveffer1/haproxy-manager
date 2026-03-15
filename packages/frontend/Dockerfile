FROM oven/bun:1-alpine AS build

WORKDIR /workspace

COPY package.json bun.lock tsconfig.json ./
COPY packages/backend/package.json packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json

RUN bun install

COPY packages/backend ./packages/backend
COPY packages/frontend ./packages/frontend

ARG VITE_BACKEND_URL=http://localhost:3000

ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

RUN cd packages/frontend && bun run build

FROM nginx:alpine

RUN apk add --no-cache openssl

COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/packages/frontend/dist /usr/share/nginx/html

EXPOSE 80
EXPOSE 443

CMD ["nginx", "-g", "daemon off;"]