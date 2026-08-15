# Hidden connection repair used by the desktop launcher.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root ".runtime"
$LogFile = Join-Path $RuntimeDir "connection-repair.log"
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

function Log([string]$Message) {
    Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
}

try {
    Log "Application launch requested"
    $healthy = $false
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:5173/api/health" -TimeoutSec 4
        $healthy = $health.status -eq "ok"
    } catch {}

    if (-not $healthy) {
        Log "Connection unavailable; running automatic repair"
        & (Join-Path $Root "start.ps1") -NoBrowser -ForceRestart *>> $LogFile
    }

    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:5173/api/health" -TimeoutSec 4
            if ($health.status -eq "ok") {
                Log "End-to-end connection is ready"
                Start-Process "http://localhost:5173"
                exit 0
            }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    throw "The application API did not become ready."
} catch {
    Log "ERROR: $($_.Exception.Message)"
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        "تعذر الاتصال بخادم التطبيق. راجع الملف .runtime\connection-repair.log",
        "Library Sabri",
        "OK",
        "Error"
    ) | Out-Null
    exit 1
}
