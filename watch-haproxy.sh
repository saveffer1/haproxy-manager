#!/bin/bash

# HAProxy Config Watcher - Automatically restarts HAProxy when config files change
# Usage: ./watch-haproxy.sh
# Features: Validates haproxy.cfg AND docker-compose.yml, reports which file has errors

set -e

HAPROXY_DIR="./haproxy"
CONTAINER_NAME="haproxy-manager-haproxy-1"  # Adjust based on your docker-compose project name
SERVICE_NAME="haproxy"

get_timestamp() {
    date '+[%Y-%m-%d %H:%M:%S]'
}

echo "$(get_timestamp) 🔍 Watching HAProxy configuration for changes..."
echo "$(get_timestamp) 📁 Watching directory: $HAPROXY_DIR"
echo "$(get_timestamp) 🐳 Container: $CONTAINER_NAME"
echo "$(get_timestamp) 🧩 Service: $SERVICE_NAME"
echo "$(get_timestamp) ✋ Press Ctrl+C to stop watching"
echo ""

# Get initial hash of all config files
get_config_hash() {
    find "$HAPROXY_DIR" -type f \( -name "*.cfg" -o -name "*.html" \) -exec md5sum {} \; | sort | md5sum | cut -d' ' -f1
}

validate_haproxy_config() {
    echo "   $(get_timestamp) 🔍 Validating haproxy config..."
    
    # Ensure containers are ready
    echo "   $(get_timestamp) 🚀 Ensuring containers are ready..."
    docker-compose up -d >/dev/null 2>&1
    sleep 2
    
    # Try validation with retry logic - catch "not running" errors and retry
    max_retries=3
    retry_delay=3
    
    for i in $(seq 0 $((max_retries - 1))); do
        error=$(docker-compose exec -T "$SERVICE_NAME" haproxy -f /usr/local/etc/haproxy/conf.d/ -c 2>&1 || true)
        exit_code=$?
        
        # Check if container is still starting up
        if echo "$error" | grep -q "not running" && [ $i -lt $((max_retries - 1)) ]; then
            echo "   $(get_timestamp) ⏳ Container still starting... Retry $((i+2))/$max_retries..."
            sleep $retry_delay
            continue
        fi
        
        # Success
        if [ $exit_code -eq 0 ]; then
            echo "   $(get_timestamp) ✅ haproxy config VALID (conf.d/)"
            return 0
        fi
        
        # Config syntax error (not a connection issue)
        echo "   $(get_timestamp) ❌ haproxy config SYNTAX ERROR:"
        echo "       $error"
        echo "   $(get_timestamp) File: haproxy/conf.d/*.cfg"
        return 1
    done
    
    echo "   $(get_timestamp) ⚠️  Container failed to become ready after retries"
    return 1
}

validate_docker_compose() {
    echo "   $(get_timestamp) 🔍 Validating docker-compose.yml..."
    if docker-compose config >/dev/null 2>&1; then
        echo "   $(get_timestamp) ✅ docker-compose.yml VALID"
        return 0
    else
        local error=$(docker-compose config 2>&1 || true)
        echo "   $(get_timestamp) ❌ docker-compose.yml SYNTAX ERROR:"
        echo "       $error"
        echo "   $(get_timestamp) File: docker-compose.yml"
        return 1
    fi
}

LAST_HASH=$(get_config_hash)

while true; do
    sleep 2
    
    CURRENT_HASH=$(get_config_hash)
    
    if [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
        echo ""
        echo "$(get_timestamp) 📝 Configuration changes detected!"
        echo "$(get_timestamp) 🔄 Validating configuration files..."
        
        # Validate HAProxy config
        if ! validate_haproxy_config; then
            echo "   $(get_timestamp) ❌ Fix the errors above and save again to retry"
            echo ""
            LAST_HASH="$CURRENT_HASH"
            continue
        fi
        
        # Validate docker-compose
        if ! validate_docker_compose; then
            echo "   $(get_timestamp) ❌ Fix the errors above and save again to retry"
            echo ""
            LAST_HASH="$CURRENT_HASH"
            continue
        fi
        
        # All validations passed - restart HAProxy
        echo ""
        echo "$(get_timestamp) ✅ All configurations VALID! Restarting HAProxy..."
        if docker-compose restart "$SERVICE_NAME"; then
            echo "$(get_timestamp) ✅ HAProxy restarted successfully"
        else
            echo "$(get_timestamp) ❌ Failed to restart HAProxy"
        fi
        
        echo ""
        LAST_HASH="$CURRENT_HASH"
    fi
done
