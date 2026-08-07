@echo off
setlocal
cd /d "%~dp0"
echo Mise a jour de Library Sabri sans suppression des produits...
where powershell.exe >nul 2>nul
if not errorlevel 1 (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-existing.ps1"
) else (
  pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-existing.ps1"
)
if errorlevel 1 (
  echo.
  echo La mise a jour a echoue. Les donnees precedentes ont ete restaurees.
  pause
  exit /b 1
)
echo.
echo Mise a jour terminee avec succes.
pause
