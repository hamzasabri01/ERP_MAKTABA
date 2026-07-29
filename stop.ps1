# Stops Library Sabri services and the background watchdog intentionally.
$ErrorActionPreference = "SilentlyContinue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeDir = Join-Path $ScriptDir ".runtime"
$PidFile = Join-Path $RuntimeDir "autostart.pid"

Stop-ScheduledTask -TaskName "LibrarySabri" -ErrorAction SilentlyContinue

if (Test-Path $PidFile) {
    $WatchdogPid = [int]([IO.File]::ReadAllText($PidFile).Trim())
    if ($WatchdogPid -and $WatchdogPid -ne $PID) {
        Stop-Process -Id $WatchdogPid -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

foreach ($port in @(8000, 5173)) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        Where-Object { $_ -and $_ -ne 0 -and $_ -ne $PID } |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

Write-Host "[OK] Library Sabri services stopped." -ForegroundColor Green
