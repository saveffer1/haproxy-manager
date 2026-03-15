# 🚀 HAProxy Manager

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

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Backend API | ElysiaJS |
| Frontend UI | React 18 + Vite |
| Database | PostgreSQL + Drizzle ORM |
| Cache | Redis |
| Load Balancer | HAProxy 2.8 |
| Container Orchestration | Docker Compose |
| Observability | OpenTelemetry + Jaeger |
| Logging | Logixlysia |

## 📋 Prerequisites

- **Bun** (v1.0+) - [Install](https://bun.sh)
- **Docker** & **Docker Compose** - [Install](https://www.docker.com/products/docker-desktop)
- **Git** - For version control

## 🚀 Quick Start

### Automated Setup (Windows/macOS)

```bash
# Windows
./setup.bat

# macOS/Linux
./setup.sh
```

The setup script will:
1. Install dependencies
2. Start Docker services (PostgreSQL, Redis, HAProxy, Jaeger)
3. Initialize database schema
4. Display access URLs

### Manual Setup

1. **Install dependencies**
   ```bash
   bun install
   ```

2. **Start infrastructure services**
   ```bash
   docker-compose up -d
   ```

3. **Wait for PostgreSQL to be ready**
   ```bash
   # Wait ~30 seconds for the database to initialize
   ```

4. **Initialize database schema**
   ```bash
   bun --filter @app/backend run db:push
   ```

5. **Default node is auto-registered on backend startup**
  - The backend seeds one default node if no node exists with the same name or IP.
  - Configure it with environment variables:
    - `DEFAULT_NODE_NAME` (default: `local-haproxy-node`)
    - `DEFAULT_NODE_IP_ADDRESS` (default: `127.0.0.1`)
    - `DEFAULT_NODE_TYPE` (`managed` or `monitored`, default: `managed`)
    - `DEFAULT_NODE_LOG_STRATEGY` (`docker`, `file`, `journald`, default: `docker`)
    - `DEFAULT_NODE_LOG_PATH` (optional, default: empty)
    - `DEFAULT_NODE_SSH_USER` (default: `root`)

6. **Start development servers**
   
   In one terminal:
   ```bash
   bun dev:backend
   ```
   
   In another terminal:
   ```bash
   bun dev:frontend
   ```

## 🌐 Access Points

Once running, you can access:

| Service | URL | Purpose |
|---------|-----|---------|
| **Frontend** | http://localhost:5173 | HAProxy Manager UI |
| **Backend API** | http://localhost:3000 | REST API Server |
| **API Docs** | http://localhost:3000/swagger | OpenAPI Documentation |
| **HAProxy Stats Screen** | http://localhost:5173/dashboard/stats | In-app HAProxy Stats (login required) |
| **Jaeger Tracing** | http://localhost:16686 | Distributed Tracing UI |

## 📖 API Documentation

### Nodes Management

#### Get All Nodes
```http
GET /api/nodes
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "web-server-1",
      "ipAddress": "192.168.1.100",
      "type": "managed",
      "logStrategy": "docker",
      "sshUser": "root",
      "createdAt": "2026-03-14T10:00:00Z"
    }
  ]
}
```

#### Create Node
```http
POST /api/nodes
Content-Type: application/json

{
  "name": "web-server-1",
  "ipAddress": "192.168.1.100",
  "type": "monitored",
  "logStrategy": "docker",
  "sshUser": "root",
  "logPath": "/var/log/haproxy.log"
}
```

#### Update Node
```http
PATCH /api/nodes/:id
Content-Type: application/json

{
  "name": "web-server-1-updated",
  "ipAddress": "192.168.1.101"
}
```

#### Delete Node
```http
DELETE /api/nodes/:id
```

#### Get Node Details
```http
GET /api/nodes/:id
```

### HAProxy Stats

#### Get HAProxy Status
```http
GET /haproxy/stats
```

#### Get HAProxy Stats Dashboard HTML (for frontend screen)
```http
GET /haproxy/stats/ui
```

Optional query:
```http
GET /haproxy/stats/ui?theme=light
GET /haproxy/stats/ui?theme=dark
```

Notes:
- Requires an active Better Auth session cookie (must be logged in).
- Does not require API key headers for this endpoint.
- Proxies the internal HAProxy stats page with basic auth credentials from backend environment variables.

Response:
```json
{
  "status": "online",
  "uptime": "2h 45m",
  "active_sessions": 120,
  "connections_rate": 450
}
```

## 🗄️ Database Schema

### Nodes Table
```sql
CREATE TABLE nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  type node_type DEFAULT 'monitored',
  log_strategy log_strategy DEFAULT 'docker',
  log_path TEXT,
  ssh_user TEXT DEFAULT 'root',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Types
CREATE TYPE node_type AS ENUM ('managed', 'monitored');
CREATE TYPE log_strategy AS ENUM ('docker', 'file', 'journald');
```

### User Tables (Auth)
- `user` - User account information
- `session` - Active user sessions
- `account` - OAuth account linking

## 🔧 Development Commands

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
docker-compose up -d      # Start services
docker-compose down       # Stop services
docker-compose logs -f    # View logs
```

## 📊 HAProxy Configuration

The HAProxy configuration is located at `./haproxy/haproxy.cfg` and includes:

### Features
- **Stats Dashboard Security**: Stats endpoint is protected with basic auth and only accepts localhost source traffic
- **In-App Stats Screen**: Dashboard page fetches stats UI via backend proxy endpoint (`/haproxy/stats/ui`)
- **Load Balancing**: Round-robin by default
- **Health Checks**: HTTP GET checks on configured backends
- **Logging**: Structured HTTP logging
- **Multiple Backends**: Support for web servers and API servers

### Architecture
```
HAProxy (Port 80/8404)
├── Frontend: main_http (Port 80)
│   └── Backend: web_servers (Round-robin)
│       ├── Server 1 (127.0.0.1:8001)
│       └── Server 2 (127.0.0.1:8002)
└── Frontend: stats (Port 8404)
    └── Stats Dashboard
```

## 📦 Project Structure

```
haproxy-manager/
├── packages/
│   ├── backend/                    # ElysiaJS API Server
│   │   ├── src/
│   │   │   ├── index.ts           # Main API server
│   │   │   ├── lib/
│   │   │   │   ├── env.ts         # Environment validation
│   │   │   │   └── auth.ts        # Authentication logic
│   │   │   └── database/
│   │   │       ├── db.ts          # Database client
│   │   │       ├── redis.ts       # Redis client
│   │   │       └── schema.ts      # Drizzle ORM schema
│   │   ├── drizzle.config.ts      # Drizzle configuration
│   │   ├── drizzle/               # Migration files
│   │   └── package.json
│   │
│   └── frontend/                  # React + Vite App
│       ├── src/
│       │   ├── App.tsx            # Main component
│       │   ├── App.css            # Styling
│       │   ├── main.tsx           # Entry point
│       │   └── lib/
│       │       ├── api.ts         # API client
│       │       └── env.ts         # Environment
│       ├── index.html             # HTML template
│       └── package.json
│
├── haproxy/
│   └── haproxy.cfg               # HAProxy configuration
│
├── docker-compose.yml            # Docker services
├── package.json                  # Workspace root
├── tsconfig.json                 # TypeScript config
└── biome.json                    # Code formatting/linting
```

## 🔐 Environment Variables

### Backend `.env`
```env
NODE_ENV=development
API_KEY=your-secure-api-key-here
DATABASE_URL=postgres://postgres:<your-password>@localhost:5432/haproxy_db
OTEL_URL=http://localhost:4318/v1/traces
REDIS_URL=redis://localhost:6379
HAPROXY_STATS_URL=http://localhost:8404/stats
HAPROXY_STATS_USERNAME=<your-stats-username>
HAPROXY_STATS_PASSWORD=<your-stats-password>
```

## 🐳 Docker Services

The docker-compose.yml includes:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| postgres | postgres:17-alpine | 5432 | Primary database |
| redis | redis:alpine | 6379 | Session/cache storage |
| haproxy | haproxy:3.3-alpine | 8080, 127.0.0.1:8404 | Load balancer |
| otel-collector | jaegertracing/all-in-one | 16686, 4318 | Tracing and observability |
| backend | oven/bun:alpine | 3000 | API server |
| frontend | oven/bun:alpine | 5173 | Web UI |

## 🧪 Testing

### API Testing with cURL

```bash
# Get all nodes
curl http://localhost:3000/api/nodes

# Add a new node
curl -X POST http://localhost:3000/api/nodes \
  -H "Content-Type: application/json" \
  -d '{
    "name": "web-1",
    "ipAddress": "192.168.1.100",
    "type": "monitored",
    "logStrategy": "docker",
    "sshUser": "root"
  }'

# Get HAProxy stats
curl http://localhost:3000/haproxy/stats
```

## 🔄 Database Migrations

Migrations are managed with Drizzle Kit:

```bash
# Create a new migration
bunx drizzle-kit generate:pg

# Apply pending migrations
bun --filter @app/backend run db:push

# Open Drizzle Studio (GUI for database)
bun --filter @app/backend run db:studio
```

## 🛡️ Security Considerations

- Store sensitive data in environment variables (not in code)
- Use strong API keys for production
- Enable SSH key authentication for node access
- Implement OAuth with better-auth
- Use HTTPS in production
- Keep HAProxy and dependencies updated
- Regular security audits of the codebase

## 📈 Performance Tips

1. **Database**: Index frequently queried columns
2. **Cache**: Use Redis for frequently accessed data
3. **Frontend**: Code splitting with Vite
4. **API**: Implement pagination for large datasets
5. **HAProxy**: Tune connection timeouts and pool sizes

## 🐛 Troubleshooting

### PostgreSQL Connection Refused
```bash
# Check if postgres is running
docker-compose ps

# Restart postgres
docker-compose restart postgres

# Check logs
docker-compose logs postgres
```

### Port Already in Use
```bash
# Find and kill process using port
# Windows: netstat -ano | findstr :3000
# Linux/Mac: lsof -i :3000
```

### Database Migrations Failed
```bash
# Reset database (WARNING: Deletes all data)
docker-compose down -v
docker-compose up -d postgres redis
sleep 30
bun --filter @app/backend run db:push
```

## 📚 Resources

- [ElysiaJS Docs](https://elysiajs.com)
- [Drizzle ORM](https://orm.drizzle.team)
- [React Documentation](https://react.dev)
- [HAProxy Docs](http://www.haproxy.org/)
- [Docker Docs](https://docs.docker.com)
- [Bun Workspaces](https://bun.sh/docs/workspaces)

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📧 Support

For issues and questions, please create an issue on GitHub.

---

**Happy coding! 🚀**