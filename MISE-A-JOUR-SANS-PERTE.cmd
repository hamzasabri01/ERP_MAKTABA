@echo off
setlocal
cd /d "%~dp0"
echo Mise a jour de Library Sabri sans suppression des produits...
set "WINDOWS_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%WINDOWS_POWERSHELL%" (
  "%WINDOWS_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-existing.ps1"
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
