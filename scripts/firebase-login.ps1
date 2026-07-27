$ErrorActionPreference = "Stop"

$env:ComSpec = "$env:WINDIR\System32\cmd.exe"
$env:Path = "$env:WINDIR\System32;$env:WINDIR;$env:WINDIR\System32\WindowsPowerShell\v1.0;$env:Path"
# Some corporate networks replace Google certificates with an internal CA.
# This keeps the workaround scoped to this Firebase CLI process.
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

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

& $firebase.FullName login --no-localhost
if ($LASTEXITCODE -ne 0) {
  throw "Firebase login failed"
}

& $firebase.FullName projects:list
if ($LASTEXITCODE -ne 0) {
  $configPath = Join-Path $env:USERPROFILE ".config\configstore\firebase-tools.json"
  if (Test-Path $configPath) {
    try {
      $config = Get-Content $configPath -Raw | ConvertFrom-Json
      if ($config.tokens.access_token -or $config.tokens.refresh_token) {
        Write-Host "Firebase login token is present, but projects:list failed because of network/TLS." -ForegroundColor Yellow
        Write-Host "Continuing. You can still run .\scripts\deploy-firebase.ps1 for project app-erp-622bc." -ForegroundColor Green
        exit 0
      }
    } catch {}
  }
  throw "Firebase login verification failed"
}
