param(
  [Parameter(Mandatory = $true)]
  [string]$Url,
  [switch]$Deploy,
  [switch]$SkipFirestore
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $Root "frontend\public\runtime-config.json"
$ProjectId = "app-erp-622bc"
$FirebaseConfigPath = Join-Path $env:USERPROFILE ".config\configstore\firebase-tools.json"
$ClientId = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"
$ClientSecret = "j9iVZfS8kkCEFUPaAeJV0sAi"

$cleanUrl = $Url.Trim().TrimEnd("/")
if ($cleanUrl -notmatch "^https://[^\s]+(/api)?$") {
  Write-Host "Invalid API URL. Expected: https://domain.example.com" -ForegroundColor Red
  exit 1
}

if ($cleanUrl -notmatch "/api$") {
  $cleanUrl = "$cleanUrl/api"
}

$config = [ordered]@{
  api_base_url = $cleanUrl
  maintenance_mode = $false
  app_version = "1.0.0"
}

$json = $config | ConvertTo-Json
Set-Content -Path $ConfigPath -Value $json -Encoding UTF8

Write-Host "Updated runtime config:" -ForegroundColor Green
Write-Host "api_base_url = $cleanUrl" -ForegroundColor Cyan

function Get-FirebaseAccessToken {
  if (-not (Test-Path $FirebaseConfigPath)) {
    throw "Firebase CLI login file not found. Run .\scripts\firebase-login.ps1 first."
  }

  $firebaseConfig = Get-Content $FirebaseConfigPath -Raw | ConvertFrom-Json
  $tokens = $firebaseConfig.tokens
  if (-not $tokens) {
    throw "Firebase CLI tokens not found. Run .\scripts\firebase-login.ps1 first."
  }

  $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  if ($tokens.access_token -and $tokens.expires_at -and ([int64]$tokens.expires_at -gt ($nowMs + 60000))) {
    return $tokens.access_token
  }

  if (-not $tokens.refresh_token) {
    throw "Firebase refresh token not found. Run .\scripts\firebase-login.ps1 again."
  }

  $env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
  $refreshBody = @{
    client_id = $ClientId
    client_secret = $ClientSecret
    refresh_token = $tokens.refresh_token
    grant_type = "refresh_token"
  }
  $refreshed = Invoke-RestMethod `
    -Method Post `
    -Uri "https://www.googleapis.com/oauth2/v3/token" `
    -Body $refreshBody `
    -TimeoutSec 30

  $tokens.access_token = $refreshed.access_token
  $tokens.expires_in = $refreshed.expires_in
  $tokens.expires_at = [DateTimeOffset]::UtcNow.AddSeconds([int]$refreshed.expires_in).ToUnixTimeMilliseconds()
  $firebaseConfig | ConvertTo-Json -Depth 20 | Set-Content -Path $FirebaseConfigPath -Encoding UTF8

  return $refreshed.access_token
}

if (-not $SkipFirestore) {
  try {
    $accessToken = Get-FirebaseAccessToken
    $firestoreBody = @{
      fields = @{
        api_base_url = @{ stringValue = $cleanUrl }
        maintenance_mode = @{ booleanValue = $false }
        app_version = @{ stringValue = "1.0.0" }
      }
    } | ConvertTo-Json -Depth 10

    $firestoreUrl = "https://firestore.googleapis.com/v1/projects/$ProjectId/databases/(default)/documents/app_config/public"
    Invoke-RestMethod `
      -Method Patch `
      -Uri $firestoreUrl `
      -Headers @{ Authorization = "Bearer $accessToken" } `
      -ContentType "application/json" `
      -Body $firestoreBody `
      -TimeoutSec 30 | Out-Null

    Write-Host "Updated Firestore app_config/public. Future URL changes do not require deploy." -ForegroundColor Green
  } catch {
    Write-Host "Could not update Firestore: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "The local runtime-config.json was updated. Use -Deploy to publish it." -ForegroundColor Yellow
  }
}

if ($Deploy) {
  & (Join-Path $Root "scripts\deploy-firebase.ps1")
}
