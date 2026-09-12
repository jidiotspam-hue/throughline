#!/bin/bash
# Brings the whole YouTube backend up, in order: the container engine, the
# Invidious stack, then the tunnel that exposes it. Run by the LaunchAgent at
# login and kept alive by it, so a reboot or a crash comes back on its own.

set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
LOG="$DIR/start.log"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }

# Serving video from a laptop means the laptop must not sleep. caffeinate is
# tied to this process's lifetime (-w) so it never outlives the backend.
caffeinate -dimsu -w $$ &

log "starting colima"
colima start --cpu 2 --memory 4 >> "$LOG" 2>&1 || log "colima start returned $? (fine if already running)"

log "starting invidious stack"
cd "$DIR" && docker compose up -d >> "$LOG" 2>&1 || log "docker compose up failed ($?)"

# Wait for Invidious to actually answer before opening the tunnel, so the first
# registered URL is one that works.
for i in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 3 http://localhost:3000/; then
    log "invidious is answering on :3000"
    break
  fi
  sleep 3
done

log "handing off to tunnel.sh"
exec "$DIR/tunnel.sh"
