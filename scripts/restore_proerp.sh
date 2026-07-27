#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: bash scripts/restore_proerp.sh backups/secureerp-backup-YYYYMMDD-HHMMSS.tar.gz"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="$1"
LOG_FILE="$PROJECT_DIR/backups/restore.log"

if [ ! -f "$ARCHIVE" ]; then
  echo "Backup archive not found: $ARCHIVE"
  exit 1
fi

cd "$PROJECT_DIR"
mkdir -p backups

echo "[$(date '+%F %T')] Stopping application before restore" | tee -a "$LOG_FILE"
docker compose down

echo "[$(date '+%F %T')] Restoring archive: $ARCHIVE" | tee -a "$LOG_FILE"
tar -xzf "$ARCHIVE" -C "$PROJECT_DIR"

chmod 600 .env backend/proerp.db 2>/dev/null || true

echo "[$(date '+%F %T')] Starting application after restore" | tee -a "$LOG_FILE"
docker compose up -d --build
docker compose ps

echo "Restore finished. Verify: curl http://SERVER_IP/health"
