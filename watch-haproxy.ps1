# HAProxy Config Watcher - Automatically restarts HAProxy when config files change
# Usage: .\watch-haproxy.ps1
# Features: Validates haproxy.cfg AND docker-compose.yml, reports which file has errors

param(
    [string]$ProjectName = "haproxy-manager"
)

$haproxyDir = ".\haproxy"
$containerName = "$($ProjectName)-haproxy-1"
$serviceName = "haproxy"

function Get-TimeStamp {
    return (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
}

Write-Host "[$(Get-TimeStamp)] 🔍 Watching HAProxy configuration for changes..." -ForegroundColor Cyan
Write-Host "[$(Get-TimeStamp)] 📁 Watching directory: $haproxyDir" -ForegroundColor Cyan
Write-Host "[$(Get-TimeStamp)] 🐳 Container: $containerName" -ForegroundColor Cyan
Write-Host "[$(Get-TimeStamp)] 🧩 Service: $serviceName" -ForegroundColor Cyan
Write-Host "[$(Get-TimeStamp)] ✋ Press Ctrl+C to stop watching" -ForegroundColor Yellow
Write-Host ""

# Function to get hash of all config files
function Get-ConfigHash {
    $files = Get-ChildItem -Path $haproxyDir -Recurse -Include "*.cfg", "*.html" -ErrorAction SilentlyContinue
    $hashString = ($files | Sort-Object -Property FullName | ForEach-Object { (Get-FileHash $_.FullName -Algorithm MD5).Hash } | Join-String) 
    $hashAlgo = [System.Security.Cryptography.MD5]::Create()
    $hash = $hashAlgo.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($hashString))
    return [BitConverter]::ToString($hash) -replace "-", ""
}

function Validate-HAProxyConfig {
    Write-Host "   [$(Get-TimeStamp)] 🔍 Validating haproxy config..." -ForegroundColor Gray
    
    # Ensure containers are ready
    Write-Host "   [$(Get-TimeStamp)] 🚀 Ensuring containers are ready..." -ForegroundColor Cyan
    docker-compose up -d 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    
    # Try validation with retry logic - catch "not running" errors and retry
    $maxRetries = 3
    $retryDelay = 3
    
    for ($i = 0; $i -lt $maxRetries; $i++) {
        $validation = docker-compose exec -T $serviceName haproxy -f /usr/local/etc/haproxy/conf.d/ -c 2>&1
        $exitCode = $LASTEXITCODE
        
        # Check if container is still starting up
        if ($validation -like "*not running*" -and $i -lt ($maxRetries - 1)) {
            Write-Host "   [$(Get-TimeStamp)] ⏳ Container still starting... Retry $($i+2)/$maxRetries..." -ForegroundColor Cyan
            Start-Sleep -Seconds $retryDelay
            continue
        }
        
        # Success
        if ($exitCode -eq 0) {
            return @{ 
                Valid = $true
                Message = "   [$(Get-TimeStamp)] ✅ haproxy config VALID (conf.d/)"
            }
        }
        
        # Config syntax error (not a connection issue)
        return @{ 
            Valid = $false
            Message = "   [$(Get-TimeStamp)] ❌ haproxy config SYNTAX ERROR:`n       $validation"
            File = "haproxy/conf.d/*.cfg"
        }
    }
    
    return @{ 
        Valid = $false
        Message = "   [$(Get-TimeStamp)] ⚠️  Container failed to become ready after retries"
        File = "haproxy/conf.d/"
    }
}

function Validate-DockerCompose {
    Write-Host "   [$(Get-TimeStamp)] 🔍 Validating docker-compose.yml..." -ForegroundColor Gray
    try {
        $validation = docker-compose config 2>&1
        if ($LASTEXITCODE -eq 0) {
            return @{ 
                Valid = $true
                Message = "   [$(Get-TimeStamp)] ✅ docker-compose.yml VALID"
            }
        } else {
            return @{ 
                Valid = $false
                Message = "   [$(Get-TimeStamp)] ❌ docker-compose.yml SYNTAX ERROR:`n       $validation"
                File = "docker-compose.yml"
            }
        }
    } catch {
        return @{ 
            Valid = $false
            Message = "   [$(Get-TimeStamp)] ⚠️  Cannot validate docker-compose: $_"
            File = "docker-compose.yml"
        }
    }
}

$lastHash = Get-ConfigHash

while ($true) {
    Start-Sleep -Seconds 2
    
    $currentHash = Get-ConfigHash
    
    if ($currentHash -ne $lastHash) {
        Write-Host ""
        Write-Host "[$(Get-TimeStamp)] 📝 Configuration changes detected!" -ForegroundColor Yellow
        Write-Host "[$(Get-TimeStamp)] 🔄 Validating configuration files..." -ForegroundColor Yellow
        
        # Validate HAProxy config first
        $haproxyValidation = Validate-HAProxyConfig
        Write-Host $haproxyValidation.Message -ForegroundColor $(if ($haproxyValidation.Valid) { "Green" } else { "Red" })
        
        if (-not $haproxyValidation.Valid) {
            Write-Host "   [$(Get-TimeStamp)] File: $($haproxyValidation.File)" -ForegroundColor Red
            Write-Host "   [$(Get-TimeStamp)] ❌ Fix the errors above and save again to retry" -ForegroundColor Yellow
            Write-Host ""
            $lastHash = $currentHash
            continue
        }
        
        # Validate docker-compose
        $dockerValidation = Validate-DockerCompose
        Write-Host $dockerValidation.Message -ForegroundColor $(if ($dockerValidation.Valid) { "Green" } else { "Red" })
        
        if (-not $dockerValidation.Valid) {
            Write-Host "   [$(Get-TimeStamp)] File: $($dockerValidation.File)" -ForegroundColor Red
            Write-Host "   [$(Get-TimeStamp)] ❌ Fix the errors above and save again to retry" -ForegroundColor Yellow
            Write-Host ""
            $lastHash = $currentHash
            continue
        }
        
        # All validations passed - restart HAProxy
        Write-Host ""
        Write-Host "[$(Get-TimeStamp)] ✅ All configurations VALID! Restarting HAProxy..." -ForegroundColor Green
        try {
            docker-compose restart $serviceName 2>&1 | ForEach-Object { Write-Host "   [$(Get-TimeStamp)] $_" }
            Write-Host "[$(Get-TimeStamp)] ✅ HAProxy restarted successfully" -ForegroundColor Green
        } catch {
            Write-Host "[$(Get-TimeStamp)] ❌ Failed to restart HAProxy: $_" -ForegroundColor Red
        }
        
        Write-Host ""
        $lastHash = $currentHash
    }
}
