#!/bin/bash
# Keeps a Cloudflare quick tunnel open to the local Invidious and tells
# throughline where it is.
#
# A quick tunnel is anonymous (no Cloudflare login) but gets a fresh random
# *.trycloudflare.com hostname every time it starts. So instead of anyone
# remembering that hostname, this watches cloudflared's output for it and PUTs
# it to throughline's /yt/backend; the Chromebook only ever opens /yt. If
# cloudflared dies it is restarted and the new hostname re-registered.

set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
KEY="$(tr -d '[:space:]' < "$DIR/.update_key")"
THROUGHLINE="https://<your-worker>.workers.dev"
LOCAL="http://localhost:3000"
LOG="$DIR/tunnel.log"

: > "$LOG"   # fresh log each run

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }

register() {
  local url="$1" code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
    -X PUT "$THROUGHLINE/yt/backend" -H "x-update-key: $KEY" --data "$url")
  log "registered $url -> throughline said $code"
  echo "$url" > "$DIR/current-url"
}

# cloudflared prints the hostname a few seconds before its edge connections
# are actually up; in that window the hostname answers 530. Registering it
# then would point /yt at a dead host, so hold until it really answers.
wait_live() {
  local url="$1" code i
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$url/")
    case "$code" in 2*|3*) log "$url is live (HTTP $code)"; return 0;; esac
    sleep 2
  done
  log "$url never answered (last HTTP $code); registering anyway"
  return 1
}

while true; do
  log "starting cloudflared quick tunnel -> $LOCAL"
  "$DIR/bin/cloudflared" tunnel --url "$LOCAL" --no-autoupdate 2>&1 | while IFS= read -r line; do
    printf '%s\n' "$line" >> "$LOG"
    # cloudflared prints the assigned hostname inside a boxed banner; pull the
    # bare URL out of whichever line carries it.
    if [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
      url="${BASH_REMATCH[1]}"
      wait_live "$url"
      register "$url"
    fi
  done
  log "cloudflared exited; restarting in 5s"
  sleep 5
done
