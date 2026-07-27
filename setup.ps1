# setup.ps1 — ProERP Web Windows Setup (PowerShell)
# Run as: Right-click → "Run with PowerShell"
# Or:     powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step($msg) { Write-Host "`n  >> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "  [ERREUR] $msg" -ForegroundColor Red; Read-Host "Appuyez sur Entree pour quitter"; exit 1 }

Write-Host "`n=========================================" -ForegroundColor Blue
Write-Host "   ProERP Web -- Setup Windows" -ForegroundColor Blue  
Write-Host "=========================================`n" -ForegroundColor Blue

# ── Python ────────────────────────────────────────────────────────────────────
Write-Step "Verification Python..."
try {
    $pyVer = python --version 2>&1
    Write-OK $pyVer
} catch {
    Write-Fail "Python introuvable. Installez Python 3.11+ depuis https://www.python.org/downloads/ (cochez 'Add to PATH')"
}

# ── Node.js ───────────────────────────────────────────────────────────────────
Write-Step "Verification Node.js..."
try {
    $nodeVer = node --version 2>&1
    Write-OK "Node.js $nodeVer"
} catch {
    Write-Fail "Node.js introuvable. Installez Node.js 18+ depuis https://nodejs.org/"
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
& "venv\Scripts\pip.exe" install -r requirements.txt --quiet
Write-OK "Dependances Python installees"

Write-Host "  Initialisation base de donnees..." -ForegroundColor Yellow
& "venv\Scripts\python.exe" -c "
from core.database import init_db
init_db()
from core.database import SessionLocal
from models import Client
db = SessionLocal()
count = db.query(Client).count()
db.close()
if count == 0:
    import seed_demo
    seed_demo.run()
else:
    print('  Donnees existantes conservees')
"
Write-OK "Base de donnees prete"

# ── Frontend Setup ────────────────────────────────────────────────────────────
Write-Step "Configuration du frontend React..."
Set-Location "$ScriptDir\frontend"

Write-Host "  Installation des modules npm..." -ForegroundColor Yellow
npm install --silent
Write-OK "Modules npm installes"

# ── Create Desktop Shortcut ──────────────────────────────────────────────────
Write-Step "Creation du raccourci bureau..."
try {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $shortcut = "$desktop\ProERP Web.lnk"
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($shortcut)
    $sc.TargetPath = "$ScriptDir\start.bat"
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
Write-Host "  Pour demarrer: double-cliquez sur  start.bat" -ForegroundColor White
Write-Host "  Ou lancez:     .\start.bat`n" -ForegroundColor White

Read-Host "Appuyez sur Entree pour terminer"
