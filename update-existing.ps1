# Library Sabri - safe in-place updater for an existing installation.
# Preserves the SQLite database, uploaded product images, settings and research files.
param(
    [string]$Remote = "origin",
    [string]$Branch = "main",
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ScriptDir "backend"
$Database = Join-Path $BackendDir "proerp.db"
$Guard = Join-Path $ScriptDir "scripts\upgrade_data_guard.py"
$RootVenvPython = Join-Path $ScriptDir ".venv\Scripts\python.exe"
$BackendVenvPython = Join-Path $BackendDir "venv\Scripts\python.exe"
$Python = if (Test-Path $RootVenvPython) { $RootVenvPython } elseif (Test-Path $BackendVenvPython) { $BackendVenvPython } else { "python" }
$BackupRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "LibrarySabri\upgrade-backups"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $BackupRoot $Stamp
$SnapshotBefore = Join-Path $BackupDir "before.json"
$DatabaseBackup = Join-Path $BackupDir "proerp.db"
$OldCommit = $null
$TaskWasRunning = $false
$StartupTasks = @("LibrarySabri-Server", "LibrarySabri-OpenChrome", "ProERP LAN Server", "LibrarySabri")

function Info($message) { Write-Host "[INFO] $message" -ForegroundColor Cyan }
function Good($message) { Write-Host "[OK]   $message" -ForegroundColor Green }
function Warn($message) { Write-Host "[WARN] $message" -ForegroundColor Yellow }

function Remove-GitCheckoutBlocker([string]$RelativePath) {
    # Some Windows/OneDrive installations leave script files as reparse-point
    # placeholders. Git can then fail with "unable to create file ...: File
    # exists" during reset. Only remove repository code files, never runtime
    # data/database paths.
    if ($RelativePath -match '^(backend[\\/](proerp\.db|uploads|data|backups|company_settings\.json)|backend[\\/]\.env)($|[\\/])') {
        return
    }
    $target = Join-Path $ScriptDir $RelativePath
    if (-not (Test-Path -LiteralPath $target)) { return }
    try {
        $item = Get-Item -LiteralPath $target -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.PSIsContainer) {
            Warn "Nettoyage d'un fichier Git bloque: $RelativePath"
            Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
        }
    } catch {
        Warn "Impossible de nettoyer $RelativePath automatiquement: $($_.Exception.Message)"
    }
}

function Invoke-GitResetHardSafe([string]$Revision) {
    foreach ($blocker in @(
        "install-autostart.ps1",
        "startup-launch.ps1",
        "start.ps1",
        "stop.ps1",
        "update-existing.ps1",
        "MAJ-GITHUB-SANS-PERTE.cmd",
        "APPLIQUER-CORRECTION-SCANNER.cmd"
    )) {
        Remove-GitCheckoutBlocker $blocker
    }
    git clean -fd -- install-autostart.ps1 startup-launch.ps1 start.ps1 stop.ps1 update-existing.ps1 MAJ-GITHUB-SANS-PERTE.cmd APPLIQUER-CORRECTION-SCANNER.cmd | Out-Null
    git reset --hard $Revision
    return $LASTEXITCODE
}

function Copy-PreservedItem([string]$RelativePath) {
    $source = Join-Path $ScriptDir $RelativePath
    if (-not (Test-Path -LiteralPath $source)) { return }
    $target = Join-Path $BackupDir $RelativePath
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
}

function Restore-PreservedItem([string]$RelativePath) {
    $source = Join-Path $BackupDir $RelativePath
    if (-not (Test-Path -LiteralPath $source)) { return }
    $target = Join-Path $ScriptDir $RelativePath
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
}

Write-Host "`n=========================================" -ForegroundColor Blue
Write-Host " LIBRARY SABRI - MISE A JOUR SECURISEE" -ForegroundColor Blue
Write-Host "=========================================`n" -ForegroundColor Blue

Set-Location $ScriptDir
if (-not (Test-Path ".git")) { throw "Ce dossier n'est pas une installation Git." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git est introuvable." }
if (-not (Test-Path $Database)) { throw "Base de donnees introuvable: $Database" }
Info "Recuperation de l'outil de protection des donnees..."
git fetch $Remote $Branch --quiet
if ($LASTEXITCODE -ne 0) { throw "Impossible de preparer l'outil de sauvegarde." }
$guardSource = git show "${Remote}/${Branch}:scripts/upgrade_data_guard.py"
if ($LASTEXITCODE -ne 0 -or -not $guardSource) { throw "Outil de protection des donnees introuvable dans la nouvelle version." }
New-Item -ItemType Directory -Path (Split-Path -Parent $Guard) -Force | Out-Null
[IO.File]::WriteAllLines($Guard, [string[]]$guardSource, [Text.UTF8Encoding]::new($false))

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
$OldCommit = (git rev-parse HEAD).Trim()

try {
    foreach ($taskName in $StartupTasks) {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($task -and $task.State -eq "Running") {
            $TaskWasRunning = $true
            Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        }
    }
    Info "Arret temporaire de l'application..."
    & (Join-Path $ScriptDir "stop.ps1") | Out-Host
    Start-Sleep -Seconds 2

    Info "Sauvegarde de la base et verification d'integrite..."
    & $Python $Guard snapshot --database $Database --output $SnapshotBefore | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Impossible de lire la base actuelle." }
    & $Python $Guard backup --database $Database --output $DatabaseBackup | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Impossible de sauvegarder la base actuelle." }
    foreach ($item in @("backend\.env", "backend\company_settings.json", "backend\uploads", "backend\data", "backend\backups")) {
        Copy-PreservedItem $item
    }
    Good "Sauvegarde creee: $BackupDir"

    Info "Telechargement de la nouvelle version..."
    git fetch $Remote $Branch --prune
    if ($LASTEXITCODE -ne 0) { throw "Echec du telechargement Git." }
    Invoke-GitResetHardSafe "$Remote/$Branch" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Echec de mise a jour du code." }

    # Restore local data even if a future repository version accidentally
    # contains placeholder settings or runtime directories.
    Copy-Item -LiteralPath $DatabaseBackup -Destination $Database -Force
    foreach ($item in @("backend\.env", "backend\company_settings.json", "backend\uploads", "backend\data", "backend\backups")) {
        Restore-PreservedItem $item
    }

    Info "Mise a jour des dependances Python..."
    if (-not (Test-Path $BackendVenvPython) -and -not (Test-Path $RootVenvPython)) {
        python -m venv (Join-Path $BackendDir "venv")
        $Python = $BackendVenvPython
    }
    & $Python -m pip install -r (Join-Path $BackendDir "requirements.txt") --quiet
    if ($LASTEXITCODE -ne 0) { throw "Echec des dependances Python." }

    Info "Migration additive de la base existante..."
    Push-Location $BackendDir
    try {
        & $Python -c "from core.database import init_db; init_db(); print('DATABASE_UPGRADE_OK')"
        if ($LASTEXITCODE -ne 0) { throw "Echec de migration de la base." }
    } finally { Pop-Location }

    Info "Mise a jour de l'interface..."
    Push-Location (Join-Path $ScriptDir "frontend")
    try {
        if (Test-Path "package-lock.json") { npm ci --silent } else { npm install --silent }
        if ($LASTEXITCODE -ne 0) { throw "Echec des dependances frontend." }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Echec de compilation frontend." }
    } finally { Pop-Location }

    Info "Verification que les produits et documents sont conserves..."
    & $Python $Guard verify --database $Database --before $SnapshotBefore | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Le controle des donnees apres mise a jour a echoue." }
    Good "Base intacte: aucun produit ni document perdu."

    Info "Activation du serveur local, du diagnostic et du demarrage automatique..."
    & (Join-Path $ScriptDir "scripts\install-lan-erp-startup.ps1") -Port 8015 -OpenFirewall -NoImmediateOpen | Out-Host

    $health = Invoke-RestMethod "http://127.0.0.1:8015/health" -TimeoutSec 12
    if ($health.status -ne "ok") { throw "Le nouveau serveur ne repond pas correctement." }

    Good "Mise a jour terminee avec succes. Version serveur: $($health.version)"
    Write-Host "Sauvegarde de securite: $BackupDir" -ForegroundColor Gray
    if (-not $NoBrowser) { Start-Process "http://127.0.0.1:8015/erp" }
} catch {
    Write-Host "[ERREUR] $($_.Exception.Message)" -ForegroundColor Red
    Warn "Restauration automatique de la version et des donnees precedentes..."
    if ($OldCommit) { Invoke-GitResetHardSafe $OldCommit | Out-Null }
    if (Test-Path $DatabaseBackup) { Copy-Item -LiteralPath $DatabaseBackup -Destination $Database -Force }
    foreach ($item in @("backend\.env", "backend\company_settings.json", "backend\uploads", "backend\data", "backend\backups")) {
        Restore-PreservedItem $item
    }
    if ($TaskWasRunning) {
        foreach ($taskName in $StartupTasks) {
            Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        }
    }
    throw "Mise a jour annulee. Les anciennes donnees ont ete restaurees. Sauvegarde: $BackupDir"
}
