# Silent Windows logon launcher with diagnostics.
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeDir = Join-Path $ScriptDir ".runtime"
$LogFile = Join-Path $RuntimeDir "autostart.log"
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

try {
    Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value "`r`n[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Windows autostart triggered"
    # Let Windows networking and the user desktop finish loading.
    Start-Sleep -Seconds 15
    & (Join-Path $ScriptDir "start.ps1") *>> $LogFile
    Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Startup completed"
} catch {
    Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERROR: $($_.Exception.Message)"
    exit 1
}
