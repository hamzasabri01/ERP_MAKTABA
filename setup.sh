#!/bin/bash
# setup.sh — ProERP Web — One-command setup

set -e
echo ""
echo "╔══════════════════════════════════════╗"
echo "║      ProERP Web — Setup Script       ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Check Python ─────────────────────────────────────────────────────────────
python3 --version &>/dev/null || { echo "❌ Python 3.9+ required"; exit 1; }
echo "✅ Python OK"

# ── Check Node ───────────────────────────────────────────────────────────────
node --version &>/dev/null || { echo "❌ Node.js 18+ required"; exit 1; }
echo "✅ Node.js OK"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Backend ───────────────────────────────────────────────────────────────────
echo ""
echo "▶ Setting up backend..."
cd "$SCRIPT_DIR/backend"

if [ ! -d "venv" ]; then
  python3 -m venv venv
  echo "  Created virtual environment"
fi

source venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
echo "  ✅ Backend dependencies installed"

# ── Frontend ──────────────────────────────────────────────────────────────────
echo ""
echo "▶ Setting up frontend..."
cd "$SCRIPT_DIR/frontend"
npm install --silent
echo "  ✅ Frontend dependencies installed"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║           Setup Complete! 🎉         ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "To start the application, run:"
echo "  ./start.sh"
echo ""
echo "Or start manually:"
echo "  Terminal 1 (backend):  cd backend && source venv/bin/activate && uvicorn main:app --reload"
echo "  Terminal 2 (frontend): cd frontend && npm run dev"
echo ""
echo "Then open: http://localhost:5173"
echo "Login: admin / admin123"
echo ""
