#!/bin/sh
set -eu

backup_once() {
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="/backups/penny-${timestamp}.dump"
  pg_dump --format=custom --file="$target"
  find /backups -type f -name 'penny-*.dump' -mtime "+${BACKUP_RETENTION_DAYS:-14}" -delete
  echo "Created PostgreSQL backup: $target"
}

while true; do
  backup_once
  sleep 86400
done
