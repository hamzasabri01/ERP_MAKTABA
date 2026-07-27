#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

mkdir -p backend/backups backend/uploads backups logs

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Edit SECRET_KEY before production use."
fi

docker compose up -d --build
docker compose ps

echo "SecureERP Cloud is starting on http://SERVER_IP/"
echo "Health check: curl http://SERVER_IP/health"
