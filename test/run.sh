#!/usr/bin/env bash
#
# run.sh — CLI proof that blocker.js locks down the network, and that
# requests routed through throughline still get out.
#
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

NODE=/opt/homebrew/bin/node
PORT="${PORT:-8100}"
# Secrets come from ../config.env (gitignored), never from this file.
CONFIG="$(cd "$(dirname "$0")/.." && pwd)/config.env"
[ -f "$CONFIG" ] || { echo "missing config.env - copy config.env.example and fill it in" >&2; exit 1; }
# shellcheck disable=SC1090
. "$CONFIG"
BASE="${THROUGHLINE_URL:?set THROUGHLINE_URL in config.env}"
PASSPHRASE="${PASSPHRASE:?set PASSPHRASE in config.env}"
JAR="$SCRIPT_DIR/.jar.$$"
BLOCKER_LOG="$SCRIPT_DIR/.blocker.$$.log"
BLOCKER_PID=""

FAIL=0
declare -a RESULTS

cleanup() {
  if [ -n "$BLOCKER_PID" ] && kill -0 "$BLOCKER_PID" 2>/dev/null; then
    kill "$BLOCKER_PID" 2>/dev/null
    wait "$BLOCKER_PID" 2>/dev/null
  fi
  rm -f "$JAR" "$BLOCKER_LOG"
}
trap cleanup EXIT INT TERM

start_blocker() {
  # $1 = ALLOW value (may be empty)
  if [ -n "$BLOCKER_PID" ] && kill -0 "$BLOCKER_PID" 2>/dev/null; then
    kill "$BLOCKER_PID" 2>/dev/null
    wait "$BLOCKER_PID" 2>/dev/null
  fi
  : > "$BLOCKER_LOG"
  PORT="$PORT" ALLOW="${1:-}" "$NODE" blocker.js >> "$BLOCKER_LOG" 2>&1 &
  BLOCKER_PID=$!

  # Wait for it to start listening.
  for i in $(seq 1 50); do
    if grep -q "listening on port" "$BLOCKER_LOG" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done
  echo "blocker.js did not start in time" >&2
  cat "$BLOCKER_LOG" >&2
  exit 1
}

check_blocked() {
  # $1 = url, $2 = label
  # For HTTPS targets curl issues a CONNECT tunnel; when the proxy refuses
  # the tunnel with a non-2xx status, libcurl aborts the tunnel and does
  # NOT surface the proxy's response body on stdout (this is standard
  # libcurl behavior, confirmed via --trace-ascii). So we treat either of
  # these as proof of "blocked":
  #   (a) stdout body is literally "sorry, blocked" (plain-HTTP proxying), or
  #   (b) curl fails the CONNECT tunnel with our 403 (HTTPS via CONNECT),
  #       visible in verbose stderr as "CONNECT tunnel failed, response 403".
  out=$(curl -x "http://localhost:$PORT" --proxy-insecure -sv "$1" 2>&1 1>/tmp/.rb_body.$$)
  body=$(cat /tmp/.rb_body.$$ 2>/dev/null)
  rm -f /tmp/.rb_body.$$

  if [ "$body" = "sorry, blocked" ]; then
    RESULTS+=("PASS  direct $2 = blocked (body: sorry, blocked)")
  elif echo "$out" | grep -q "CONNECT tunnel failed, response 403"; then
    RESULTS+=("PASS  direct $2 = blocked (CONNECT tunnel refused with 403)")
  else
    RESULTS+=("FAIL  direct $2 expected blocked, got body='$body'")
    FAIL=1
  fi
}

echo "== Step 1: start blocker.js in block-all mode =="
start_blocker ""

echo "== Step 2: prove direct access is blocked =="
check_blocked "https://example.com" "example.com"
check_blocked "https://en.wikipedia.org" "wikipedia.org"

echo "== Step 3: restart blocker with ALLOW=${BASE#https://} =="
start_blocker "${BASE#https://}"

echo "== Step 4: log in to throughline (through the blocker) =="
curl -s -x "http://localhost:$PORT" --proxy-insecure -c "$JAR" -d "key=$PASSPHRASE" "$BASE/login" -o /dev/null

echo "== Step 5: fetch example.com via throughline, through the blocker =="
via_body=$(curl -s -x "http://localhost:$PORT" --proxy-insecure -b "$JAR" "$BASE/raw?url=https://example.com")
if echo "$via_body" | grep -qi "Example Domain"; then
  RESULTS+=("PASS  via throughline = reachable")
else
  RESULTS+=("FAIL  via throughline expected 'Example Domain', got: $(echo "$via_body" | head -c 200)")
  FAIL=1
fi

echo
echo "===================== RESULTS ====================="
for r in "${RESULTS[@]}"; do
  echo "$r"
done
echo "====================================================="

if [ "$FAIL" -ne 0 ]; then
  echo "OVERALL: FAIL"
  exit 1
else
  echo "OVERALL: PASS"
  exit 0
fi
