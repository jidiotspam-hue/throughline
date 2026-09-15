#!/bin/bash
# Renders the LaunchAgent plists for whatever account is running them
# (they need absolute paths, so the committed copies carry __HOME__) and
# loads them. Safe to re-run.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/LaunchAgents"
mkdir -p "$DEST"
for label in com.throughline.backend com.throughline.maintain; do
  sed "s|__HOME__|$HOME|g" "$DIR/$label.plist" > "$DEST/$label.plist"
  plutil -lint "$DEST/$label.plist" >/dev/null
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$DEST/$label.plist"
  echo "loaded $label"
done
