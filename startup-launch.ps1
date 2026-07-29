# Silent Windows logon launcher with diagnostics.
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeDir = Join-Path $ScriptDir ".runtime"
$LogFile = Join-Path $RuntimeDir "autostart.log"
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

try {
    Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value "`r`n[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Windows autostart triggered"
    [IO.File]::WriteAllText((Join-Path $RuntimeDir "autostart.pid"), [string]$PID)
    # Let Windows networking and the user desktop finish loading.
    Start-Sleep -Seconds 15
    & (Join-Path $ScriptDir "start.ps1") *>> $LogFile
    Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Services started; watchdog active"

    while ($true) {
        Start-Sleep -Seconds 30
        $BackendHealthy = $false
        $FrontendHealthy = $false
        try {
            Invoke-WebRequest "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 3 | Out-Null
            $BackendHealthy = $true
        } catch {}
        try {
            $Client = [Net.Sockets.TcpClient]::new()
            $ConnectTask = $Client.ConnectAsync("127.0.0.1", 5173)
            $FrontendHealthy = $ConnectTask.Wait(3000) -and $Client.Connected
            $Client.Dispose()
        } catch {}

        if (-not $BackendHealthy -or -not $FrontendHealthy) {
            Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Service unavailable; automatic restart"
            & (Join-Path $ScriptDir "start.ps1") -NoBrowser *>> $LogFile
        }
    }
} catch {
    Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERROR: $($_.Exception.Message)"
    exit 1
}
