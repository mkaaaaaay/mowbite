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
# ?snapshot=<unix time>&kind=params|planner: the settings kept when the run that started then left the dock (gpslog.sh),
# the last one up to a minute after it. empty when there's none
snap=$(num snapshot)
if [ -n "$snap" ]; then
  kind=$(printf '%s' "$QUERY_STRING" | tr '&' '\n' | sed -n 's/^kind=\(params\|planner\)$/\1/p')
  f=$(ls "$D"/snapshot-*-"${kind:-params}".json 2>/dev/null | awk -F- -v t="$snap" '{ s = $(NF - 1) + 0 } s <= t + 60 && s >= t - 3600 { print }' | tail -n1)
  [ -n "$f" ] && cat "$f"
  exit 0
fi
# ?cells=<cm>: all days kept, summed up per square of that size for the coverage on the map. lines:
# "<col> <row> <seconds> <without rtk fix> <without gps> <worst accuracy m> <wifi samples> <wifi dBm sum> <wifi worst>"
# (col, row: x and y divided by the size, rounded down). only while mowing or driving, not standing in the dock
cells=$(num cells)
if [ -n "$cells" ]; then
  cat "$D"/*.log | awk -v c="${cells}" '
    $2 == "IDLE" || $2 == "" || NF < 5 { next }
    {
      k = int(($3 * 100) / c - (($3 * 100) % c < 0)) " " int(($4 * 100) / c - (($4 * 100) % c < 0))
      n[k]++
      if ($5 >= 999) none[k]++
      else if ($5 > 0.05) nofix[k]++
      if ($5 < 999 && $5 > worst[k]) worst[k] = $5
      if (NF >= 6 && $6 != "-") { wn[k]++; ws[k] += $6; if (!(k in wmin) || $6 < wmin[k]) wmin[k] = $6 }
    }
    END { for (k in n) print k, n[k], nofix[k] + none[k], none[k] + 0, worst[k] + 0, wn[k] + 0, ws[k] + 0, (k in wmin) ? wmin[k] : 0 }'
  exit 0
fi
from=$(num from)
to=$(num to)
from=${from:-0}
to=${to:-0}
[ $((to - from)) -gt 86400 ] && to=$((from + 86400))
for d in $(awk -v a="$from" -v b="$to" 'BEGIN { print strftime("%Y%m%d", a); if (strftime("%Y%m%d", b) != strftime("%Y%m%d", a)) print strftime("%Y%m%d", b) }'); do
  [ -f "$D/$d.log" ] && awk -v a="$from" -v b="$to" '$1 >= a && $1 <= b' "$D/$d.log"
done
