[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$ServerUrl,

    [string[]]$FallbackUrl = @(),

    [string]$HealthPath = '/health',

    [string]$AppPath = '/erp',

    [ValidateRange(10, 86400)]
    [int]$MaxWaitSeconds = 600,

    [ValidateRange(1, 300)]
    [int]$RetryDelaySeconds = 5,

    [ValidateRange(1, 120)]
    [int]$RequestTimeoutSeconds = 8,

    [ValidateRange(1, 100)]
    [int]$DnsFlushAfterFailures = 3,

    [ValidateRange(65536, 104857600)]
    [int]$LogMaxBytes = 2097152,

    [ValidateRange(1, 20)]
    [int]$LogRetention = 5,

    [string]$TaskName = 'LibrarySabri-Client',

    [string]$ConfigPath,

    [switch]$NoStart
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$productDirectory = Join-Path $env:LOCALAPPDATA 'LibrairiePrintWeb\ClientConnector'
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $productDirectory 'config.json'
}

$sourceConnectorScript = Join-Path $PSScriptRoot 'connect-server-and-open.ps1'
if (-not (Test-Path -LiteralPath $sourceConnectorScript -PathType Leaf)) {
    throw "Connector source script not found: $sourceConnectorScript"
}

function ConvertTo-NormalizedServerUrl {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw 'Server URL cannot be empty.'
    }

    try {
        $uri = New-Object System.Uri($Value.Trim(), [System.UriKind]::Absolute)
    }
    catch {
        throw "Invalid server URL: $Value"
    }

    if ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https') {
        throw "Server URL must use http or https: $Value"
    }
    if ([string]::IsNullOrWhiteSpace($uri.Host) -or -not [string]::IsNullOrEmpty($uri.UserInfo)) {
        throw "Server URL has an invalid host or embedded credentials: $Value"
    }
    if (-not [string]::IsNullOrEmpty($uri.Query) -or -not [string]::IsNullOrEmpty($uri.Fragment)) {
        throw "Server URL must not contain a query string or fragment: $Value"
    }

    return $uri.AbsoluteUri.TrimEnd('/')
}

function ConvertTo-EndpointValue {
    param(
        [string]$Value,
        [string]$Name
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$Name cannot be empty."
    }

    $absoluteUri = $null
    if ([System.Uri]::TryCreate($Value, [System.UriKind]::Absolute, [ref]$absoluteUri)) {
        if ($absoluteUri.Scheme -ne 'http' -and $absoluteUri.Scheme -ne 'https') {
            throw "$Name must use http or https when it is an absolute URL."
        }
        if (-not [string]::IsNullOrEmpty($absoluteUri.UserInfo)) {
            throw "$Name must not contain embedded credentials."
        }
        return $absoluteUri.AbsoluteUri
    }

    $pathValue = $Value.Trim()
    if (-not $pathValue.StartsWith('/')) {
        $pathValue = '/' + $pathValue
    }
    return $pathValue
}

$existingUrls = @()
if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
    try {
        $existingConfig = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $existingProperty = $existingConfig.PSObject.Properties['ServerUrls']
        if ($null -ne $existingProperty) {
            $existingUrls = @($existingProperty.Value)
        }
    }
    catch {
        Write-Warning 'The existing connector configuration is invalid and will be replaced.'
    }
}

$serverInputs = New-Object System.Collections.Generic.List[string]
if ([string]::IsNullOrWhiteSpace($ServerUrl)) {
    if ($existingUrls.Count -gt 0) {
        foreach ($existingUrl in $existingUrls) {
            $serverInputs.Add([string]$existingUrl)
        }
        Write-Host 'Keeping the server URLs from the existing configuration.' -ForegroundColor Cyan
    }
    else {
        $ServerUrl = Read-Host 'Primary server URL (example: http://192.168.1.20:8015)'
        if ([string]::IsNullOrWhiteSpace($ServerUrl)) {
            throw 'A primary server URL is required.'
        }
        $serverInputs.Add($ServerUrl)

        $fallbackInput = Read-Host 'Fallback server URLs, separated by commas (optional)'
        if (-not [string]::IsNullOrWhiteSpace($fallbackInput)) {
            foreach ($item in ($fallbackInput -split '[,;]')) {
                if (-not [string]::IsNullOrWhiteSpace($item)) {
                    $serverInputs.Add($item)
                }
            }
        }
    }
}
else {
    $serverInputs.Add($ServerUrl)
    foreach ($fallbackItem in @($FallbackUrl)) {
        foreach ($item in ([string]$fallbackItem -split '[,;]')) {
            if (-not [string]::IsNullOrWhiteSpace($item)) {
                $serverInputs.Add($item)
            }
        }
    }
}

$normalizedUrls = New-Object System.Collections.Generic.List[string]
$seenUrls = @{}
foreach ($serverInput in $serverInputs) {
    $normalizedUrl = ConvertTo-NormalizedServerUrl -Value $serverInput
    $urlKey = $normalizedUrl.ToLowerInvariant()
    if (-not $seenUrls.ContainsKey($urlKey)) {
        $seenUrls[$urlKey] = $true
        $normalizedUrls.Add($normalizedUrl)
    }
}
if ($normalizedUrls.Count -eq 0) {
    throw 'At least one server URL is required.'
}

$normalizedHealthPath = ConvertTo-EndpointValue -Value $HealthPath -Name 'HealthPath'
$normalizedAppPath = ConvertTo-EndpointValue -Value $AppPath -Name 'AppPath'

New-Item -ItemType Directory -Path $productDirectory -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $ConfigPath) -Force | Out-Null
$installedConnectorScript = Join-Path $productDirectory 'connect-server-and-open.ps1'
$temporaryConnectorScript = '{0}.tmp.{1}' -f $installedConnectorScript, $PID
try {
    Copy-Item -LiteralPath $sourceConnectorScript -Destination $temporaryConnectorScript -Force
    Move-Item -LiteralPath $temporaryConnectorScript -Destination $installedConnectorScript -Force
}
finally {
    if (Test-Path -LiteralPath $temporaryConnectorScript) {
        Remove-Item -LiteralPath $temporaryConnectorScript -Force -ErrorAction SilentlyContinue
    }
}

$config = [ordered]@{
    Version                  = 1
    ServerUrls               = @($normalizedUrls)
    HealthPath               = $normalizedHealthPath
    AppPath                  = $normalizedAppPath
    MaxWaitSeconds           = $MaxWaitSeconds
    RetryDelaySeconds        = $RetryDelaySeconds
    RequestTimeoutSeconds    = $RequestTimeoutSeconds
    DnsFlushAfterFailures    = $DnsFlushAfterFailures
    LogMaxBytes              = $LogMaxBytes
    LogRetention             = $LogRetention
}

$temporaryConfig = '{0}.tmp.{1}' -f $ConfigPath, $PID
try {
    $json = $config | ConvertTo-Json -Depth 4
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($temporaryConfig, $json, $utf8NoBom)
    Move-Item -LiteralPath $temporaryConfig -Destination $ConfigPath -Force
}
finally {
    if (Test-Path -LiteralPath $temporaryConfig) {
        Remove-Item -LiteralPath $temporaryConfig -Force -ErrorAction SilentlyContinue
    }
}

$powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powerShellExe -PathType Leaf)) {
    throw "Windows PowerShell 5.1 was not found: $powerShellExe"
}
if ($installedConnectorScript.Contains('"') -or $ConfigPath.Contains('"')) {
    throw 'Connector paths must not contain quotation marks.'
}

$actionArguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -ConfigPath "{1}"' -f $installedConnectorScript, $ConfigPath
$action = New-ScheduledTaskAction -Execute $powerShellExe -Argument $actionArguments -WorkingDirectory $productDirectory
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$executionMinutes = [Math]::Ceiling(($MaxWaitSeconds + 120) / 60.0)
if ($executionMinutes -lt 5) {
    $executionMinutes = 5
}
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes $executionMinutes) `
    -RestartCount 12 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Waits for the configured server and opens Librairie Print once in Google Chrome.' `
    -Force | Out-Null

if (-not $NoStart) {
    Start-ScheduledTask -TaskName $TaskName
}

$logFile = Join-Path $productDirectory 'logs\connector.log'
Write-Host ''
Write-Host 'Client connector installed successfully.' -ForegroundColor Green
Write-Host "Task:   $TaskName"
Write-Host "User:   $currentUser"
Write-Host "Config: $ConfigPath"
Write-Host "Script: $installedConnectorScript"
Write-Host "Log:    $logFile"
Write-Host ('Servers: ' + ($normalizedUrls -join ', '))
if ($NoStart) {
    Write-Host 'The task will start at the next logon.' -ForegroundColor Yellow
}
else {
    Write-Host 'The task has started and will open the application when it is ready.' -ForegroundColor Cyan
}
