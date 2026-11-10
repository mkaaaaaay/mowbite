#!/bin/sh
# the MowBite Planner's lines logkeeper.sh kept: ?from=<unix time>&to=<unix time>, at most a day at a time
# 404 when nothing is kept (no planner, or an older container)
. /origin.sh
D=/data/plannerlog
if [ ! -f "$D/.last" ]; then
  printf 'Status: 404 Not Found\r\n'
  cors
  printf 'Content-Type: text/plain\r\n\r\n'
  exit 0
fi
num() { printf '%s' "$QUERY_STRING" | tr '&' '\n' | sed -n "s/^$1=\([0-9]*\)$/\1/p" | head -n1; }
from=$(num from)
to=$(num to)
from=${from:-0}
to=${to:-0}
[ $((to - from)) -gt 86400 ] && to=$((from + 86400))
cors
printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'
for d in $(awk -v a="$from" -v b="$to" 'BEGIN { print strftime("%Y%m%d", a); if (strftime("%Y%m%d", b) != strftime("%Y%m%d", a)) print strftime("%Y%m%d", b) }'); do
  [ -f "$D/$d.log" ] && awk -v a="$from" -v b="$to" '$1 >= a && $1 <= b' "$D/$d.log"
done
