#!/bin/bash
# Backup giornaliero all'ora UTC indicata (BACKUP_HOUR_UTC default 3, BACKUP_MINUTE_UTC default 0). Un errore viene registrato nel log e non ferma l'app.
set -u
HOUR="${BACKUP_HOUR_UTC:-3}"
MIN="${BACKUP_MINUTE_UTC:-0}"
while true; do
  now=$(date -u +%s)
  next=$(date -u -d "today ${HOUR}:${MIN}" +%s)
  [ "$next" -le "$now" ] && next=$(date -u -d "tomorrow ${HOUR}:${MIN}" +%s)
  sleep $((next - now))
  if /app/deploy/backup.sh; then echo "[backup] completato $(date -u +%FT%TZ)"; else echo "[backup] ERRORE $(date -u +%FT%TZ)" >&2; fi
done
