[CmdletBinding()]
param(
  [string]$InstallDir = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $InstallDir = Join-Path $Root "tools"
}
$CloudflaredPath = Join-Path $InstallDir "cloudflared.exe"
$DownloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

function Write-Info([string]$Message) { Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Good([string]$Message) { Write-Host "[OK]   $Message" -ForegroundColor Green }
function Write-WarnMessage([string]$Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }

function Test-Cloudflared([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  try {
    $Output = & $Path --version 2>&1
    return ($LASTEXITCODE -eq 0 -and (($Output -join " ") -match "cloudflared"))
  } catch {
    return $false
  }
}

if (-not $Force) {
  $Existing = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($Existing -and (Test-Cloudflared $Existing.Source)) {
    Write-Good "cloudflared is already available: $($Existing.Source)"
    exit 0
  }
  if (Test-Cloudflared $CloudflaredPath) {
    Write-Good "cloudflared is already installed locally: $CloudflaredPath"
    exit 0
  }
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$Temporary = Join-Path $InstallDir ("cloudflared-download-{0}.exe" -f ([Guid]::NewGuid().ToString("N")))

try {
  Write-Info "Downloading cloudflared for the mobile scanner HTTPS tunnel..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $DownloadUrl -OutFile $Temporary -UseBasicParsing -TimeoutSec 120
  if (-not (Test-Cloudflared $Temporary)) {
    throw "Downloaded cloudflared file could not be executed."
  }
  Move-Item -LiteralPath $Temporary -Destination $CloudflaredPath -Force
  Write-Good "cloudflared installed locally: $CloudflaredPath"
} finally {
  Remove-Item -LiteralPath $Temporary -Force -ErrorAction SilentlyContinue
}
