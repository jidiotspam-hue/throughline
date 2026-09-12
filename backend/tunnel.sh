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

# throughline only accepts a hostname once it can reach it from Cloudflare's
# side — the same path /b/ uses — and answers 503 until then. cloudflared
# announces the hostname a few seconds before the tunnel is really up, so the
# first attempts are expected to be refused; keep trying. (Probing from here
# instead would be meaningless: this network doesn't even resolve
# trycloudflare.com, but Cloudflare does.)
register() {
  local url="$1" code i
  for i in $(seq 1 45); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
      -X PUT "$THROUGHLINE/yt/backend" -H "x-update-key: $KEY" --data "$url")
    if [ "$code" = "200" ]; then
      log "registered $url (throughline confirmed it is live)"
      echo "$url" > "$DIR/current-url"
      return 0
    fi
    log "throughline: $url not live yet (HTTP $code), retrying"
    sleep 2
  done
  log "gave up registering $url"
  return 1
}

# cloudflared prints the hostname before its edge connection is actually up
# (quick tunnels run a single one: "ha-connections:1"). Hold registration
# until it logs "Registered tunnel connection" (or 30s have passed, as a
# backstop). Even then Cloudflare takes a moment to propagate the tunnel
# across its PoPs, which is why throughline probes several times before
# accepting and register() retries — that is the real readiness gate; this
# just avoids hammering it with attempts that cannot yet succeed.
#
# No `read -t` here on purpose: macOS ships bash 3.2, where a read timeout
# returns 1 — indistinguishable from EOF — and treating it as EOF once closed
# the pipe under cloudflared and killed it with SIGPIPE. Instead the producer
# emits a __TICK__ line every 5s for as long as cloudflared lives, which gives
# the reader a heartbeat for its fallback timer; a real EOF only arrives when
# cloudflared has actually exited.
while true; do
  log "starting cloudflared quick tunnel -> $LOCAL"
  (
    "$DIR/bin/cloudflared" tunnel --url "$LOCAL" --no-autoupdate 2>&1 &
    cfpid=$!
    trap 'kill "$cfpid" 2>/dev/null' EXIT
    while kill -0 "$cfpid" 2>/dev/null; do sleep 5; echo "__TICK__"; done
    wait "$cfpid" 2>/dev/null
  ) | {
    url=""; conns=0; registered=""; seen_at=0
    while IFS= read -r line; do
      if [ "$line" != "__TICK__" ]; then
        printf '%s\n' "$line" >> "$LOG"
        if [ -z "$url" ] && [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
          url="${BASH_REMATCH[1]}"; seen_at=$(date +%s)
          log "tunnel hostname: $url (waiting for edge connections)"
        fi
        case "$line" in *"Registered tunnel connection"*) conns=$((conns + 1));; esac
      fi
      if [ -n "$url" ] && [ -z "$registered" ]; then
        if [ "$conns" -ge 1 ] || [ $(( $(date +%s) - seen_at )) -ge 30 ]; then
          registered=1
          log "$conns edge connection(s) up; registering"
          register "$url"
        fi
      fi
    done
  }
  log "cloudflared exited; restarting in 5s"
  sleep 5
done
