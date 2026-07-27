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

Write-Host "Stopping existing processes listening on port $Port..." -ForegroundColor Yellow
$lines = & "$env:SystemRoot\System32\netstat.exe" -ano | Select-String ":$Port"
$pids = @()
foreach ($line in $lines) {
  $parts = ($line.ToString() -split "\s+") | Where-Object { $_ }
  if ($parts.Length -ge 5 -and $parts[3] -eq "LISTENING") {
    $pids += [int]$parts[4]
  }
}

$pids = $pids | Sort-Object -Unique
foreach ($processId in $pids) {
  try {
    Stop-Process -Id $processId -Force -ErrorAction Stop
    Write-Host "Stopped process $processId" -ForegroundColor DarkGray
  } catch {
    Write-Host "Could not stop process ${processId}: $($_.Exception.Message)" -ForegroundColor DarkYellow
  }
}

Start-Sleep -Seconds 2
Write-Host "Starting ProERP backend on 127.0.0.1:$Port..." -ForegroundColor Cyan
Start-Process `
  -FilePath $Python `
  -ArgumentList @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "$Port") `
  -WorkingDirectory $Backend `
  -WindowStyle Hidden

Start-Sleep -Seconds 4
& (Join-Path $Root "scripts\start-online-backend.ps1") -Port $Port
