param(
  [int]$Port = 8015,
  [string]$TaskName = "ProERP LAN Server",
  [switch]$OpenFirewall,
  [int]$DelaySeconds = 30
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Script = Join-Path $Root "scripts\start-lan-erp.ps1"
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "proerp-startup-task.log"

if (-not (Test-Path $Script)) {
  throw "start-lan-erp.ps1 introuvable: $Script"
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if ($OpenFirewall) {
  & "$env:SystemRoot\System32\netsh.exe" advfirewall firewall add rule name="ProERP LAN $Port" dir=in action=allow protocol=TCP localport=$Port | Out-Null
}

$command = @"
Start-Sleep -Seconds $DelaySeconds
Set-Location -LiteralPath '$Root'
& '$Script' -Port $Port -NoBuild -OpenFirewall *>> '$LogFile'
"@

$action = New-ScheduledTaskAction `
  -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command $([Management.Automation.Language.CodeGeneration]::QuoteArgument($command))" `
  -WorkingDirectory $Root

$triggers = @(
  (New-ScheduledTaskTrigger -AtStartup),
  (New-ScheduledTaskTrigger -AtLogOn)
)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Days 365) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Description "Starts ProERP LAN backend and frontend on port $Port" `
  -RunLevel Highest `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host "ProERP startup task installed and started." -ForegroundColor Green
Write-Host "Task: $TaskName"
Write-Host "Port: $Port"
Write-Host "Log: $LogFile"
Write-Host "Open: http://127.0.0.1:$Port/erp"
