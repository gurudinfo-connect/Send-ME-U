#!/bin/sh
# Usage: DATABASE_URL=postgresql://... sh scripts/restore.sh backup.dump
# Restores into an EXISTING, preferably empty, database. Use a scratch database first to verify a backup.
set -eu
: "${DATABASE_URL:?set DATABASE_URL}"; DUMP="${1:?usage: restore.sh backup.dump}"
URL=$(printf '%s' "$DATABASE_URL" | sed 's/?schema=[^&]*//')
pg_restore --no-owner --clean --if-exists --dbname "$URL" "$DUMP"
echo "restored $DUMP"
