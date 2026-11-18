#!/bin/bash
# Backup completo e cifrato di APP PALESTRA: database (pg_dump) + foto private + manifest con conteggi e checksum.
# Uscita: $BACKUP_DIR/palestra-<ambiente>-<data>.tar.age (cifrato con la chiave PUBBLICA age; la privata resta offline).
# Variabili: DATABASE_URL, STORAGE_DIR, BACKUP_DIR, BACKUP_AGE_RECIPIENT (obbligatorie)
#            BACKUP_ENV (test|prod), BACKUP_KEEP_LOCAL (default 7), BACKUP_REMOTE (es. r2:bucket/test, facoltativo)
set -euo pipefail
: "${DATABASE_URL:?}" "${STORAGE_DIR:?}" "${BACKUP_DIR:?}" "${BACKUP_AGE_RECIPIENT:?serve la chiave pubblica age}"
ENVNAME="${BACKUP_ENV:-test}"
TS=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
umask 077
mkdir -p "$BACKUP_DIR"

TABLES="users coach_links invites programs program_versions workouts workout_sets exercise_notes exercise_feedback questions body_checks check_photos check_feedback weight_entries"

# 1) Database (formato custom, compresso). Prima il DB, poi le foto: una foto caricata nel frattempo
#    finisce come file "orfano" (innocuo); verify.sh segnala eventuali righe senza file.
pg_dump --format=custom --no-owner --no-acl --file="$WORK/db.dump" "$DATABASE_URL"
{
  for t in $TABLES; do printf '%s %s\n' "$t" "$(psql "$DATABASE_URL" -Atqc "select count(*) from $t")"; done
} > "$WORK/counts.txt"
psql "$DATABASE_URL" -Atqc "select storage_key from check_photos order by storage_key" > "$WORK/photo-keys.txt"

# 2) Foto private
tar -C "$STORAGE_DIR" -cf "$WORK/photos.tar" .
FILES=$(tar -tf "$WORK/photos.tar" | grep -cv '/$' || true)

# 3) Manifest e checksum
cat > "$WORK/manifest.txt" <<MAN
app=app-palestra
env=$ENVNAME
created_utc=$TS
version=${APP_VERSION:-${RENDER_GIT_COMMIT:-unknown}}
photo_files=$FILES
photo_rows=$(wc -l < "$WORK/photo-keys.txt" | tr -d ' ')
MAN
(cd "$WORK" && sha256sum db.dump photos.tar counts.txt photo-keys.txt manifest.txt > SHA256SUMS)

# 4) Archivio cifrato (age: autenticato, una manomissione fa fallire la decifratura)
OUT="$BACKUP_DIR/palestra-$ENVNAME-$TS.tar.age"
tar -C "$WORK" -cf - SHA256SUMS manifest.txt counts.txt photo-keys.txt db.dump photos.tar | age -r "$BACKUP_AGE_RECIPIENT" -o "$OUT.partial"
mv "$OUT.partial" "$OUT"
echo "[backup] $OUT ($(du -h "$OUT" | cut -f1)) · righe foto $(wc -l < "$WORK/photo-keys.txt" | tr -d ' ') · file $FILES"

# 5) Copia off-site (facoltativa): rclone configurato da variabili RCLONE_CONFIG_<NOME>_*
if [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone -q copyto "$OUT" "$BACKUP_REMOTE/$(basename "$OUT")" --s3-no-check-bucket
  rclone -q delete "$BACKUP_REMOTE" --min-age "${BACKUP_KEEP_REMOTE_DAYS:-30}d" --include 'palestra-*.tar.age' || true
  echo "[backup] copiato su $BACKUP_REMOTE"
fi

# 6) Rotazione delle copie locali
ls -1t "$BACKUP_DIR"/palestra-"$ENVNAME"-*.tar.age 2>/dev/null | tail -n +"$(( ${BACKUP_KEEP_LOCAL:-7} + 1 ))" | xargs -r rm -f
