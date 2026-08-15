[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8015,
  [string]$TaskName = "LibrarySabri-Server",
  [string]$BrowserTaskName = "LibrarySabri-OpenChrome",
  [string]$BrowserUser = "",
  [switch]$OpenFirewall,
  [switch]$NoBrowserTask,
  [switch]$NoImmediateOpen,
  [switch]$Elevated
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$WatchdogScript = Join-Path $PSScriptRoot "server-watchdog.ps1"
$BrowserScript = Join-Path $PSScriptRoot "connect-server-and-open.ps1"
$RuntimeDir = Join-Path $Root ".runtime"
$PowerShellExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

$IsAdministrator = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $IsAdministrator) {
  if ($Elevated) { throw "Administrator rights are required to install the server startup task." }
  $QuotedScript = '"' + $PSCommandPath.Replace('"', '""') + '"'
  $Arguments = "-NoProfile -ExecutionPolicy Bypass -File $QuotedScript -Port $Port -TaskName `"$TaskName`" -BrowserTaskName `"$BrowserTaskName`" -Elevated"
  if ($BrowserUser) { $Arguments += " -BrowserUser `"$BrowserUser`"" }
  if ($OpenFirewall) { $Arguments += " -OpenFirewall" }
  if ($NoBrowserTask) { $Arguments += " -NoBrowserTask" }
  if ($NoImmediateOpen) { $Arguments += " -NoImmediateOpen" }
  $ElevatedProcess = Start-Process -FilePath $PowerShellExe -Verb RunAs -ArgumentList $Arguments -Wait -PassThru
  if ($ElevatedProcess.ExitCode -ne 0) { throw "Server startup installation was cancelled or failed." }
  exit 0
}

foreach ($RequiredFile in @($WatchdogScript, (Join-Path $PSScriptRoot "start-lan-erp.ps1"))) {
  if (-not (Test-Path -LiteralPath $RequiredFile -PathType Leaf)) {
    throw "Required server file is missing: $RequiredFile"
  }
}
if (-not $NoBrowserTask -and -not (Test-Path -LiteralPath $BrowserScript -PathType Leaf)) {
  throw "Browser connection script is missing: $BrowserScript"
}
if (-not (Test-Path -LiteralPath (Join-Path $Root "frontend\dist\index.html") -PathType Leaf)) {
  throw "The built frontend is missing. Run npm run build before installing server startup."
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
if ([string]::IsNullOrWhiteSpace($BrowserUser)) {
  $BrowserUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
}

# Remove launchers from older revisions. They used duplicate startup/logon
# triggers and did not monitor the detached Uvicorn process.
foreach ($LegacyTask in @("ProERP LAN Server", "LibrarySabri")) {
  if ($LegacyTask -notin @($TaskName, $BrowserTaskName)) {
    Stop-ScheduledTask -TaskName $LegacyTask -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $LegacyTask -Confirm:$false -ErrorAction SilentlyContinue
  }
}

if ($OpenFirewall) {
  $RuleName = "Library Sabri LAN TCP $Port"
  Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule `
    -DisplayName $RuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile Private `
    -RemoteAddress LocalSubnet | Out-Null
}

$ServerAction = New-ScheduledTaskAction `
  -Execute $PowerShellExe `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$WatchdogScript`" -Port $Port" `
  -WorkingDirectory $Root
$ServerTrigger = New-ScheduledTaskTrigger -AtStartup
$ServerSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$ServerPrincipal = New-ScheduledTaskPrincipal `
  -UserId "SYSTEM" `
  -LogonType ServiceAccount `
  -RunLevel Highest

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $ServerAction `
  -Trigger $ServerTrigger `
  -Settings $ServerSettings `
  -Principal $ServerPrincipal `
  -Description "Library Sabri LAN server watchdog on TCP $Port" `
  -Force | Out-Null

if (-not $NoBrowserTask) {
  $BrowserUrl = "http://127.0.0.1:$Port/"
  $BrowserAction = New-ScheduledTaskAction `
    -Execute $PowerShellExe `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$BrowserScript`" -ServerUrl `"$BrowserUrl`" -InitialDelaySeconds 10 -StartupTimeoutSeconds 600 -Silent" `
    -WorkingDirectory $Root
  $BrowserTrigger = New-ScheduledTaskTrigger -AtLogOn -User $BrowserUser
  $BrowserSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 20 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -MultipleInstances IgnoreNew
  $BrowserPrincipal = New-ScheduledTaskPrincipal `
    -UserId $BrowserUser `
    -LogonType Interactive `
    -RunLevel Limited

  Stop-ScheduledTask -TaskName $BrowserTaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $BrowserTaskName -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask `
    -TaskName $BrowserTaskName `
    -Action $BrowserAction `
    -Trigger $BrowserTrigger `
    -Settings $BrowserSettings `
    -Principal $BrowserPrincipal `
    -Description "Open Library Sabri in Google Chrome after the LAN server is ready" `
    -Force | Out-Null
}

Start-ScheduledTask -TaskName $TaskName
$Health = $null
for ($Attempt = 1; $Attempt -le 90; $Attempt++) {
  Start-Sleep -Seconds 1
  try {
    $Candidate = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
    if ($Candidate.status -eq "ok") { $Health = $Candidate; break }
  } catch {}
}
if (-not $Health) {
  $WatchdogLog = Join-Path $env:ProgramData "LibrarySabri\logs\server-watchdog.log"
  throw "The startup task was installed, but the server did not become healthy. Check $WatchdogLog"
}

if (-not $NoBrowserTask -and -not $NoImmediateOpen) {
  Start-ScheduledTask -TaskName $BrowserTaskName -ErrorAction SilentlyContinue
}

Write-Host "[OK] Library Sabri server startup is installed." -ForegroundColor Green
Write-Host "     Server task: $TaskName (Windows startup, SYSTEM watchdog)" -ForegroundColor Gray
if (-not $NoBrowserTask) {
  Write-Host "     Chrome task: $BrowserTaskName (logon user: $BrowserUser)" -ForegroundColor Gray
}
Write-Host "     URL: http://127.0.0.1:$Port/" -ForegroundColor Cyan
Write-Host "     Version: $($Health.version)" -ForegroundColor Gray
