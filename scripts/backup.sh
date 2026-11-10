#!/usr/bin/env bash
# Backup do MÁLAGAH Imagens: banco (pg_dump), imagens e lixeira (rsync incremental).
# Uso: BACKUP_DIR=/srv/backups/malagah ./scripts/backup.sh
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a

: "${DATABASE_URL:?DATABASE_URL não definida}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/malagah}"
KEEP_DAYS="${KEEP_DAYS:-14}"
UPLOAD_ROOT="${UPLOAD_ROOT:-public/imagens}"
TRASH_ROOT="${TRASH_ROOT:-storage/lixeira}"
STAMP="$(date +%Y%m%d-%H%M)"

mkdir -p "$BACKUP_DIR/imagens" "$BACKUP_DIR/lixeira"

echo "[$(date -Is)] banco…"
pg_dump "$DATABASE_URL" -Fc -f "$BACKUP_DIR/db-$STAMP.dump.partial"
mv "$BACKUP_DIR/db-$STAMP.dump.partial" "$BACKUP_DIR/db-$STAMP.dump"

echo "[$(date -Is)] imagens…"
rsync -a "$UPLOAD_ROOT"/ "$BACKUP_DIR/imagens/"
if [ -d "$TRASH_ROOT" ]; then rsync -a "$TRASH_ROOT"/ "$BACKUP_DIR/lixeira/"; fi

find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "[$(date -Is)] ok → $BACKUP_DIR/db-$STAMP.dump"
