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

    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue

    if ($connections) {
        $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique

        foreach ($processId  in $pids) {
            try {
                Stop-Process -Id $processId  -Force -ErrorAction SilentlyContinue
                Write-OK "Killed process $processId  on port $port"
            } catch {
                Write-Warn "Cannot kill PID $processId "
            }
        }
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

$backendProc = Start-Process -FilePath $VenvPython `
    -ArgumentList "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--no-proxy-headers" `
    -WorkingDirectory $BackendDir `
    -WindowStyle Hidden `
    -PassThru

# ===============================
# Health Check
# ===============================
Write-Info "Waiting backend health..."

$ok = $false

for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 2

    try {
        Invoke-WebRequest "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
        $ok = $true
        break
    } catch {}
}

if (-not $ok) {
    Write-Err "Backend failed to start"
    Write-Host "Check backend logs manually"
    exit 1
}

Write-OK "Backend running (PID $($backendProc.Id))"

# ===============================
# Start Frontend
# ===============================
Write-Info "Starting frontend..."

$frontendProc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npm run dev" `
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
Write-Host "`n===============================" -ForegroundColor Green
Write-Host " MAKTABA PRINT RUNNING" -ForegroundColor Green
Write-Host "===============================`n" -ForegroundColor Green

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
