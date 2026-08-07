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
    Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $arguments
    exit
}

Set-Location -LiteralPath $ProjectDir

foreach ($port in @(8000, 8001, 5173)) {
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

& (Join-Path $ProjectDir "start.ps1") -ForceRestart
