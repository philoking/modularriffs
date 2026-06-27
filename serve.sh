#!/usr/bin/env bash
# Serve Modular Riffs on localhost so Chrome/Edge will grant Web MIDI access.
# (Web MIDI needs a "secure context"; http://localhost counts, file:// does not.)
set -e
PORT="${1:-8765}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="http://localhost:${PORT}/"

echo "Modular Riffs → ${URL}"
echo "Open it in Chrome or Edge. Ctrl-C to stop."

# Try to open the browser automatically (macOS `open`, Linux `xdg-open`).
( sleep 1; command -v open >/dev/null && open "$URL" || (command -v xdg-open >/dev/null && xdg-open "$URL") ) >/dev/null 2>&1 &

cd "$DIR"
exec python3 -m http.server "$PORT"
