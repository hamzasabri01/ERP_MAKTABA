@echo off
setlocal
cd /d "%~dp0"
echo Mise a jour depuis GitHub sans toucher a la base locale...
set "WINDOWS_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%WINDOWS_POWERSHELL%" (
  "%WINDOWS_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-existing.ps1"
) else (
  pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-existing.ps1"
)
if errorlevel 1 (
  echo.
  echo La mise a jour a echoue. Les donnees locales precedentes ont ete restaurees.
  pause
  exit /b 1
)
echo.
echo Mise a jour GitHub terminee avec succes.
echo Le serveur local demarre automatiquement avec Windows et ouvre Chrome.
pause
