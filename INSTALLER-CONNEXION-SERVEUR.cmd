@echo off
setlocal
cd /d "%~dp0"

set "WINDOWS_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "INSTALL_SCRIPT=%~dp0scripts\install-client-startup.ps1"

if not exist "%WINDOWS_POWERSHELL%" (
    echo Windows PowerShell 5.1 is required but was not found.
    if "%~1"=="" pause
    exit /b 1
)

if not exist "%INSTALL_SCRIPT%" (
    echo Installer script was not found: "%INSTALL_SCRIPT%"
    if "%~1"=="" pause
    exit /b 1
)

"%WINDOWS_POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%INSTALL_SCRIPT%" %*
set "INSTALL_EXIT_CODE=%ERRORLEVEL%"

if not "%INSTALL_EXIT_CODE%"=="0" (
    echo.
    echo Installation failed with exit code %INSTALL_EXIT_CODE%.
) else (
    echo.
    echo Installation completed successfully.
)

if "%~1"=="" pause
exit /b %INSTALL_EXIT_CODE%
