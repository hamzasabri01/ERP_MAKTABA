# Stops Library Sabri services and the background watchdog intentionally.
$ErrorActionPreference = "SilentlyContinue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeDir = Join-Path $ScriptDir ".runtime"
$PidFile = Join-Path $RuntimeDir "autostart.pid"
$LanWatchdogPidFile = Join-Path $RuntimeDir "lan-watchdog.pid"
$LanServerPidFile = Join-Path $RuntimeDir "lan-server.pid"

Stop-ScheduledTask -TaskName "LibrarySabri" -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName "LibrarySabri-Server" -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName "LibrarySabri-OpenChrome" -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName "ProERP LAN Server" -ErrorAction SilentlyContinue

if (Test-Path $PidFile) {
    $WatchdogPid = [int]([IO.File]::ReadAllText($PidFile).Trim())
    if ($WatchdogPid -and $WatchdogPid -ne $PID) {
        Stop-Process -Id $WatchdogPid -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

foreach ($pidPath in @($LanWatchdogPidFile, $LanServerPidFile)) {
    if (-not (Test-Path $pidPath)) { continue }
    $SavedPid = [int]([IO.File]::ReadAllText($pidPath).Trim())
    if ($SavedPid -and $SavedPid -ne $PID) {
        Stop-Process -Id $SavedPid -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

foreach ($port in @(8000, 8001, 8010, 8015, 5173)) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        Where-Object { $_ -and $_ -ne 0 -and $_ -ne $PID } |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

Write-Host "[OK] Library Sabri services stopped." -ForegroundColor Green
