#!/bin/sh
# the settings of the mower changed in the app with params.set (read by params.sh, which sets them again after the
# mower restarts): "enabled 0|1" and "<full name> <value>" a line. only lines of these shapes are kept
# the app on another mower may ask too (several mowers in one app)
# after a Status line, busybox httpd only reads that when it comes first
. /origin.sh
fail() { printf 'Status: %s\r\n' "$1"; cors; printf 'Content-Type: text/plain\r\n\r\n%s\n' "$2"; exit 0; }
F=/data/params.txt
if [ "$REQUEST_METHOD" = "POST" ]; then
  len=${CONTENT_LENGTH:-0}
  if [ "$len" -le 0 ] || [ "$len" -gt 10000 ]; then fail 413 'too large'; fi
  # a file of its own: two saves at once mustn't write into the same one
  T="$F.$$"
  # a connection that broke off hands over less than it said
  head -c "$len" > "$T" && [ "$(wc -c < "$T")" -eq "$len" ] || { rm -f "$T"; fail 400 'incomplete'; }
  # (cat notices a full disk, grep doesn't)
  tr -d '\r' < "$T" | grep -E '^(enabled [01]|/mower_logic/[a-z0-9_]{1,60} (-?[0-9]{1,6}(\.[0-9]{1,6})?|true|false))$' | cat > "$T.ok" && mv "$T.ok" "$F" ||
    { rm -f "$T" "$T.ok"; fail 500 'not saved'; }
  rm -f "$T"
fi
cors
printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'
cat "$F" 2>/dev/null
