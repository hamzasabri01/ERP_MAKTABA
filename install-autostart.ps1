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

# HKCU Run is Unicode-safe, per-user, and does not require administrator rights.
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$RunCommand = "`"$PowerShellExe`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`""
New-Item -Path $RunKey -Force | Out-Null
New-ItemProperty -Path $RunKey -Name "LibrarySabri" -Value $RunCommand -PropertyType String -Force | Out-Null
$StoredCommand = (Get-ItemProperty -Path $RunKey -Name "LibrarySabri").LibrarySabri
if ($StoredCommand -ne $RunCommand) {
    throw "Windows n'a pas conserve la commande de demarrage automatique."
}

Write-Host "[OK] Demarrage automatique active." -ForegroundColor Green
Write-Host "     Au prochain login Windows, l'application demarrera en arriere-plan" -ForegroundColor Gray
Write-Host "     et le navigateur ouvrira http://localhost:5173" -ForegroundColor Cyan
Write-Host "     Methode: Windows Registry HKCU Run" -ForegroundColor Gray
Write-Host "     Diagnostic: $(Join-Path $RuntimeDir 'autostart.log')" -ForegroundColor Gray
