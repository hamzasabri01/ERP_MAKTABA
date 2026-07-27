#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$BACKUP_DIR/secureerp-backup-$TIMESTAMP.tar.gz"
LOG_FILE="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

cd "$PROJECT_DIR"

echo "[$(date '+%F %T')] Starting backup: $ARCHIVE" | tee -a "$LOG_FILE"

tar -czf "$ARCHIVE" \
  --ignore-failed-read \
  backend/proerp.db \
  backend/company_settings.json \
  backend/uploads \
  docker-compose.yml \
  Dockerfile \
  deployment/nginx-proerp.conf \
  .env 2>>"$LOG_FILE"

find "$BACKUP_DIR" -type f -name 'secureerp-backup-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[$(date '+%F %T')] Backup finished: $ARCHIVE" | tee -a "$LOG_FILE"
