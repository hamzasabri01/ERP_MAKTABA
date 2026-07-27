$ErrorActionPreference = "Stop"

$env:ComSpec = "$env:WINDIR\System32\cmd.exe"
$env:Path = "$env:WINDIR\System32;$env:WINDIR;$env:WINDIR\System32\WindowsPowerShell\v1.0;$env:Path"
# Some corporate networks replace Google certificates with an internal CA.
# This keeps the workaround scoped to this Firebase CLI process.
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

$Root = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $Root "frontend"

Write-Host "[1/4] Checking Firebase CLI..." -ForegroundColor Cyan
$firebase = Get-Command firebase -ErrorAction SilentlyContinue
if (-not $firebase) {
  $npmPrefix = (& npm config get prefix).Trim()
  $firebaseCmd = Join-Path $npmPrefix "firebase.cmd"
  if (Test-Path $firebaseCmd) {
    $firebase = Get-Item $firebaseCmd
  }
}
if (-not $firebase) {
  Write-Host "Firebase CLI is not installed." -ForegroundColor Yellow
  Write-Host "Install it with: npm install -g firebase-tools" -ForegroundColor Yellow
  exit 1
}

Write-Host "[2/4] Building frontend..." -ForegroundColor Cyan
Push-Location $Frontend
npm run build
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  throw "Frontend build failed"
}
Pop-Location

Write-Host "[3/4] Deploying hosting and Firestore rules..." -ForegroundColor Cyan
Write-Host "Ensuring Firebase Hosting site exists..." -ForegroundColor Cyan
& $firebase.FullName hosting:sites:create app-erp-622bc --project app-erp-622bc
if ($LASTEXITCODE -ne 0) {
  Write-Host "Hosting site may already exist or cannot be created automatically. Continuing deploy..." -ForegroundColor Yellow
}

& $firebase.FullName deploy --project app-erp-622bc --only hosting,firestore:rules
if ($LASTEXITCODE -ne 0) {
  throw "Firebase deploy failed. Check Firebase Hosting/Firestore are enabled for project app-erp-622bc, then retry deploy."
}

Write-Host "[4/4] Done." -ForegroundColor Green
Write-Host "Frontend: https://app-erp-622bc.web.app"
Write-Host "Firestore config document: app_config/public"
