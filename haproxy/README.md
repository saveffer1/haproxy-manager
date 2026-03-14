# HAProxy Modular Configuration

This directory contains HAProxy configuration files organized in a modular structure for managing multiple services.

## Directory Structure

```
haproxy/
├── haproxy.cfg              # Main configuration file (includes all config/*.cfg)
├── nginx-helloworld.html    # Test HTML for nginx service demo
├── config/                  # Service-specific configuration directory
│   └── nginx-helloworld.cfg # Working example: Nginx hello world service
└── README.md                # This file
```

## How It Works

The main `haproxy.cfg` contains:
- **Global settings** - stats socket, daemon mode, max connections
- **Defaults** - timeouts, balance algorithm, logging defaults
- **Core services** - Stats frontend (port 8404), API frontend (port 3000), API backend, and Include directive
- **Include directive** - `include /usr/local/etc/haproxy/config/*.cfg` (loads all service-specific configs)

Service-specific configs (like `nginx1.cfg`) define their own frontends/backends with custom ports and servers.

## Auto-Restart on Config Changes

During development, you can automatically restart HAProxy when configuration files change:

**Windows (PowerShell):**
```powershell
.\watch-haproxy.ps1
```

**Mac/Linux (Bash):**
```bash
./watch-haproxy.sh
```

The watcher will:
- Monitor all `.cfg` and `.html` files in the `haproxy/` directory
- Validate configuration syntax before restart
- Automatically restart HAProxy container when changes are detected
- Display status updates in real-time

Press `Ctrl+C` to stop watching.

## Adding a New Service

To add a new service (e.g., `config/myservice.cfg`):

1. Create a new file in the `config/` directory:
   ```bash
   cat > config/myservice.cfg << 'EOF'
   # Frontend for My Service
   frontend myservice_http
       bind *:8090
       mode http
       default_backend myservice_servers
       option httplog
       log global

   # Backend for My Service
   backend myservice_servers
       mode http
       balance roundrobin
       option httpchk GET /health HTTP/1.1\r\nHost:\ localhost
       http-check expect status 200
       default-server inter 2s fall 3 rise 2
       log global
       
       server myservice1 myservice:8080 check
   EOF
   ```

2. Add the port to `docker-compose.yml` HAProxy service if using a new port

3. No changes needed to `haproxy.cfg` - it will auto-include the new file!

4. Reload HAProxy configuration:
   ```bash
   docker-compose restart haproxy
   # OR use API endpoint (when implemented):
   # curl -X POST http://localhost:3000/haproxy/reload
   ```

## Available Ports

- **8404**: HAProxy Stats Dashboard (`/stats`)
- **3000**: API Frontend (backend on docker-compose)
- **8080**: Nginx Hello World Frontend (via nginx1.cfg)

## Configuration Examples

### Simple HTTP Service

```cfg
frontend myservice_http
    bind *:8090
    mode http
    default_backend myservice_servers
    option httplog
    log global

backend myservice_servers
    mode http
    balance roundrobin
    option httpchk GET /health HTTP/1.1\r\nHost:\ localhost
    http-check expect status 200
    default-server inter 2s fall 3 rise 2
    
    server myservice1 myservice:8080 check
    server myservice2 myservice:8080 check
```

### HTTPS Service with SSL

```cfg
frontend myservice_https
    bind *:8443 ssl crt /etc/ssl/private/myservice.pem
    mode http
    default_backend myservice_servers
    option httplog
    log global

backend myservice_servers
    mode http
    balance roundrobin
    option httpchk GET /health HTTP/1.1\r\nHost:\ localhost
    http-check expect status 200
    default-server inter 2s fall 3 rise 2
    timeout server 120000
    
    server myservice1 myservice:443 ssl check
```

### Service with Path-Based Routing

```cfg
frontend routing_http
    bind *:8090
    mode http
    
    # Route /api to api backend
    acl is_api path_beg /api
    use_backend api_servers if is_api
    
    # Route /static to static backend
    acl is_static path_beg /static
    use_backend static_servers if is_static
    
    # Default backend
    default_backend web_servers
    
    log global

backend api_servers
    mode http
    balance roundrobin
    server api1 api:3000 check

backend static_servers
    mode http
    balance roundrobin
    server static1 static:8080 check

backend web_servers
    mode http
    balance roundrobin
    server web1 web:5173 check
```

## Testing Configuration

Validate HAProxy configuration syntax:

```bash
# Inside container
docker-compose exec haproxy haproxy -f /usr/local/etc/haproxy/haproxy.cfg -c

# Or check logs
docker-compose logs haproxy
```

## API Integration (Future)

Once the HAProxy API endpoints are fully implemented, you can:

```bash
# Get current config
curl http://localhost:3000/haproxy/config

# Get stats
curl http://localhost:3000/haproxy/stats

# Reload after config changes
curl -X POST http://localhost:3000/haproxy/reload
```

## Best Practices

1. **Naming Convention**: Use descriptive names like `servicename.cfg`
2. **Logging**: Always include `log global` in frontends and backends
3. **Health Checks**: Always include `option httpchk` for monitoring
4. **Timeouts**: Set appropriate `timeout server` for long-running operations
5. **Comments**: Document each service's purpose and configuration
6. **No Duplicates**: Ensure frontend/backend names are unique across all config files
7. **Testing**: Test new configs locally before deploying to production

## Troubleshooting

**HAProxy won't start**: Check `docker-compose logs haproxy` for syntax errors
**Service unreachable**: Verify backend server addresses in config files
**Slow responses**: Check timeout settings (connect, client, server)
**Connection refused**: Ensure services are running on specified ports
