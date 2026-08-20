[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8015,
  [string]$Path = "/",
  [switch]$NoBuild,
  [switch]$OpenFirewall,
  [switch]$ForceRestart
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$RuntimeDir = Join-Path $Root ".runtime"
$PidFile = Join-Path $RuntimeDir "lan-server.pid"
$OutLog = Join-Path $RuntimeDir "lan-server.out.log"
$ErrLog = Join-Path $RuntimeDir "lan-server.err.log"
$RuntimeConfig = Join-Path $Frontend "public\runtime-config.json"
$DistRuntimeConfig = Join-Path $Frontend "dist\runtime-config.json"

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

function Write-Info([string]$Message) { Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Good([string]$Message) { Write-Host "[OK]   $Message" -ForegroundColor Green }
function Write-WarnMessage([string]$Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }

function Get-PythonPath {
  foreach ($Candidate in @(
    (Join-Path $Backend "venv\Scripts\python.exe"),
    (Join-Path $Root ".venv\Scripts\python.exe")
  )) {
    if (Test-Path -LiteralPath $Candidate -PathType Leaf) { return $Candidate }
  }
  return $null
}

function Get-ServerHealth {
  try {
    $Response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 4
    if ($Response.status -eq "ok" -and @($Response.capabilities) -contains "document_archive") {
      return $Response
    }
  } catch {}
  return $null
}

function Test-AppPage {
  try {
    $Response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/erp" -UseBasicParsing -TimeoutSec 6
    return $Response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Stop-StaleScannerTunnel {
  $Processes = @()
  try {
    $Processes = @(
      Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue
    )
  } catch {}

  foreach ($ProcessInfo in $Processes) {
    $CommandLine = [string]$ProcessInfo.CommandLine
    if ($CommandLine -match "trycloudflare|127\.0\.0\.1|localhost|8010|8015") {
      try {
        Stop-Process -Id $ProcessInfo.ProcessId -Force -ErrorAction Stop
        Write-WarnMessage "Stopped stale scanner HTTPS tunnel process $($ProcessInfo.ProcessId)."
      } catch {}
    }
  }
}

function Invoke-ScannerTunnelWarmup {
  $EnsureCloudflared = Join-Path $PSScriptRoot "ensure-cloudflared.ps1"
  if (Test-Path -LiteralPath $EnsureCloudflared -PathType Leaf) {
    try {
      & $EnsureCloudflared 2>&1 | ForEach-Object { Write-Info ([string]$_) }
    } catch {
      Write-WarnMessage "cloudflared automatic installation failed: $($_.Exception.Message)"
    }
  }

  $Endpoints = @(
    "/api/mobile-scanner/status",
    "/api/mobile-scanner/tunnel/status",
    "/api/mobile-scanner/tunnel"
  )

  for ($Attempt = 1; $Attempt -le 12; $Attempt++) {
    foreach ($Endpoint in $Endpoints) {
      try {
        $Response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port$Endpoint" -UseBasicParsing -TimeoutSec 5
        if ($Response.StatusCode -ge 200 -and $Response.StatusCode -lt 500) {
          Write-Info "Scanner HTTPS tunnel check completed via $Endpoint."
          return
        }
      } catch {}
    }
    Start-Sleep -Seconds 2
  }
  Write-WarnMessage "Scanner HTTPS tunnel did not report ready yet; backend watchdog will keep monitoring."
}

function Get-ListeningProcessIds {
  $Result = @()
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $Result = @(
      Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    )
  } else {
    foreach ($Line in @(& "$env:SystemRoot\System32\netstat.exe" -ano -p tcp | Select-String ":$Port\s")) {
      $Parts = @($Line.ToString() -split "\s+" | Where-Object { $_ })
      if ($Parts.Count -ge 5 -and $Parts[3] -eq "LISTENING") {
        $Result += [int]$Parts[4]
      }
    }
  }
  return @($Result | Where-Object { $_ -and $_ -ne 0 } | Sort-Object -Unique)
}

function Test-OwnedServerProcess([int]$ProcessId) {
  try {
    $ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    $Executable = [string]$ProcessInfo.ExecutablePath
    $CommandLine = [string]$ProcessInfo.CommandLine
    $RootPrefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $ExecutableOwned = $Executable -and [IO.Path]::GetFullPath($Executable).StartsWith(
      $RootPrefix,
      [StringComparison]::OrdinalIgnoreCase
    )
    return $ExecutableOwned -and $CommandLine -match "(?i)\buvicorn\b" -and $CommandLine -match "main:app"
  } catch {
    return $false
  }
}

function Stop-OwnedServer {
  $Candidates = @()
  if (Test-Path -LiteralPath $PidFile) {
    try {
      $SavedId = [int]([IO.File]::ReadAllText($PidFile).Trim())
      if ($SavedId) { $Candidates += $SavedId }
    } catch {}
  }
  $Candidates += Get-ListeningProcessIds

  foreach ($ProcessId in @($Candidates | Sort-Object -Unique)) {
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { continue }
    if (-not (Test-OwnedServerProcess $ProcessId)) {
      throw "TCP port $Port is used by another program (PID $ProcessId). It was not stopped."
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
  }

  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
    if (@(Get-ListeningProcessIds).Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "The Library Sabri server did not release TCP port $Port."
}

function Set-SameOriginRuntimeConfig {
  $Config = [ordered]@{
    api_base_url = "/api"
    maintenance_mode = $false
    app_version = "1.0.0"
  } | ConvertTo-Json

  foreach ($ConfigPath in @($RuntimeConfig, $DistRuntimeConfig)) {
    $Parent = Split-Path -Parent $ConfigPath
    if (Test-Path -LiteralPath $Parent -PathType Container) {
      [IO.File]::WriteAllText($ConfigPath, $Config, [Text.UTF8Encoding]::new($false))
    }
  }
}

function Ensure-FirewallRule {
  $RuleName = "Library Sabri LAN TCP $Port"
  if (-not (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue)) {
    throw "Windows Firewall cmdlets are unavailable."
  }
  $Existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
  if (-not $Existing) {
    New-NetFirewallRule `
      -DisplayName $RuleName `
      -Direction Inbound `
      -Action Allow `
      -Protocol TCP `
      -LocalPort $Port `
      -Profile Private `
      -RemoteAddress LocalSubnet | Out-Null
  } else {
    $Existing | Set-NetFirewallRule -Enabled True -Profile Private -Action Allow | Out-Null
  }
}

$Python = Get-PythonPath
if (-not $Python) {
  throw "Python virtual environment is missing. Run the server installer/update first."
}
if (-not (Test-Path -LiteralPath (Join-Path $Backend "main.py") -PathType Leaf)) {
  throw "Backend files are missing from $Backend."
}

if (-not $NoBuild) {
  Write-Info "Building the LAN frontend..."
  Push-Location $Frontend
  try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed."
    }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $Frontend "dist\index.html") -PathType Leaf)) {
  throw "frontend\dist\index.html is missing. Build the frontend before starting the LAN server."
}

Set-SameOriginRuntimeConfig
if ($OpenFirewall) {
  Write-Info "Ensuring the private-LAN firewall rule for TCP $Port..."
  Ensure-FirewallRule
}

$ExistingHealth = Get-ServerHealth
if ($ExistingHealth -and -not $ForceRestart) {
  Write-Good "Server already healthy on port $Port (version $($ExistingHealth.version))."
} else {
  if ($ExistingHealth) { Write-Info "Restarting the existing Library Sabri server..." }
  Stop-OwnedServer
  Stop-StaleScannerTunnel

  Remove-Item -LiteralPath $OutLog, $ErrLog -Force -ErrorAction SilentlyContinue
  Write-Info "Starting Library Sabri on 0.0.0.0:$Port..."
  $env:LIBRARY_SABRI_PORT = [string]$Port
  $env:SCANNER_TUNNEL_TARGET = "http://127.0.0.1:$Port"
  $ServerProcess = Start-Process `
    -FilePath $Python `
    -ArgumentList "-m uvicorn main:app --host 0.0.0.0 --port $Port --no-proxy-headers" `
    -WorkingDirectory $Backend `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -WindowStyle Hidden `
    -PassThru
  [IO.File]::WriteAllText($PidFile, [string]$ServerProcess.Id, [Text.Encoding]::ASCII)

  $Health = $null
  for ($Attempt = 1; $Attempt -le 60; $Attempt++) {
    Start-Sleep -Seconds 1
    if ($ServerProcess.HasExited) { break }
    $Health = Get-ServerHealth
    if ($Health) { break }
  }
  if (-not $Health) {
    $Details = ""
    if (Test-Path -LiteralPath $ErrLog) {
      $Details = (@(Get-Content -LiteralPath $ErrLog -Tail 30 -ErrorAction SilentlyContinue) -join [Environment]::NewLine)
    }
    throw "Server failed to become healthy on TCP $Port.`r`n$Details"
  }
  Write-Good "Server ready (PID $($ServerProcess.Id), version $($Health.version))."
}

for ($Attempt = 1; $Attempt -le 30; $Attempt++) {
  if (Test-AppPage) { break }
  Start-Sleep -Seconds 1
}
if (-not (Test-AppPage)) {
  throw "Application page is not reachable on http://127.0.0.1:$Port/erp."
}

Invoke-ScannerTunnelWarmup

$LanAddress = $null
try {
  $LanAddress = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.AddressState -eq "Preferred"
    } |
    Sort-Object InterfaceMetric |
    Select-Object -First 1 -ExpandProperty IPAddress
} catch {}

$OpenPath = if ([string]::IsNullOrWhiteSpace($Path)) { "/" } elseif ($Path.StartsWith("/")) { $Path } else { "/$Path" }
Write-Host "Local:   http://127.0.0.1:$Port$OpenPath" -ForegroundColor Cyan
if ($LanAddress) { Write-Host "Network: http://$LanAddress`:$Port$OpenPath" -ForegroundColor Yellow }
