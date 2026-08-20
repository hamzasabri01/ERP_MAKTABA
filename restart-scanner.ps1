param([switch]$Elevated)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $Elevated) {
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$PSCommandPath`"",
        "-Elevated"
    )
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    Start-Process -FilePath $windowsPowerShell -Verb RunAs -ArgumentList $arguments
    exit
}

Set-Location -LiteralPath $ProjectDir

foreach ($port in @(8000, 8001, 5173, 8010)) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

$tunnelPidFile = Join-Path $ProjectDir ".runtime\scanner-tunnel.pid"
if (Test-Path -LiteralPath $tunnelPidFile) {
    $tunnelPid = Get-Content -LiteralPath $tunnelPidFile -ErrorAction SilentlyContinue
    if ($tunnelPid -match '^\d+$') {
        Stop-Process -Id ([int]$tunnelPid) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $tunnelPidFile -Force -ErrorAction SilentlyContinue
}

Get-Process cloudflared -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

& (Join-Path $ProjectDir "scripts\ensure-cloudflared.ps1")
& (Join-Path $ProjectDir "scripts\install-lan-erp-startup.ps1") -Port 8015 -OpenFirewall -NoImmediateOpen
& (Join-Path $ProjectDir "scripts\start-lan-erp.ps1") -Port 8015 -NoBuild -OpenFirewall -ForceRestart
Start-ScheduledTask -TaskName "LibrarySabri-Server" -ErrorAction SilentlyContinue
