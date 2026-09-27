#!/bin/sh
# app settings shared by every device, kept in the /data volume
# the phone app reads and writes them too
printf 'Access-Control-Allow-Origin: *\r\n'
F=/data/settings.json

if [ "$REQUEST_METHOD" = "POST" ]; then
  len=${CONTENT_LENGTH:-0}
  if [ "$len" -le 0 ] || [ "$len" -gt 65536 ]; then
    printf 'Status: 413 Too Large\r\nContent-Type: text/plain\r\n\r\ntoo large\n'
    exit 0
  fi
  head -c "$len" > "$F.tmp" && mv "$F.tmp" "$F"
fi

printf 'Content-Type: application/json\r\nCache-Control: no-store\r\n\r\n'
cat "$F" 2>/dev/null || printf '{}'
