#!/usr/bin/env bash
# Backup the MySQL service of a RUNNING Compose deployment without printing credentials.
# Exports sensitive business records; retain backups encrypted with restricted access.
set -euo pipefail
umask 077
if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker CLI required; backup not started.' >&2
  exit 2
fi
outdir="${1:-./backups}"
mkdir -p -- "$outdir"
chmod 700 -- "$outdir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="${outdir%/}/girder-${stamp}.sql.gz"
tmp="${output}.partial"
trap 'rm -f -- "$tmp"' EXIT
# MYSQL_ROOT_PASSWORD is read from inside the container environment, never argv or .env echo.
docker compose exec -T mysql sh -ec \
  'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump -uroot --single-transaction --quick --triggers --routines --set-gtid-purged=OFF girder' \
  | gzip -c > "$tmp"
gzip -t "$tmp"
mv -n -- "$tmp" "$output"
trap - EXIT
printf 'Backup created: %s\n' "$output"
echo 'Store it encrypted offsite and periodically test restoration to an isolated MySQL instance.'
