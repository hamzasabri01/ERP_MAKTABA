# setup.ps1 — ProERP Web Windows Setup (PowerShell)
# Run as: Right-click → "Run with PowerShell"
# Or:     powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step($msg) { Write-Host "`n  >> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "  [ERREUR] $msg" -ForegroundColor Red; Read-Host "Appuyez sur Entree pour quitter"; exit 1 }
function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}
function Install-WithWinget($id, $label) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Fail "$label est absent et Winget est indisponible. Installez App Installer depuis Microsoft Store puis relancez setup.ps1."
    }
    Write-Host "  Installation automatique de $label..." -ForegroundColor Yellow
    winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { Write-Fail "Installation automatique de $label impossible." }
    Refresh-Path
}

Write-Host "`n=========================================" -ForegroundColor Blue
Write-Host "   ProERP Web -- Setup Windows" -ForegroundColor Blue  
Write-Host "=========================================`n" -ForegroundColor Blue

# ── Python ────────────────────────────────────────────────────────────────────
Write-Step "Verification Python..."
try {
    $pyVer = python --version 2>&1
    Write-OK $pyVer
} catch {
    Install-WithWinget "Python.Python.3.12" "Python 3.12"
    try { $pyVer = python --version 2>&1; Write-OK $pyVer }
    catch { Write-Fail "Python a ete installe mais n'est pas encore accessible. Redemarrez Windows puis relancez setup.ps1." }
}

# ── Node.js ───────────────────────────────────────────────────────────────────
Write-Step "Verification Node.js..."
try {
    $nodeVer = node --version 2>&1
    Write-OK "Node.js $nodeVer"
} catch {
    Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
    try { $nodeVer = node --version 2>&1; Write-OK "Node.js $nodeVer" }
    catch { Write-Fail "Node.js a ete installe mais n'est pas encore accessible. Redemarrez Windows puis relancez setup.ps1." }
}

# Scanner mobile HTTPS (optionnel mais installe automatiquement si possible)
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Step "Installation du connecteur scanner mobile..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id Cloudflare.cloudflared --exact --silent --accept-package-agreements --accept-source-agreements
        Refresh-Path
    }
}

# ── Backend Setup ─────────────────────────────────────────────────────────────
Write-Step "Configuration du backend Python..."
Set-Location "$ScriptDir\backend"

if (-not (Test-Path "venv")) {
    Write-Host "  Creation de l'environnement virtuel..." -ForegroundColor Yellow
    python -m venv venv
    Write-OK "Environnement virtuel cree"
} else {
    Write-OK "Environnement virtuel existant"
}

Write-Host "  Installation des dependances Python..." -ForegroundColor Yellow
& "venv\Scripts\python.exe" -m pip install --upgrade pip --quiet
if ($LASTEXITCODE -ne 0) { Write-Fail "Echec mise a jour de pip." }
& "venv\Scripts\pip.exe" install -r requirements.txt --quiet
if ($LASTEXITCODE -ne 0) { Write-Fail "Echec installation des dependances Python." }
Write-OK "Dependances Python installees"

# ── Local environment and initial administrator ──────────────────────────────
$BackendEnv = Join-Path $ScriptDir "backend\.env"
$BackendEnvExample = Join-Path $ScriptDir "backend\.env.example"
if (-not (Test-Path $BackendEnv)) {
    Copy-Item -LiteralPath $BackendEnvExample -Destination $BackendEnv
}
$EnvContent = [IO.File]::ReadAllText($BackendEnv)
if ($EnvContent -match "(?m)^INITIAL_ADMIN_PASSWORD=\s*$") {
    $AdminPassword = Read-Host "  Mot de passe initial admin (Entree = Sabri2026)"
    if ([string]::IsNullOrWhiteSpace($AdminPassword)) { $AdminPassword = "Sabri2026" }
    if ($AdminPassword.Length -lt 8 -or $AdminPassword -notmatch "[A-Za-z]" -or $AdminPassword -notmatch "\d" -or $AdminPassword -match "(?i)admin") {
        Write-Fail "Mot de passe invalide: 8 caracteres minimum, lettres + chiffres, sans le mot admin."
    }
    $EnvContent = $EnvContent -replace "(?m)^INITIAL_ADMIN_PASSWORD=.*$", "INITIAL_ADMIN_PASSWORD=$AdminPassword"
    [IO.File]::WriteAllText($BackendEnv, $EnvContent, [Text.UTF8Encoding]::new($false))
}

Write-Host "  Initialisation base de donnees..." -ForegroundColor Yellow
& "venv\Scripts\python.exe" -c "from core.database import init_db; init_db(); print('  Base initialisee sans donnees de demonstration')"
if ($LASTEXITCODE -ne 0) { Write-Fail "Echec initialisation de la base de donnees." }
Write-OK "Base de donnees prete"

# ── Frontend Setup ────────────────────────────────────────────────────────────
Write-Step "Configuration du frontend React..."
Set-Location "$ScriptDir\frontend"

Write-Host "  Installation des modules npm..." -ForegroundColor Yellow
if (Test-Path "package-lock.json") { npm ci --silent } else { npm install --silent }
if ($LASTEXITCODE -ne 0) { Write-Fail "Echec installation des modules frontend." }
Write-OK "Modules npm installes"

# ── Create Desktop Shortcut ──────────────────────────────────────────────────
Write-Step "Creation du raccourci bureau..."
try {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $shortcut = "$desktop\ProERP Web.lnk"
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($shortcut)
    $sc.TargetPath = "powershell.exe"
    $sc.Arguments = "-ExecutionPolicy Bypass -File `"$ScriptDir\start.ps1`""
    $sc.WorkingDirectory = $ScriptDir
    $sc.Description = "Lancer ProERP Web"
    $sc.Save()
    Write-OK "Raccourci cree sur le bureau: 'ProERP Web'"
} catch {
    Write-Host "  (Raccourci non cree - optionnel)" -ForegroundColor Gray
}

Write-Host "`n=========================================" -ForegroundColor Green
Write-Host "      Installation terminee !" -ForegroundColor Green
Write-Host "=========================================`n" -ForegroundColor Green
Write-Host "  Pour demarrer: utilisez le raccourci 'ProERP Web'" -ForegroundColor White
Write-Host "  Ou lancez:     powershell -ExecutionPolicy Bypass -File .\start.ps1`n" -ForegroundColor White
Write-Host "  Le script de demarrage affichera:" -ForegroundColor White
Write-Host "    - le lien local de ce PC" -ForegroundColor Gray
Write-Host "    - le lien reseau pour les autres PC du meme Wi-Fi/LAN`n" -ForegroundColor Gray

Set-Location $ScriptDir
Read-Host "Appuyez sur Entree pour terminer"
