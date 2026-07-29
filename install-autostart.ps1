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
$LegacyShortcut = Join-Path $StartupDir "Library Sabri.lnk"
$StartupLauncher = Join-Path $StartupDir "Library Sabri.vbs"
Remove-Item -LiteralPath $LegacyShortcut -Force -ErrorAction SilentlyContinue

# A Unicode VBS launcher is used instead of WScript.Shell.CreateShortcut.
# CreateShortcut can corrupt Arabic Windows user paths into "????".
$VbsContent = @'
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """{0}"" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{1}""", 0, False
'@ -f $PowerShellExe, $StartScript
[IO.File]::WriteAllText($StartupLauncher, $VbsContent, [Text.Encoding]::Unicode)

Write-Host "[OK] Demarrage automatique active." -ForegroundColor Green
Write-Host "     Au prochain login Windows, l'application demarrera en arriere-plan" -ForegroundColor Gray
Write-Host "     et le navigateur ouvrira http://localhost:5173" -ForegroundColor Cyan
Write-Host "     Lanceur: $StartupLauncher" -ForegroundColor Gray
