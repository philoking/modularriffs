#!/usr/bin/env bash
# Run this ON THE SERVER to (re)deploy after pushing changes.
set -e
cd "$(dirname "$0")"
git pull --ff-only
docker compose up -d --build
PORT="${HOST_PORT:-7000}"
echo
echo "Deployed. Serving HTTP on port ${PORT}."
echo "Point your reverse proxy at  http://<server-ip>:${PORT}  (scheme: http),"
echo "attach your domain + SSL, then open it on the studio machine."
