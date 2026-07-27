param(
  [int]$Port = 8000,
  [switch]$Clean
)

$ErrorActionPreference = "Stop"

$env:ComSpec = "$env:WINDIR\System32\cmd.exe"
$env:Path = "$env:WINDIR\System32;$env:WINDIR;$env:WINDIR\System32\WindowsPowerShell\v1.0;$env:Path"

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
  $localCloudflared = Join-Path (Split-Path -Parent $PSScriptRoot) "tools\cloudflared.exe"
  if (Test-Path $localCloudflared) {
    $cloudflared = Get-Item $localCloudflared
  }
}
if (-not $cloudflared) {
  $localCloudflared = Join-Path (Split-Path -Parent $PSScriptRoot) "tools\cloudflared.exe.exe"
  if (Test-Path $localCloudflared) {
    $cloudflared = Get-Item $localCloudflared
  }
}

if (-not $cloudflared) {
  Write-Host "cloudflared is not installed." -ForegroundColor Yellow
  Write-Host "Download it from:" -ForegroundColor Yellow
  Write-Host "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Then either add it to PATH or place cloudflared.exe here:" -ForegroundColor Yellow
  Write-Host ".\tools\cloudflared.exe" -ForegroundColor Cyan
  exit 1
}

if ($Clean) {
  Get-Process | Where-Object { $_.ProcessName -like "cloudflared*" } | ForEach-Object {
    try {
      Stop-Process -Id $_.Id -Force -ErrorAction Stop
      Write-Host "Stopped old cloudflared process $($_.Id)" -ForegroundColor DarkGray
    } catch {
      Write-Host "Could not stop cloudflared process $($_.Id): $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
  }
  Start-Sleep -Seconds 2
}

try {
  $health = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/health" -TimeoutSec 2
  if ($health.StatusCode -ne 200) {
    throw "Backend health check failed"
  }
} catch {
  Write-Host "Backend is not reachable on http://127.0.0.1:$Port" -ForegroundColor Red
  Write-Host "Run .\scripts\start-online-backend.ps1 first." -ForegroundColor Yellow
  exit 1
}

Write-Host "Starting Cloudflare Quick Tunnel for http://127.0.0.1:$Port" -ForegroundColor Cyan
Write-Host "Using HTTP/2 protocol over TCP 443 because some networks block QUIC/UDP." -ForegroundColor Cyan
Write-Host "Copy the generated https://*.trycloudflare.com URL and put it in Firestore as:" -ForegroundColor Yellow
Write-Host "api_base_url = https://xxxx.trycloudflare.com/api" -ForegroundColor Green
Write-Host ""

& $cloudflared.FullName tunnel --protocol http2 --url "http://127.0.0.1:$Port"
