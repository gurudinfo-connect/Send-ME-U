#!/bin/sh
# Usage: DATABASE_URL=postgresql://... sh scripts/backup.sh [outfile]
# Writes a compressed custom-format dump (restore with scripts/restore.sh). Uploaded media is NOT in the dump:
# back up the uploads volume or the S3 bucket separately (versioning on the bucket is recommended).
set -eu
: "${DATABASE_URL:?set DATABASE_URL}"
OUT="${1:-backup-$(date +%Y%m%d-%H%M%S).dump}"
URL=$(printf '%s' "$DATABASE_URL" | sed 's/?schema=[^&]*//')
pg_dump --format=custom --no-owner --file "$OUT" "$URL"
echo "wrote $OUT"
