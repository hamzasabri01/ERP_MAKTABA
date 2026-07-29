# ================================
# Maktaba Print Web - Launcher
# ================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$BackendDir = "$ScriptDir\backend"
$FrontendDir = "$ScriptDir\frontend"
$RootVenvPython = "$ScriptDir\.venv\Scripts\python.exe"
$BackendVenvPython = "$BackendDir\venv\Scripts\python.exe"
$VenvPython = if (Test-Path $RootVenvPython) { $RootVenvPython } else { $BackendVenvPython }

# ────────────────────────────────
function Write-Info($msg)  { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-OK($msg)    { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Err($msg)   { Write-Host "[ERR]  $msg" -ForegroundColor Red }
function Write-Warn($msg)  { Write-Host "[WARN] $msg" -ForegroundColor Yellow }

# ────────────────────────────────
Write-Host "`n===============================" -ForegroundColor Blue
Write-Host " MAKTABA PRINT WEB - START" -ForegroundColor Blue
Write-Host "===============================`n" -ForegroundColor Blue

# ===============================
# Kill ports safely (NO netstat)
# ===============================
Write-Info "Cleaning ports 8000 / 5173..."

foreach ($port in @(8000, 5173)) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($listeners) {
        $ownerIds = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($ownerId in $ownerIds) {
            if (-not $ownerId -or $ownerId -eq 0 -or $ownerId -eq $PID) { continue }
            try {
                $ownerName = (Get-Process -Id $ownerId -ErrorAction SilentlyContinue).ProcessName
                Stop-Process -Id $ownerId -Force -ErrorAction Stop
                Write-OK "Stopped $ownerName (PID $ownerId) on port $port"
            } catch {
                Write-Warn "Cannot stop PID $ownerId on port $port"
            }
        }
    }

    # Windows can need a moment to release the listening socket.
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $remaining = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if (-not $remaining) { break }
        Start-Sleep -Milliseconds 250
    }
    $remaining = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($remaining) {
        $blockedBy = ($remaining | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
        Write-Err "Port $port is still occupied by PID $blockedBy"
        Write-Warn "Close the old application or restart Windows, then run start.ps1 again."
        exit 1
    }
}

# ===============================
# Check backend python
# ===============================
if (-not (Test-Path $VenvPython)) {
    Write-Err "Python venv not found!"
    Write-Warn "Run setup.ps1 first"
    exit 1
}

# ===============================
# Start Backend
# ===============================
Write-Info "Starting backend..."

$RuntimeDir = Join-Path $ScriptDir ".runtime"
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
$BackendOut = Join-Path $RuntimeDir "backend.out.log"
$BackendErr = Join-Path $RuntimeDir "backend.err.log"
Remove-Item -LiteralPath $BackendOut,$BackendErr -Force -ErrorAction SilentlyContinue

$backendProc = Start-Process -FilePath $VenvPython `
    -ArgumentList "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers" `
    -WorkingDirectory $BackendDir `
    -RedirectStandardOutput $BackendOut `
    -RedirectStandardError $BackendErr `
    -WindowStyle Hidden `
    -PassThru

# ===============================
# Health Check
# ===============================
Write-Info "Waiting backend health..."

$ok = $false

for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2

    if ($backendProc.HasExited) { break }
    try {
        # Use the explicit IPv4 loopback. Some Windows installations resolve
        # localhost to ::1 while Uvicorn is listening on 0.0.0.0 (IPv4).
        Invoke-WebRequest "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
        $ok = $true
        break
    } catch {}
}

if (-not $ok) {
    Write-Err "Backend failed to start"
    if (Test-Path $BackendErr) {
        Write-Host "`n--- Backend error details ---" -ForegroundColor Yellow
        Get-Content -LiteralPath $BackendErr -Tail 35
    }
    if (Test-Path $BackendOut) {
        Write-Host "`n--- Backend output ---" -ForegroundColor Yellow
        Get-Content -LiteralPath $BackendOut -Tail 15
    }
    Write-Host "`nLogs: $BackendErr" -ForegroundColor Gray
    exit 1
}

Write-OK "Backend running (PID $($backendProc.Id))"

# ===============================
# Start trusted HTTPS scanner tunnel
# ===============================
$cloudflaredProc = $null
$BundledCloudflared = Join-Path $ScriptDir "tools\cloudflared.exe"
$CloudflaredCommand = Get-Command cloudflared -ErrorAction SilentlyContinue
$CloudflaredPath = if (Test-Path $BundledCloudflared) { $BundledCloudflared } elseif ($CloudflaredCommand) { $CloudflaredCommand.Source } else { $null }
if ($CloudflaredPath) {
    Write-Info "Starting HTTPS tunnel for live mobile scanner..."
    $TunnelOut = Join-Path $RuntimeDir "scanner-tunnel.out.log"
    $TunnelErr = Join-Path $RuntimeDir "scanner-tunnel.err.log"
    Remove-Item -LiteralPath $TunnelOut,$TunnelErr -Force -ErrorAction SilentlyContinue
    $cloudflaredProc = Start-Process -FilePath $CloudflaredPath `
        -ArgumentList "tunnel", "--protocol", "http2", "--url", "http://127.0.0.1:8000", "--no-autoupdate" `
        -RedirectStandardOutput $TunnelOut `
        -RedirectStandardError $TunnelErr `
        -WindowStyle Hidden `
        -PassThru
    Write-OK "Mobile scanner HTTPS tunnel starting (PID $($cloudflaredProc.Id))"
} else {
    Write-Warn "cloudflared missing: mobile scanner will use photo mode on HTTP."
}

# ===============================
# Start Frontend
# ===============================
Write-Info "Starting frontend..."

$frontendProc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npm run dev -- --host 0.0.0.0" `
    -WorkingDirectory $FrontendDir `
    -WindowStyle Hidden `
    -PassThru

Start-Sleep 5

# ===============================
# Open Browser
# ===============================
Write-Info "Opening browser..."
Start-Process "http://localhost:5173"

# ===============================
# Summary
# ===============================
$LanAddress = $null
try {
    $socket = New-Object System.Net.Sockets.UdpClient
    $socket.Connect("8.8.8.8", 80)
    $LanAddress = ($socket.Client.LocalEndPoint).Address.ToString()
    $socket.Close()
} catch {
    $LanAddress = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } |
        Select-Object -First 1 -ExpandProperty IPAddress)
}

Write-Host "`n===============================" -ForegroundColor Green
Write-Host " MAKTABA PRINT RUNNING" -ForegroundColor Green
Write-Host "===============================`n" -ForegroundColor Green
Write-Host "  Lien sur ce PC : http://localhost:5173" -ForegroundColor Cyan
if ($LanAddress) {
    Write-Host "  Lien autre PC  : http://${LanAddress}:5173" -ForegroundColor Yellow
    Write-Host "  (Les deux ordinateurs doivent etre sur le meme reseau.)" -ForegroundColor Gray
}

Write-Host "Frontend : http://localhost:5173"
Write-Host "Backend  : http://localhost:8000"
Write-Host "Docs     : http://localhost:8000/docs`n"

Write-Host "Backend PID : $($backendProc.Id)"
Write-Host "Frontend PID: $($frontendProc.Id)`n"

Write-Warn "Close this window to stop services"

# ===============================
# Keep alive
# ===============================
try {
    while ($true) { Start-Sleep 5 }
}
finally {

    Write-Warn "Stopping services..."

    try { Stop-Process -Id $backendProc.Id -Force } catch {}
    try { Stop-Process -Id $frontendProc.Id -Force } catch {}
    if ($cloudflaredProc) {
        try { Stop-Process -Id $cloudflaredProc.Id -Force } catch {}
    }

    foreach ($port in @(8000, 5173)) {

        $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue

        if ($connections) {
            $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique

            foreach ($processId  in $pids) {
                try { Stop-Process -Id $processId  -Force } catch {}
            }
        }
    }

    Write-OK "All services stopped"
}
