param(
  [string]$TaskName = "ProERP LAN Server"
)

$ErrorActionPreference = "Stop"

try {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "ProERP startup task removed: $TaskName" -ForegroundColor Green
} catch {
  Write-Host "Task not found or could not be removed: $TaskName" -ForegroundColor Yellow
}
