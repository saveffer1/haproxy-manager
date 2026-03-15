# HAProxy Manager

A full-stack application for managing HAProxy infrastructure with real-time monitoring and configuration management.

## Stack Overview

### Architecture
- **Monorepo**: Using Bun Workspaces for unified dependency management
- **Backend**: ElysiaJS REST API with OpenAPI documentation
- **Frontend**: React + Vite with type-safe API client (Eden Treaty)
- **Database**: PostgreSQL with Drizzle ORM
- **Cache**: Redis for session and configuration caching
- **Load Balancer**: HAProxy with Docker container orchestration
- **Monitoring**: OpenTelemetry + Jaeger for distributed tracing

## Prerequisites

- **Bun** (v1.0+) - [Install](https://bun.sh)
- **Docker** & **Docker Compose** - [Install](https://www.docker.com/products/docker-desktop)
- **Git** - For version control
- **SSH Client** - For remote server management (optional)

## Quick Start

1. **(Optional) copy env template**
  ```bash
  cp .env.example .env
  ```
  You can skip this step if defaults are fine.

Environment strategy:
- Use root `.env` as the single shared env source for Docker Compose.
- Frontend build variables are injected only from `docker-compose.yml` build args.

2. **Start everything**
  ```bash
  docker compose up -d --build
  ```

3. **Open Web UI**
  - http://localhost:5173

4. **Login with default account**
  - Username: `admin`
  - Password: `admin12345`

5. **Default node is auto-created**
  - Name: `docker-haproxy-localnode`
  - Target HAProxy: `haproxy` service in compose network
  - The seed is idempotent (won't duplicate by same name/IP)

### Forgot Password (Reset via Docker Exec)

If you cannot login to Web UI, reset password directly from backend container:

```bash
docker compose exec backend bun run auth:reset-password -- --username admin --password NewStrongPassword123
```

For multi-user environments, use one of these selectors explicitly:

```bash
docker compose exec backend bun run auth:reset-password -- --username someuser --password NewStrongPassword123
docker compose exec backend bun run auth:reset-password -- --email user@example.com --password NewStrongPassword123
```

Short one-shot command (default admin):

```bash
docker compose exec backend bun run auth:reset-admin -- --password NewStrongPassword123
```

Or by email:

```bash
docker compose exec backend bun run auth:reset-password -- --email admin@local.dev --password NewStrongPassword123
```

## Development Commands

```bash
# Run everything
bun dev

# Run only backend
bun dev:backend

# Run only frontend
bun dev:frontend

# Format code with Biome
bun run format

# Lint code with Biome
bun run lint

# Database operations
bun --filter @app/backend run db:push          # Apply migrations
bun --filter @app/backend run db:studio        # Open Drizzle Studio

# Docker operations
docker compose up -d --build      # Start services
docker compose down               # Stop services
docker compose logs -f            # View logs

# Password reset from container
docker compose exec backend bun run auth:reset-password -- --username admin --password NewStrongPassword123
docker compose exec backend bun run auth:reset-password -- --email admin@local.dev --password NewStrongPassword123
docker compose exec backend bun run auth:reset-admin -- --password NewStrongPassword123
```

## HAProxy Configuration

The HAProxy configuration is located at `./haproxy/haproxy.cfg` and includes:

### Features
- **Stats Dashboard Security**: Stats endpoint is protected with basic auth and only accepts localhost source traffic
- **In-App Stats Screen**: Dashboard page fetches stats UI via backend proxy endpoint (`/haproxy/stats/ui`)
- **Load Balancing**: Round-robin by default
- **Health Checks**: HTTP GET checks on configured backends
- **Logging**: Structured HTTP logging
- **Multiple Backends**: Support for web servers and API servers


## Database Migrations

Migrations are managed with Drizzle Kit:

```bash
# Create a new migration
bunx drizzle-kit generate:pg

# Apply pending migrations
bun --filter @app/backend run db:push

# Open Drizzle Studio (GUI for database)
bun --filter @app/backend run db:studio
```

## Resources

- [ElysiaJS Docs](https://elysiajs.com)
- [Drizzle ORM](https://orm.drizzle.team)
- [React Documentation](https://react.dev)
- [HAProxy Docs](http://www.haproxy.org/)
- [Docker Docs](https://docs.docker.com)
- [Bun Workspaces](https://bun.sh/docs/workspaces)
