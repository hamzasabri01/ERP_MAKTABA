# Installs a per-user Windows startup shortcut for Library Sabri.
# No administrator privileges are required.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartScript = Join-Path $ScriptDir "start.ps1"

if (-not (Test-Path $StartScript)) {
    throw "start.ps1 introuvable dans $ScriptDir"
}

$StartupDir = [Environment]::GetFolderPath("Startup")
if ([string]::IsNullOrWhiteSpace($StartupDir)) {
    throw "Le dossier de demarrage Windows est introuvable."
}

$PowerShellExe = (Get-Process -Id $PID).Path
$ShortcutPath = Join-Path $StartupDir "Library Sabri.lnk"
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PowerShellExe
$Shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`""
$Shortcut.WorkingDirectory = $ScriptDir
$Shortcut.WindowStyle = 7
$Shortcut.Description = "Demarrage automatique de Library Sabri"
$Shortcut.Save()

Write-Host "[OK] Demarrage automatique active." -ForegroundColor Green
Write-Host "     Au prochain login Windows, l'application demarrera en arriere-plan" -ForegroundColor Gray
Write-Host "     et le navigateur ouvrira http://localhost:5173" -ForegroundColor Cyan
Write-Host "     Raccourci: $ShortcutPath" -ForegroundColor Gray
