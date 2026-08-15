[CmdletBinding()]
param(
  [string]$TaskName = "LibrarySabri-Server",
  [string]$BrowserTaskName = "LibrarySabri-OpenChrome",
  [ValidateRange(1, 65535)]
  [int]$Port = 8015,
  [switch]$RemoveFirewallRule
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root ".runtime"

$IsAdministrator = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $IsAdministrator) {
  throw "Run this uninstaller from PowerShell as Administrator."
}

foreach ($Name in @($BrowserTaskName, $TaskName, "ProERP LAN Server")) {
  Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
}

function Stop-OwnedPidFile([string]$Path, [string]$RequiredText) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  try {
    $ProcessId = [int]([IO.File]::ReadAllText($Path).Trim())
    $ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    $CommandLine = [string]$ProcessInfo.CommandLine
    if ($ProcessInfo -and $CommandLine -like "*$RequiredText*") {
      Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
  } finally {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  }
}

Stop-OwnedPidFile (Join-Path $RuntimeDir "lan-watchdog.pid") "server-watchdog.ps1"
Stop-OwnedPidFile (Join-Path $RuntimeDir "lan-server.pid") "uvicorn"

if ($RemoveFirewallRule) {
  Get-NetFirewallRule -DisplayName "Library Sabri LAN TCP $Port" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

Write-Host "[OK] Library Sabri automatic server startup was removed." -ForegroundColor Green
Write-Host "     Application data and backups were not deleted." -ForegroundColor Gray
