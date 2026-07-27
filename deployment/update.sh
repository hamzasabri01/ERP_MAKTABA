#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  git pull --ff-only
fi

docker compose pull || true
docker compose up -d --build
docker image prune -f
docker compose ps

echo "SecureERP Cloud update finished."
