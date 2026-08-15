[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8015,
  [ValidateRange(5, 300)]
  [int]$CheckIntervalSeconds = 20
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$StartScript = Join-Path $PSScriptRoot "start-lan-erp.ps1"
$RuntimeDir = Join-Path $Root ".runtime"
$WatchdogPidFile = Join-Path $RuntimeDir "lan-watchdog.pid"
$LogDir = Join-Path $env:ProgramData "LibrarySabri\logs"
$LogFile = Join-Path $LogDir "server-watchdog.log"

New-Item -ItemType Directory -Force -Path $RuntimeDir, $LogDir | Out-Null

function Rotate-Log {
  if (-not (Test-Path -LiteralPath $LogFile -PathType Leaf)) { return }
  if ((Get-Item -LiteralPath $LogFile).Length -lt 5MB) { return }
  $Archive = Join-Path $LogDir ("server-watchdog-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  Move-Item -LiteralPath $LogFile -Destination $Archive -Force
  Get-ChildItem -LiteralPath $LogDir -Filter "server-watchdog-*.log" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 10 |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

function Write-Log([string]$Level, [string]$Message) {
  Rotate-Log
  Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value (
    "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
  )
}

function Test-Health {
  try {
    $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 4
    return $Health.status -eq "ok" -and @($Health.capabilities) -contains "document_archive"
  } catch {
    return $false
  }
}

if (-not (Test-Path -LiteralPath $StartScript -PathType Leaf)) {
  throw "Server launcher is missing: $StartScript"
}

$CreatedNew = $false
$Mutex = $null
try {
  try {
    $Mutex = [Threading.Mutex]::new($true, "Global\LibrarySabriServerWatchdog-$Port", [ref]$CreatedNew)
  } catch {
    $Mutex = [Threading.Mutex]::new($true, "Local\LibrarySabriServerWatchdog-$Port", [ref]$CreatedNew)
  }
  if (-not $CreatedNew) { exit 0 }

  [IO.File]::WriteAllText($WatchdogPidFile, [string]$PID, [Text.Encoding]::ASCII)
  Write-Log "INFO" "Watchdog started (PID=$PID, port=$Port)."

  $ConsecutiveFailures = 0
  $ServerWasHealthy = $false
  while ($true) {
    if (Test-Health) {
      if (-not $ServerWasHealthy) { Write-Log "OK" "End-to-end server health check succeeded." }
      $ServerWasHealthy = $true
      $ConsecutiveFailures = 0
      Start-Sleep -Seconds $CheckIntervalSeconds
      continue
    }

    $ConsecutiveFailures++
    $ShouldRepair = (-not $ServerWasHealthy) -or $ConsecutiveFailures -ge 3
    if (-not $ShouldRepair) {
      Start-Sleep -Seconds 3
      continue
    }

    Write-Log "WARN" "Server unavailable; automatic repair started (failure=$ConsecutiveFailures)."
    try {
      & $StartScript -Port $Port -NoBuild -ForceRestart 2>&1 |
        ForEach-Object { Write-Log "START" ([string]$_) }
      if (-not (Test-Health)) { throw "Health check is still failing after restart." }
      Write-Log "OK" "Automatic server repair completed."
      $ServerWasHealthy = $true
      $ConsecutiveFailures = 0
    } catch {
      Write-Log "ERROR" $_.Exception.Message
      $ServerWasHealthy = $false
      Start-Sleep -Seconds ([Math]::Min(60, [Math]::Max(5, $ConsecutiveFailures * 5)))
    }
  }
} catch {
  Write-Log "FATAL" $_.Exception.Message
  exit 1
} finally {
  Remove-Item -LiteralPath $WatchdogPidFile -Force -ErrorAction SilentlyContinue
  if ($Mutex -and $CreatedNew) {
    try { $Mutex.ReleaseMutex() } catch {}
    $Mutex.Dispose()
  }
}
