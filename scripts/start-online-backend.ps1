param(
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Python = Join-Path $Backend "venv\Scripts\python.exe"

if (-not (Test-Path $Python)) {
  $Python = Join-Path $Root ".venv\Scripts\python.exe"
}

if (-not (Test-Path $Python)) {
  Write-Host "Python venv not found. Run setup first." -ForegroundColor Red
  exit 1
}

try {
  $health = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/health" -TimeoutSec 2
  if ($health.StatusCode -eq 200) {
    try {
      $cors = Invoke-WebRequest `
        -UseBasicParsing `
        -Method Options `
        "http://127.0.0.1:$Port/api/auth/login" `
        -Headers @{
          Origin = "https://app-erp-622bc.web.app"
          "Access-Control-Request-Method" = "POST"
          "Access-Control-Request-Headers" = "content-type"
        } `
        -TimeoutSec 2
      if ($cors.StatusCode -ne 200) {
        throw "Unexpected CORS preflight status $($cors.StatusCode)"
      }
    } catch {
      Write-Host "ProERP backend is running, but it does not allow Firebase Hosting CORS." -ForegroundColor Yellow
      Write-Host "Run .\scripts\restart-online-backend.ps1 to reload backend\.env." -ForegroundColor Yellow
      exit 1
    }
    Write-Host "ProERP backend is already running on 127.0.0.1:$Port" -ForegroundColor Green
    Write-Host "Health: $($health.Content)"
    exit 0
  }
} catch {}

Write-Host "Starting ProERP backend on 127.0.0.1:$Port..." -ForegroundColor Cyan
Push-Location $Backend
& $Python -m uvicorn main:app --host 127.0.0.1 --port $Port
Pop-Location
