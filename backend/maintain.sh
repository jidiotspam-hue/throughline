#!/bin/bash
# Invidious's own docs say it "must be restarted often, at least once a day,
# ideally every hour", and the companion needs fresh images every few days
# because YouTube keeps changing. This runs from a LaunchAgent every 6 hours:
# it always restarts Invidious, and once a day pulls new images and recreates
# whatever changed.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
LOG="$DIR/maintain.log"
STAMP="$DIR/.last-pull"

log() { printf '%s %s\n' "$(date '+%F %T') $*" >> "$LOG"; }
cd "$DIR" || exit 1

now=$(date +%s)
last=$(cat "$STAMP" 2>/dev/null || echo 0)
if [ $((now - last)) -ge 86400 ]; then
  log "daily: pulling images"
  if docker compose pull >> "$LOG" 2>&1; then
    docker compose up -d >> "$LOG" 2>&1
    docker image prune -f >> "$LOG" 2>&1
    echo "$now" > "$STAMP"
    log "daily: images refreshed"
  else
    log "daily: pull failed, keeping current images"
  fi
else
  log "6h: restarting invidious"
  docker compose restart invidious >> "$LOG" 2>&1
fi
