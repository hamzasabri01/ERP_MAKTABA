param(
  [int]$Port = 8015,
  [string]$Path = "/erp",
  [switch]$NoBuild,
  [switch]$OpenFirewall
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Python = Join-Path $Backend "venv\Scripts\python.exe"
$RuntimeConfig = Join-Path $Frontend "public\runtime-config.json"
$DistRuntimeConfig = Join-Path $Frontend "dist\runtime-config.json"

if (-not (Test-Path $Python)) {
  $Python = Join-Path $Root ".venv\Scripts\python.exe"
}

if (-not (Test-Path $Python)) {
  Write-Host "Python venv not found." -ForegroundColor Red
  exit 1
}

$config = [ordered]@{
  api_base_url = "/api"
  maintenance_mode = $false
  app_version = "1.0.0"
}
$config | ConvertTo-Json | Set-Content -Path $RuntimeConfig -Encoding UTF8
if (Test-Path (Split-Path -Parent $DistRuntimeConfig)) {
  $config | ConvertTo-Json | Set-Content -Path $DistRuntimeConfig -Encoding UTF8
}
Write-Host "runtime-config.json set to same-origin /api" -ForegroundColor Green

Get-Process cloudflared -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    Stop-Process -Id $_.Id -Force -ErrorAction Stop
    Write-Host "Stopped cloudflared process $($_.Id)" -ForegroundColor DarkGray
  } catch {}
}

if (-not $NoBuild) {
  Write-Host "Building frontend for LAN mode..." -ForegroundColor Cyan
  Push-Location $Frontend
  npm run build
  if ($LASTEXITCODE -ne 0) {
    Pop-Location
    throw "Frontend build failed"
  }
  Pop-Location
}

Write-Host "Stopping existing listeners on port $Port..." -ForegroundColor Yellow
$lines = & "$env:SystemRoot\System32\netstat.exe" -ano | Select-String ":$Port"
$pids = @()
foreach ($line in $lines) {
  $parts = ($line.ToString() -split "\s+") | Where-Object { $_ }
  if ($parts.Length -ge 5 -and $parts[3] -eq "LISTENING") {
    $pids += [int]$parts[4]
  }
}
$pids | Sort-Object -Unique | ForEach-Object {
  try { Stop-Process -Id $_ -Force -ErrorAction Stop } catch {}
}

if ($OpenFirewall) {
  Write-Host "Adding Windows Firewall rule for TCP $Port..." -ForegroundColor Cyan
  & "$env:SystemRoot\System32\netsh.exe" advfirewall firewall add rule name="ProERP LAN $Port" dir=in action=allow protocol=TCP localport=$Port | Out-Null
}

$ip = $null
try {
  $ip = (
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.PrefixOrigin -ne "WellKnown"
    } |
    Select-Object -First 1 -ExpandProperty IPAddress
  )
} catch {
  $ipconfig = & "$env:SystemRoot\System32\ipconfig.exe"
  $ip = ($ipconfig | Select-String "IPv4" | ForEach-Object {
    if ($_.ToString() -match "(\d{1,3}(?:\.\d{1,3}){3})") { $matches[1] }
  } | Where-Object {
    $_ -notlike "127.*" -and $_ -notlike "169.254.*"
  } | Select-Object -First 1)
}

if (-not $ip) {
  $ip = "SERVER-IP"
}

Write-Host "Starting ProERP LAN server on 0.0.0.0:$Port..." -ForegroundColor Cyan
Start-Process `
  -FilePath $Python `
  -ArgumentList @("-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "$Port") `
  -WorkingDirectory $Backend `
  -WindowStyle Hidden

Start-Sleep -Seconds 4
$health = $null
for ($i = 1; $i -le 10; $i++) {
  try {
    $health = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/health" -TimeoutSec 5
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}

if (-not $health) {
  throw "Backend did not answer on http://127.0.0.1:$Port/health"
}

Write-Host "Health: $($health.Content)" -ForegroundColor Green
Write-Host ""
Write-Host "Open on this computer:" -ForegroundColor Cyan
Write-Host "  http://127.0.0.1:$Port$Path" -ForegroundColor Green
Write-Host "Open from phone / another PC on the same Wi-Fi/LAN:" -ForegroundColor Cyan
Write-Host "  http://$ip`:$Port$Path" -ForegroundColor Green
Write-Host ""
Write-Host "No cloudflared. No Firebase Hosting required for LAN mode." -ForegroundColor Yellow
