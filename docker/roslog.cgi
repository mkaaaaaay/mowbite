#!/bin/sh
# ros warnings and errors around a moment, from the files the mowbite-roslog helper on the mower
# writes (host/mowbite-roslog.sh, mounted read only to /ros-log). without ?t: whether it's set up
printf 'Access-Control-Allow-Origin: *\r\n'
D=/ros-log

param() { printf '%s' "$QUERY_STRING" | tr '&' '\n' | sed -n "s/^$1=//p" | head -n1 | tr -cd '0-9'; }
# the helper already blanks these, this is the second net
redact() {
  sed -E 's#([a-zA-Z][a-zA-Z0-9+.-]*://)[^/@ ]+@#\1***@#g; s#((pass(word)?|passwd|pwd|user(name)?|login|token|secret|api[_-]?key|auth[a-z]*|credentials?)[^:=]{0,20}[:=][[:space:]]*)[^[:space:],;]+#\1***#gI'
}

if [ ! -e "$D/alive" ]; then
  printf 'Status: 404 Not Found\r\nContent-Type: application/json\r\n\r\n{"available":false}\n'
  exit 0
fi

t=$(param t)
if [ -z "$t" ]; then
  printf 'Content-Type: application/json\r\n\r\n{"available":true,"alive":%s}\n' "$(stat -c %Y "$D/alive")"
  exit 0
fi

before=$(param before)
after=$(param after)
from=$((t - ${before:-120}))
to=$((t + ${after:-60}))
printf 'Content-Type: text/plain; charset=utf-8\r\n\r\n'
# only lines that look like what the helper writes, at most 200 around the moment
cat "$D"/*.log 2>/dev/null |
  grep -E '^\[(WARN|ERROR|FATAL)\] \[[0-9.]+\]: ' |
  awk -v from="$from" -v to="$to" '{ s = $2; gsub(/[^0-9.]/, "", s); if (s + 0 >= from && s + 0 <= to) print }' |
  tail -n 200 |
  redact
