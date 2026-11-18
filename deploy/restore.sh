#!/bin/bash
# Ripristino di un backup cifrato in un database e in una cartella foto di destinazione, con verifica finale.
# Uso: AGE_IDENTITY=chiave-privata.txt TARGET_DATABASE_URL=... TARGET_STORAGE_DIR=... restore.sh <file.tar.age> [--force]
# Senza --force rifiuta destinazioni non vuote (protezione da sovrascritture accidentali).
set -euo pipefail
FILE="${1:?file .tar.age}"; FORCE="${2:-}"
: "${AGE_IDENTITY:?file della chiave privata age}" "${TARGET_DATABASE_URL:?}" "${TARGET_STORAGE_DIR:?}"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
umask 077

echo "[restore] decifro e controllo l'integrità"
age -d -i "$AGE_IDENTITY" "$FILE" | tar -C "$WORK" -xf -
(cd "$WORK" && sha256sum -c --quiet SHA256SUMS)
cat "$WORK/manifest.txt"

USERS=$(psql "$TARGET_DATABASE_URL" -Atqc "select count(*) from users" 2>/dev/null || echo 0)
if [ "$USERS" != "0" ] && [ "$FORCE" != "--force" ]; then echo "[restore] il DB di destinazione contiene già $USERS utenti: usa --force per sovrascriverlo" >&2; exit 2; fi
mkdir -p "$TARGET_STORAGE_DIR"
if [ -n "$(ls -A "$TARGET_STORAGE_DIR")" ] && [ "$FORCE" != "--force" ]; then echo "[restore] la cartella foto non è vuota: usa --force" >&2; exit 2; fi

echo "[restore] database"
psql "$TARGET_DATABASE_URL" -qc "set client_min_messages = warning; drop schema if exists public cascade; create schema public;"
pg_restore --no-owner --no-acl --exit-on-error -d "$TARGET_DATABASE_URL" "$WORK/db.dump"

echo "[restore] foto"
find "$TARGET_STORAGE_DIR" -mindepth 1 -delete
tar -C "$TARGET_STORAGE_DIR" -xf "$WORK/photos.tar"
chmod -R go-rwx "$TARGET_STORAGE_DIR"
# I file eliminati prima del backup non vanno ricancellati sul sistema ripristinato
psql "$TARGET_DATABASE_URL" -qc "delete from storage_gc"

echo "[restore] verifica"
DATABASE_URL="$TARGET_DATABASE_URL" STORAGE_DIR="$TARGET_STORAGE_DIR" "$(dirname "$0")/verify.sh" "$WORK"
