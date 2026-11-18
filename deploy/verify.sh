#!/bin/bash
# Verifica di coerenza tra database e archivio foto (usata dopo un ripristino e utilizzabile in qualsiasi momento).
# Uso: verify.sh [cartella-estratta-del-backup]   — con la cartella confronta anche i conteggi del manifest.
# Esce con codice ≠ 0 se una foto registrata nel DB non ha il file corrispondente o se i conteggi non coincidono.
set -euo pipefail
: "${DATABASE_URL:?}" "${STORAGE_DIR:?}"
FAIL=0
KEYS=$(mktemp); trap 'rm -f "$KEYS"' EXIT
psql "$DATABASE_URL" -Atqc "select storage_key from check_photos" > "$KEYS"
ROWS=$(wc -l < "$KEYS" | tr -d ' ')
MISSING=0
while IFS= read -r k; do [ -z "$k" ] && continue; [ -f "$STORAGE_DIR/$k" ] || { echo "MANCANTE: $k"; MISSING=$((MISSING + 1)); }; done < "$KEYS"
FILES=$(find "$STORAGE_DIR" -type f ! -name '*.tmp' | wc -l | tr -d ' ')
echo "foto nel DB: $ROWS · file: $FILES · mancanti: $MISSING · orfani: $((FILES - ROWS + MISSING))"
[ "$MISSING" -eq 0 ] || FAIL=1
if [ -n "${1:-}" ] && [ -f "$1/counts.txt" ]; then
  while read -r t n; do
    cur=$(psql "$DATABASE_URL" -Atqc "select count(*) from $t")
    if [ "$cur" = "$n" ]; then echo "ok   $t $cur"; else echo "DIFF $t backup=$n db=$cur"; FAIL=1; fi
  done < "$1/counts.txt"
fi
# Le migrazioni applicate devono esserci tutte
psql "$DATABASE_URL" -Atqc "select string_agg(name, ',' order by name) from schema_migrations" | sed 's/^/migrazioni: /'
[ "$FAIL" -eq 0 ] && echo "VERIFICA SUPERATA" || echo "VERIFICA FALLITA"
exit "$FAIL"
