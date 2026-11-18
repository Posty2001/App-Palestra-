#!/bin/sh
# Avvio del container: prepara /data, scende all'utente non privilegiato "node", avvia backup pianificati (facoltativi) e server.
set -eu
: "${STORAGE_DIR:=/data/photos}" "${BACKUP_DIR:=/data/backups}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$STORAGE_DIR" "$BACKUP_DIR"
  # I dischi dei provider vengono montati come root: li si assegna una volta all'utente dell'app.
  [ "$(stat -c %U "$STORAGE_DIR")" = "node" ] || chown -R node:node "$STORAGE_DIR"
  [ "$(stat -c %U "$BACKUP_DIR")" = "node" ] || chown -R node:node "$BACKUP_DIR"
  chmod 700 "$STORAGE_DIR" "$BACKUP_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi
if [ "${BACKUP_SCHEDULE_ENABLED:-false}" = "true" ]; then
  /app/deploy/backup-loop.sh &
fi
exec node /app/server/dist/main.js
