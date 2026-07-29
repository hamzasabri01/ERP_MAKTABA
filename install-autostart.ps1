# Installs a per-user Windows startup shortcut for Library Sabri.
# No administrator privileges are required.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartScript = Join-Path $ScriptDir "startup-launch.ps1"

if (-not (Test-Path $StartScript)) {
    throw "start.ps1 introuvable dans $ScriptDir"
}

$PowerShellExe = (Get-Process -Id $PID).Path
$RuntimeDir = Join-Path $ScriptDir ".runtime"
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

# Remove older Startup-folder launchers to avoid duplicate launches.
$StartupDir = [Environment]::GetFolderPath("Startup")
if (-not [string]::IsNullOrWhiteSpace($StartupDir)) {
    Remove-Item -LiteralPath (Join-Path $StartupDir "Library Sabri.vbs") -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $StartupDir "Library Sabri.lnk") -Force -ErrorAction SilentlyContinue
}

# Remove the older Registry launcher to prevent duplicate starts.
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
Remove-ItemProperty -Path $RunKey -Name "LibrarySabri" -Force -ErrorAction SilentlyContinue

# A scheduled task is more reliable than Startup/Registry launchers and keeps
# the hidden watchdog alive without a time limit.
$TaskName = "LibrarySabri"
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Action = New-ScheduledTaskAction `
    -Execute $PowerShellExe `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`"" `
    -WorkingDirectory $ScriptDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
$IsAdministrator = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
$RunLevel = if ($IsAdministrator) { "Highest" } else { "Limited" }
$Principal = New-ScheduledTaskPrincipal `
    -UserId $CurrentUser `
    -LogonType Interactive `
    -RunLevel $RunLevel

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Library Sabri backend, frontend et watchdog" `
    -Force | Out-Null

$InstalledTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if (-not $InstalledTask) {
    throw "La tache planifiee n'a pas ete creee."
}
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

Write-Host "[OK] Demarrage automatique active." -ForegroundColor Green
Write-Host "     Au prochain login Windows, l'application demarrera en arriere-plan" -ForegroundColor Gray
Write-Host "     et le navigateur ouvrira http://localhost:5173" -ForegroundColor Cyan
Write-Host "     Methode: Windows Task Scheduler ($TaskName)" -ForegroundColor Gray
Write-Host "     Etat: $((Get-ScheduledTask -TaskName $TaskName).State)" -ForegroundColor Gray
Write-Host "     Diagnostic: $(Join-Path $RuntimeDir 'autostart.log')" -ForegroundColor Gray
