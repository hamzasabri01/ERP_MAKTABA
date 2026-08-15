[CmdletBinding()]
param(
    [string]$TaskName = 'LibrarySabri-Client',
    [string]$ConfigPath,
    [switch]$RemoveConfiguration,
    [switch]$RemoveLogs
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$productDirectory = Join-Path $env:LOCALAPPDATA 'LibrairiePrintWeb\ClientConnector'
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $productDirectory 'config.json'
}
$logDirectory = Join-Path $productDirectory 'logs'
$installedConnectorScript = Join-Path $productDirectory 'connect-server-and-open.ps1'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Scheduled task removed: $TaskName" -ForegroundColor Green
}
else {
    Write-Host "Scheduled task was not found: $TaskName" -ForegroundColor Yellow
}

if (Test-Path -LiteralPath $installedConnectorScript -PathType Leaf) {
    Remove-Item -LiteralPath $installedConnectorScript -Force
    Write-Host "Installed connector removed: $installedConnectorScript" -ForegroundColor Green
}

if ($RemoveConfiguration) {
    if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
        Remove-Item -LiteralPath $ConfigPath -Force
        Write-Host "Connector configuration removed: $ConfigPath" -ForegroundColor Yellow
    }
}
else {
    Write-Host "Configuration kept: $ConfigPath" -ForegroundColor Cyan
}

if ($RemoveLogs) {
    $expectedRoot = [System.IO.Path]::GetFullPath($productDirectory).TrimEnd('\') + '\'
    $resolvedLogDirectory = [System.IO.Path]::GetFullPath($logDirectory).TrimEnd('\') + '\'
    if (-not $resolvedLogDirectory.StartsWith($expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to remove logs outside the connector LocalAppData directory.'
    }

    if (Test-Path -LiteralPath $logDirectory -PathType Container) {
        Get-ChildItem -LiteralPath $logDirectory -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq 'connector.log' -or $_.Name -like 'connector.log.*' } |
            Remove-Item -Force
        Write-Host "Connector logs removed: $logDirectory" -ForegroundColor Yellow
    }
}
else {
    Write-Host "Logs kept: $logDirectory" -ForegroundColor Cyan
}

Write-Host 'Application files and databases were not changed.' -ForegroundColor Green
