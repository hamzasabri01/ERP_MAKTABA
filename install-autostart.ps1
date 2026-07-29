# Installs a per-user Windows startup shortcut for Library Sabri.
# No administrator privileges are required.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartScript = Join-Path $ScriptDir "startup-launch.ps1"

if (-not (Test-Path $StartScript)) {
    throw "start.ps1 introuvable dans $ScriptDir"
}

$StartupDir = [Environment]::GetFolderPath("Startup")
if ([string]::IsNullOrWhiteSpace($StartupDir)) {
    throw "Le dossier de demarrage Windows est introuvable."
}

$PowerShellExe = (Get-Process -Id $PID).Path
$StartupShortcut = Join-Path $StartupDir "Library Sabri.lnk"
$LegacyVbs = Join-Path $StartupDir "Library Sabri.vbs"
Remove-Item -LiteralPath $LegacyVbs,$StartupShortcut -Force -ErrorAction SilentlyContinue

# WScript cannot save a shortcut directly into some Arabic user paths.
# Create it in the ASCII project runtime path, then copy it with .NET/PowerShell.
$RuntimeDir = Join-Path $ScriptDir ".runtime"
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
$TemporaryShortcut = Join-Path $RuntimeDir "Library Sabri.lnk"
Remove-Item -LiteralPath $TemporaryShortcut -Force -ErrorAction SilentlyContinue
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($TemporaryShortcut)
$Shortcut.TargetPath = $PowerShellExe
$Shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`""
$Shortcut.WorkingDirectory = $ScriptDir
$Shortcut.WindowStyle = 7
$Shortcut.Description = "Demarrage automatique de Library Sabri"
$Shortcut.Save()
Copy-Item -LiteralPath $TemporaryShortcut -Destination $StartupShortcut -Force

Write-Host "[OK] Demarrage automatique active." -ForegroundColor Green
Write-Host "     Au prochain login Windows, l'application demarrera en arriere-plan" -ForegroundColor Gray
Write-Host "     et le navigateur ouvrira http://localhost:5173" -ForegroundColor Cyan
Write-Host "     Raccourci: $StartupShortcut" -ForegroundColor Gray
Write-Host "     Diagnostic: $(Join-Path $RuntimeDir 'autostart.log')" -ForegroundColor Gray
