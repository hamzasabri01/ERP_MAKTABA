[CmdletBinding()]
param(
    [string]$ConfigPath,

    [string[]]$ServerUrl = @(),

    [ValidateRange(0, 3600)]
    [int]$InitialDelaySeconds = 0,

    [ValidateRange(0, 86400)]
    [int]$StartupTimeoutSeconds = 0,

    [switch]$Silent
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$productDirectory = Join-Path $env:LOCALAPPDATA 'LibrairiePrintWeb\ClientConnector'
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $productDirectory 'config.json'
}

$logDirectory = Join-Path $productDirectory 'logs'
$script:LogFile = Join-Path $logDirectory 'connector.log'
$script:LogMaxBytes = 2097152
$script:LogRetention = 5
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Rotate-ConnectorLog {
    if (-not (Test-Path -LiteralPath $script:LogFile -PathType Leaf)) {
        return
    }

    $logItem = Get-Item -LiteralPath $script:LogFile -ErrorAction SilentlyContinue
    if ($null -eq $logItem -or $logItem.Length -lt $script:LogMaxBytes) {
        return
    }

    $oldestLog = '{0}.{1}' -f $script:LogFile, $script:LogRetention
    if (Test-Path -LiteralPath $oldestLog) {
        Remove-Item -LiteralPath $oldestLog -Force -ErrorAction SilentlyContinue
    }

    for ($index = $script:LogRetention - 1; $index -ge 1; $index--) {
        $sourceLog = '{0}.{1}' -f $script:LogFile, $index
        $destinationLog = '{0}.{1}' -f $script:LogFile, ($index + 1)
        if (Test-Path -LiteralPath $sourceLog) {
            Move-Item -LiteralPath $sourceLog -Destination $destinationLog -Force -ErrorAction SilentlyContinue
        }
    }

    Move-Item -LiteralPath $script:LogFile -Destination ($script:LogFile + '.1') -Force -ErrorAction SilentlyContinue
}

function Write-ConnectorLog {
    param(
        [ValidateSet('INFO', 'WARN', 'ERROR')]
        [string]$Level,
        [string]$Message
    )

    try {
        Rotate-ConnectorLog
        $safeMessage = $Message -replace '[\r\n]+', ' '
        $line = '{0} [{1}] {2}{3}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $Level, $safeMessage, [Environment]::NewLine
        [System.IO.File]::AppendAllText($script:LogFile, $line, $script:Utf8NoBom)
    }
    catch {
        # Logging must never prevent the connector from doing its main job.
    }
}

function Get-ConfigValue {
    param(
        [object]$Config,
        [string]$Name,
        [object]$DefaultValue
    )

    $property = $Config.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) {
        return $DefaultValue
    }
    return $property.Value
}

function Get-BoundedInteger {
    param(
        [object]$Value,
        [string]$Name,
        [int]$Minimum,
        [int]$Maximum
    )

    $parsed = 0
    if (-not [int]::TryParse([string]$Value, [ref]$parsed) -or $parsed -lt $Minimum -or $parsed -gt $Maximum) {
        throw "Invalid $Name in connector configuration. Expected $Minimum..$Maximum."
    }
    return $parsed
}

function ConvertTo-HttpUri {
    param(
        [string]$Value,
        [string]$Name
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$Name cannot be empty."
    }

    try {
        $uri = New-Object System.Uri($Value.Trim(), [System.UriKind]::Absolute)
    }
    catch {
        throw "$Name is not a valid absolute URL."
    }

    if ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https') {
        throw "$Name must use http or https."
    }
    if ([string]::IsNullOrWhiteSpace($uri.Host) -or -not [string]::IsNullOrEmpty($uri.UserInfo)) {
        throw "$Name contains an invalid host or embedded credentials."
    }
    return $uri
}

function Join-EndpointUri {
    param(
        [System.Uri]$BaseUri,
        [string]$Endpoint,
        [string]$Name
    )

    if ([string]::IsNullOrWhiteSpace($Endpoint)) {
        throw "$Name cannot be empty."
    }

    $absoluteEndpoint = $null
    if ([System.Uri]::TryCreate($Endpoint, [System.UriKind]::Absolute, [ref]$absoluteEndpoint)) {
        return ConvertTo-HttpUri -Value $absoluteEndpoint.AbsoluteUri -Name $Name
    }

    $relativeEndpoint = $Endpoint.Trim()
    if (-not $relativeEndpoint.StartsWith('/')) {
        $relativeEndpoint = '/' + $relativeEndpoint
    }
    return New-Object System.Uri($BaseUri, $relativeEndpoint)
}

function Test-UsableLocalIPv4 {
    try {
        foreach ($adapter in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
            if ($adapter.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) {
                continue
            }
            if ($adapter.NetworkInterfaceType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback) {
                continue
            }

            foreach ($addressInfo in $adapter.GetIPProperties().UnicastAddresses) {
                $address = $addressInfo.Address
                if ($address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
                    continue
                }
                $textAddress = $address.ToString()
                if ($textAddress -notlike '127.*' -and $textAddress -notlike '169.254.*' -and $textAddress -ne '0.0.0.0') {
                    return $true
                }
            }
        }
    }
    catch {
        return $false
    }
    return $false
}

function Test-IsLoopbackUri {
    param([System.Uri]$Uri)

    if ($Uri.DnsSafeHost -eq 'localhost') {
        return $true
    }

    $parsedAddress = $null
    if ([System.Net.IPAddress]::TryParse($Uri.DnsSafeHost, [ref]$parsedAddress)) {
        return [System.Net.IPAddress]::IsLoopback($parsedAddress)
    }
    return $false
}

function Resolve-ServerIPv4 {
    param([System.Uri]$Uri)

    $parsedAddress = $null
    if ([System.Net.IPAddress]::TryParse($Uri.DnsSafeHost, [ref]$parsedAddress)) {
        if ($parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
            throw 'The server address has no IPv4 endpoint.'
        }
        return @($parsedAddress)
    }

    $addresses = @(
        [System.Net.Dns]::GetHostAddresses($Uri.DnsSafeHost) |
            Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork }
    )
    if ($addresses.Count -eq 0) {
        throw 'DNS returned no IPv4 address.'
    }
    return $addresses
}

function Test-ServerTcpPort {
    param(
        [System.Net.IPAddress[]]$Addresses,
        [int]$Port,
        [int]$TimeoutSeconds
    )

    $lastError = 'No IPv4 address could be contacted.'
    foreach ($address in $Addresses) {
        $client = New-Object System.Net.Sockets.TcpClient([System.Net.Sockets.AddressFamily]::InterNetwork)
        try {
            $asyncResult = $client.BeginConnect($address, $Port, $null, $null)
            if (-not $asyncResult.AsyncWaitHandle.WaitOne($TimeoutSeconds * 1000, $false)) {
                throw 'TCP connection timed out.'
            }
            $client.EndConnect($asyncResult)
            return $true
        }
        catch {
            $lastError = $_.Exception.Message
        }
        finally {
            $client.Close()
        }
    }
    throw $lastError
}

function Invoke-Get200 {
    param(
        [System.Uri]$Uri,
        [int]$TimeoutSeconds
    )

    $response = Invoke-WebRequest `
        -Uri $Uri.AbsoluteUri `
        -Method Get `
        -UseBasicParsing `
        -TimeoutSec $TimeoutSeconds `
        -Headers @{ 'Cache-Control' = 'no-cache'; 'User-Agent' = 'LibrairiePrintWeb-ClientConnector/1.0' }

    if ($null -eq $response -or $response.StatusCode -ne 200) {
        throw ('Expected HTTP 200 from {0}.' -f $Uri.Host)
    }
    return $response
}

function Invoke-HealthGet {
    param(
        [System.Uri]$Uri,
        [int]$TimeoutSeconds
    )

    $response = Invoke-Get200 -Uri $Uri -TimeoutSeconds $TimeoutSeconds
    try {
        $health = $response.Content | ConvertFrom-Json
    }
    catch {
        throw ('Health endpoint did not return valid JSON: ' + $_.Exception.Message)
    }

    $statusProperty = $health.PSObject.Properties['status']
    if ($null -eq $statusProperty -or [string]$statusProperty.Value -ne 'ok') {
        throw 'Health endpoint JSON does not contain status="ok".'
    }
    return $response
}

function Clear-DnsCacheSafely {
    $ipconfig = Join-Path $env:SystemRoot 'System32\ipconfig.exe'
    if (-not (Test-Path -LiteralPath $ipconfig -PathType Leaf)) {
        Write-ConnectorLog -Level 'WARN' -Message 'DNS flush skipped because ipconfig.exe was not found.'
        return
    }

    try {
        & $ipconfig /flushdns *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-ConnectorLog -Level 'INFO' -Message 'Windows DNS cache flushed after repeated DNS failures.'
        }
        else {
            Write-ConnectorLog -Level 'WARN' -Message ("DNS flush returned exit code $LASTEXITCODE; retries will continue.")
        }
    }
    catch {
        Write-ConnectorLog -Level 'WARN' -Message ('DNS flush failed; retries will continue: ' + $_.Exception.Message)
    }
}

function Get-ChromeExecutable {
    $candidates = New-Object System.Collections.Generic.List[string]
    $registryPaths = @(
        'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
        'Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
        'Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'
    )

    foreach ($registryPath in $registryPaths) {
        try {
            if (Test-Path -LiteralPath $registryPath) {
                $registeredPath = (Get-Item -LiteralPath $registryPath).GetValue('')
                if (-not [string]::IsNullOrWhiteSpace([string]$registeredPath)) {
                    $candidates.Add(([string]$registeredPath).Trim().Trim('"'))
                }
            }
        }
        catch {
            # Continue with the remaining registry and standard locations.
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $candidates.Add((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'))
    }
    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
        $candidates.Add((Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'))
    }
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $candidates.Add((Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'))
    }

    $seen = @{}
    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        $key = $candidate.ToLowerInvariant()
        if (-not $seen.ContainsKey($key)) {
            $seen[$key] = $true
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                return (Get-Item -LiteralPath $candidate).FullName
            }
        }
    }

    throw 'Google Chrome was not found in the registry or standard install locations.'
}

$mutex = $null
$ownsMutex = $false
$exitCode = 1

try {
    $mutex = New-Object System.Threading.Mutex($false, 'Local\LibrairiePrintWeb.ClientConnector')
    try {
        $ownsMutex = $mutex.WaitOne(0, $false)
    }
    catch [System.Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }

    if (-not $ownsMutex) {
        Write-ConnectorLog -Level 'INFO' -Message 'Another connector instance is already running; this instance will exit.'
        $exitCode = 0
    }
    else {
        $candidates = @()

        $directServerValues = @($ServerUrl | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
        if ($directServerValues.Count -gt 0) {
            $maxWaitSeconds = 600
            if ($StartupTimeoutSeconds -gt 0) {
                $maxWaitSeconds = $StartupTimeoutSeconds
            }
            $retryDelaySeconds = 5
            $requestTimeoutSeconds = 8
            $dnsFlushAfterFailures = 3

            foreach ($serverValue in $directServerValues) {
                $appUri = ConvertTo-HttpUri -Value ([string]$serverValue) -Name 'ServerUrl entry'
                $healthUri = Join-EndpointUri -BaseUri $appUri -Endpoint '/health' -Name 'Health URL'
                $candidates += [PSCustomObject]@{
                    BaseUri   = $appUri
                    HealthUri = $healthUri
                    AppUri    = $appUri
                }
            }
        }
        else {
            if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
                throw "Connector configuration was not found: $ConfigPath"
            }

            $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $serverValues = @(Get-ConfigValue -Config $config -Name 'ServerUrls' -DefaultValue @())
            if ($serverValues.Count -eq 0) {
                throw 'Connector configuration contains no ServerUrls.'
            }

            $healthPath = [string](Get-ConfigValue -Config $config -Name 'HealthPath' -DefaultValue '/health')
            $appPath = [string](Get-ConfigValue -Config $config -Name 'AppPath' -DefaultValue '/erp')
            $maxWaitSeconds = Get-BoundedInteger -Value (Get-ConfigValue $config 'MaxWaitSeconds' 600) -Name 'MaxWaitSeconds' -Minimum 10 -Maximum 86400
            if ($StartupTimeoutSeconds -gt 0) {
                $maxWaitSeconds = $StartupTimeoutSeconds
            }
            $retryDelaySeconds = Get-BoundedInteger -Value (Get-ConfigValue $config 'RetryDelaySeconds' 5) -Name 'RetryDelaySeconds' -Minimum 1 -Maximum 300
            $requestTimeoutSeconds = Get-BoundedInteger -Value (Get-ConfigValue $config 'RequestTimeoutSeconds' 8) -Name 'RequestTimeoutSeconds' -Minimum 1 -Maximum 120
            $dnsFlushAfterFailures = Get-BoundedInteger -Value (Get-ConfigValue $config 'DnsFlushAfterFailures' 3) -Name 'DnsFlushAfterFailures' -Minimum 1 -Maximum 100
            $script:LogMaxBytes = Get-BoundedInteger -Value (Get-ConfigValue $config 'LogMaxBytes' 2097152) -Name 'LogMaxBytes' -Minimum 65536 -Maximum 104857600
            $script:LogRetention = Get-BoundedInteger -Value (Get-ConfigValue $config 'LogRetention' 5) -Name 'LogRetention' -Minimum 1 -Maximum 20

            foreach ($serverValue in $serverValues) {
                $baseUri = ConvertTo-HttpUri -Value ([string]$serverValue) -Name 'ServerUrls entry'
                $healthUri = Join-EndpointUri -BaseUri $baseUri -Endpoint $healthPath -Name 'HealthPath'
                $appUri = Join-EndpointUri -BaseUri $baseUri -Endpoint $appPath -Name 'AppPath'
                $candidates += [PSCustomObject]@{
                    BaseUri   = $baseUri
                    HealthUri = $healthUri
                    AppUri    = $appUri
                }
            }
        }

        $chromeExecutable = Get-ChromeExecutable
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12

        Write-ConnectorLog -Level 'INFO' -Message ("Connector started with $($candidates.Count) server URL(s).")
        if ($InitialDelaySeconds -gt 0) {
            Write-ConnectorLog -Level 'INFO' -Message ("Waiting $InitialDelaySeconds initial second(s) before connectivity checks.")
            Start-Sleep -Seconds $InitialDelaySeconds
        }

        $requiresUsableLocalIPv4 = @($candidates | Where-Object { -not (Test-IsLoopbackUri -Uri $_.BaseUri) }).Count -gt 0
        $timer = [System.Diagnostics.Stopwatch]::StartNew()
        $attempt = 0
        $dnsFailureCount = 0
        $dnsCacheFlushed = $false
        $opened = $false

        while (-not $opened -and $timer.Elapsed.TotalSeconds -lt $maxWaitSeconds) {
            $attempt++

            if ($requiresUsableLocalIPv4 -and -not (Test-UsableLocalIPv4)) {
                Write-ConnectorLog -Level 'WARN' -Message ("Attempt ${attempt}: waiting for a usable local IPv4 address.")
                Start-Sleep -Seconds $retryDelaySeconds
                continue
            }

            foreach ($candidate in $candidates) {
                $serverLabel = $candidate.BaseUri.GetLeftPart([System.UriPartial]::Authority)
                try {
                    $addresses = @(Resolve-ServerIPv4 -Uri $candidate.BaseUri)
                    $dnsFailureCount = 0
                    Write-ConnectorLog -Level 'INFO' -Message ("Attempt ${attempt}: DNS/IPv4 ready for $serverLabel.")
                }
                catch {
                    $dnsFailureCount++
                    Write-ConnectorLog -Level 'WARN' -Message ("Attempt ${attempt}: DNS/IPv4 failed for ${serverLabel}: $($_.Exception.Message)")
                    if (-not $dnsCacheFlushed -and $dnsFailureCount -ge $dnsFlushAfterFailures) {
                        Clear-DnsCacheSafely
                        $dnsCacheFlushed = $true
                    }
                    continue
                }

                try {
                    Test-ServerTcpPort -Addresses $addresses -Port $candidate.BaseUri.Port -TimeoutSeconds $requestTimeoutSeconds | Out-Null
                    Write-ConnectorLog -Level 'INFO' -Message ("Attempt ${attempt}: TCP ready for $serverLabel.")
                }
                catch {
                    Write-ConnectorLog -Level 'WARN' -Message ("Attempt ${attempt}: TCP failed for ${serverLabel}: $($_.Exception.Message)")
                    continue
                }

                try {
                    Invoke-HealthGet -Uri $candidate.HealthUri -TimeoutSeconds $requestTimeoutSeconds | Out-Null
                    Write-ConnectorLog -Level 'INFO' -Message ("Attempt ${attempt}: health GET succeeded for $serverLabel.")
                }
                catch {
                    Write-ConnectorLog -Level 'WARN' -Message ("Attempt ${attempt}: health GET failed for ${serverLabel}: $($_.Exception.Message)")
                    continue
                }

                try {
                    Invoke-Get200 -Uri $candidate.AppUri -TimeoutSeconds $requestTimeoutSeconds | Out-Null
                    Write-ConnectorLog -Level 'INFO' -Message ("Attempt ${attempt}: application GET succeeded for $serverLabel.")
                }
                catch {
                    Write-ConnectorLog -Level 'WARN' -Message ("Attempt ${attempt}: application GET failed for ${serverLabel}: $($_.Exception.Message)")
                    continue
                }

                Start-Process -FilePath $chromeExecutable -ArgumentList @('--new-window', $candidate.AppUri.AbsoluteUri) -ErrorAction Stop | Out-Null
                $opened = $true
                Write-ConnectorLog -Level 'INFO' -Message ("Application opened once in Google Chrome from $serverLabel.")
                break
            }

            if (-not $opened -and $timer.Elapsed.TotalSeconds -lt $maxWaitSeconds) {
                Start-Sleep -Seconds $retryDelaySeconds
            }
        }

        if (-not $opened) {
            throw "No configured server became ready within $maxWaitSeconds seconds."
        }
        $exitCode = 0
    }
}
catch {
    Write-ConnectorLog -Level 'ERROR' -Message $_.Exception.Message
    $exitCode = 1
}
finally {
    if ($ownsMutex -and $null -ne $mutex) {
        try {
            $mutex.ReleaseMutex()
        }
        catch {
        }
    }
    if ($null -ne $mutex) {
        $mutex.Dispose()
    }
}

exit $exitCode
