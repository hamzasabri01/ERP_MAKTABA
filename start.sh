#!/bin/bash
# start.sh — Start both backend and frontend

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       ProERP Web — Starting...       ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Kill any existing processes on ports 8000 and 5173
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true

# Start backend
cd "$SCRIPT_DIR/backend"
source venv/bin/activate
echo "▶ Starting backend on http://localhost:8000 ..."
uvicorn main:app --host 0.0.0.0 --port 8000 --reload --no-proxy-headers &
BACKEND_PID=$!

sleep 2

# Start frontend
cd "$SCRIPT_DIR/frontend"
echo "▶ Starting frontend on http://localhost:5173 ..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "✅ ProERP Web is running!"
echo ""
echo "  🌐 App:    http://localhost:5173"
echo "  📡 API:    http://localhost:8000"
echo "  📖 Docs:   http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop all services."
echo ""

# Wait and handle Ctrl+C
trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
