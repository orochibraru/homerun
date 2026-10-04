#!/bin/sh
host="${HOST:-0.0.0.0}"
case "$host" in
0.0.0.0 | :: | "") host=127.0.0.1 ;;
esac
exec wget -q -O /dev/null -T 5 "http://${host}:${PORT:-3000}${HEALTHCHECK_PATH:-/api/health}"
