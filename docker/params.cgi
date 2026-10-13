#!/bin/sh
# the settings of the mower changed in the app with params.set (read by params.sh, which sets them again after the
# mower restarts): "enabled 0|1" and "<full name> <value>" a line. only lines of these shapes are kept
# the app on another mower may ask too (several mowers in one app)
# after a Status line, busybox httpd only reads that when it comes first
cors() { printf 'Access-Control-Allow-Origin: *\r\n'; }
F=/data/params.txt
if [ "$REQUEST_METHOD" = "POST" ]; then
  len=${CONTENT_LENGTH:-0}
  if [ "$len" -le 0 ] || [ "$len" -gt 10000 ]; then
    printf 'Status: 413 Too Large\r\n'
    cors
    printf 'Content-Type: text/plain\r\n\r\ntoo large\n'
    exit 0
  fi
  head -c "$len" | tr -d '\r' | grep -E '^(enabled [01]|/mower_logic/[a-z0-9_]{1,60} (-?[0-9]{1,6}(\.[0-9]{1,6})?|true|false))$' > "$F.tmp"
  mv "$F.tmp" "$F"
fi
cors
printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'
cat "$F" 2>/dev/null
