#!/bin/sh
# the positions and gps accuracy gpslog.sh kept: ?from=<unix time>&to=<unix time>, at most a day at a time.
# ?oldest: the time of the first line kept. 404 when nothing is kept (older container)
cors() { printf 'Access-Control-Allow-Origin: *\r\n'; }
D=/data/gpslog
f=$(ls "$D"/*.log 2>/dev/null | head -n1)
if [ -z "$f" ]; then
  printf 'Status: 404 Not Found\r\n'
  cors
  printf 'Content-Type: text/plain\r\n\r\n'
  exit 0
fi
cors
printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'
if [ "$QUERY_STRING" = oldest ]; then
  head -n1 "$f" | cut -d' ' -f1 | cut -d. -f1
  exit 0
fi
num() { printf '%s' "$QUERY_STRING" | tr '&' '\n' | sed -n "s/^$1=\([0-9]*\)$/\1/p" | head -n1; }
from=$(num from)
to=$(num to)
from=${from:-0}
to=${to:-0}
[ $((to - from)) -gt 86400 ] && to=$((from + 86400))
for d in $(awk -v a="$from" -v b="$to" 'BEGIN { print strftime("%Y%m%d", a); if (strftime("%Y%m%d", b) != strftime("%Y%m%d", a)) print strftime("%Y%m%d", b) }'); do
  [ -f "$D/$d.log" ] && awk -v a="$from" -v b="$to" '$1 >= a && $1 <= b' "$D/$d.log"
done
