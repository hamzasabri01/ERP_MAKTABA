# Library Sabri - idempotent Windows launcher
param(
    [switch]$NoBrowser,
    [switch]$ForceRestart
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ScriptDir "backend"
$FrontendDir = Join-Path $ScriptDir "frontend"
$RuntimeDir = Join-Path $ScriptDir ".runtime"
$BackendPort = 8010
$RootVenvPython = Join-Path $ScriptDir ".venv\Scripts\python.exe"
$BackendVenvPython = Join-Path $BackendDir "venv\Scripts\python.exe"
$VenvPython = if (Test-Path $RootVenvPython) { $RootVenvPython } else { $BackendVenvPython }
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

function Write-Info($message) { Write-Host "[INFO] $message" -ForegroundColor Cyan }
function Write-OK($message) { Write-Host "[OK]   $message" -ForegroundColor Green }
function Write-Warn($message) { Write-Host "[WARN] $message" -ForegroundColor Yellow }
function Write-Err($message) { Write-Host "[ERR]  $message" -ForegroundColor Red }

function Stop-ListeningPort([int]$Port) {
    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($ownerId in @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
        if (-not $ownerId -or $ownerId -eq $PID) { continue }
        Stop-Process -Id $ownerId -Force -ErrorAction SilentlyContinue
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { return $true }
        Start-Sleep -Milliseconds 250
    }
    return -not [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Get-BackendHealth {
    try {
        return Invoke-RestMethod "http://127.0.0.1:$BackendPort/health" -TimeoutSec 3
    } catch { return $null }
}

function Test-FrontendHealth {
    try {
        $response = Invoke-RestMethod "http://127.0.0.1:5173/api/health" -TimeoutSec 4
        return $response.status -eq "ok"
    } catch { return $false }
}

function Set-LocalConnectionConfig {
    $config = [ordered]@{
        api_base_url = "/api"
        maintenance_mode = $false
        app_version = "1.0.0"
    } | ConvertTo-Json
    foreach ($path in @(
        (Join-Path $FrontendDir "public\runtime-config.json"),
        (Join-Path $FrontendDir "dist\runtime-config.json")
    )) {
        $parent = Split-Path -Parent $path
        if (Test-Path $parent) {
            [IO.File]::WriteAllText($path, $config, [Text.UTF8Encoding]::new($false))
        }
    }
}

Write-Host "`n===============================" -ForegroundColor Blue
Write-Host " LIBRARY SABRI - START" -ForegroundColor Blue
Write-Host "===============================`n" -ForegroundColor Blue

if (-not (Test-Path $VenvPython)) {
    Write-Err "Python environment missing. Run setup.ps1 first."
    exit 1
}

# Always repair copied/old runtime configuration before launching. The browser
# talks to /api on the same origin; Vite forwards it to the unified backend.
Set-LocalConnectionConfig

# Remove the temporary archive companion from older builds. Archives now use
# the same authenticated backend and database connection on port 8010.
if (-not (Stop-ListeningPort 8001)) {
    Write-Warn "Old archive helper on port 8001 could not be stopped; it is no longer used."
}

$backendHealth = Get-BackendHealth
$backendCurrent = $backendHealth -and ($backendHealth.capabilities -contains "document_archive")
if ($ForceRestart -or -not $backendCurrent) {
    if ($backendHealth) { Write-Info "Replacing an older backend build..." }
    if (-not (Stop-ListeningPort $BackendPort)) {
        Write-Err "Backend port $BackendPort could not be released."
        exit 1
    }

    Write-Info "Starting unified backend..."
    $BackendOut = Join-Path $RuntimeDir "backend.out.log"
    $BackendErr = Join-Path $RuntimeDir "backend.err.log"
    Remove-Item -LiteralPath $BackendOut,$BackendErr -Force -ErrorAction SilentlyContinue
    $backendProc = Start-Process -FilePath $VenvPython `
        -ArgumentList "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "$BackendPort", "--no-proxy-headers" `
        -WorkingDirectory $BackendDir `
        -RedirectStandardOutput $BackendOut `
        -RedirectStandardError $BackendErr `
        -WindowStyle Hidden `
        -PassThru

    $backendHealth = $null
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 500
        if ($backendProc.HasExited) { break }
        $backendHealth = Get-BackendHealth
        if ($backendHealth -and ($backendHealth.capabilities -contains "document_archive")) { break }
    }
    if (-not $backendHealth -or -not ($backendHealth.capabilities -contains "document_archive")) {
        Write-Err "Unified backend failed to start."
        if (Test-Path $BackendErr) { Get-Content $BackendErr -Tail 35 }
        exit 1
    }
    Write-OK "Unified backend ready (PID $($backendProc.Id))"
} else {
    Write-OK "Unified backend already healthy"
}

$frontendHealthy = Test-FrontendHealth
if ($ForceRestart -or -not $frontendHealthy) {
    if (-not (Stop-ListeningPort 5173)) {
        Write-Err "Frontend port 5173 could not be released."
        exit 1
    }
    Write-Info "Starting frontend..."
    $FrontendOut = Join-Path $RuntimeDir "frontend.out.log"
    $FrontendErr = Join-Path $RuntimeDir "frontend.err.log"
    Remove-Item -LiteralPath $FrontendOut,$FrontendErr -Force -ErrorAction SilentlyContinue
    $frontendProc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "set VITE_API_BASE_URL=/api&& set VITE_API_PROXY_TARGET=http://127.0.0.1:$BackendPort&& npm run dev -- --host 0.0.0.0 --port 5173 --strictPort" `
        -WorkingDirectory $FrontendDir `
        -RedirectStandardOutput $FrontendOut `
        -RedirectStandardError $FrontendErr `
        -WindowStyle Hidden `
        -PassThru
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 400
        if (Test-FrontendHealth) { break }
    }
    if (-not (Test-FrontendHealth)) {
        Write-Err "Frontend failed to start."
        if (Test-Path $FrontendErr) { Get-Content $FrontendErr -Tail 25 }
        exit 1
    }
    Write-OK "Frontend ready (PID $($frontendProc.Id))"
} else {
    Write-OK "Frontend already healthy"
}

if (-not $NoBrowser) { Start-Process "http://localhost:5173" }

$LanAddress = $null
try {
    $socket = [Net.Sockets.UdpClient]::new()
    $socket.Connect("8.8.8.8", 80)
    $LanAddress = $socket.Client.LocalEndPoint.Address.ToString()
    $socket.Dispose()
} catch {}

Write-Host "`n[OK] Library Sabri is running" -ForegroundColor Green
Write-Host "Local:   http://localhost:5173" -ForegroundColor Cyan
if ($LanAddress) { Write-Host "Network: http://${LanAddress}:5173" -ForegroundColor Yellow }
Write-Host "API:     http://localhost:$BackendPort" -ForegroundColor Gray
