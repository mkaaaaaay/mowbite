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
# ?snapshot=<unix time>&kind=params|planner|map: what gpslog.sh kept as the run that started then left the dock. params
# and planner: the last one up to a minute after it and at most an hour before. map: the newest up to a minute after
# it, kept only when the map changed. empty when there's none
# ?plans&from=<unix time>&to=<unix time>: the area plans kept then, "<time> <area id>" a line
# ?plan=<time>-<area id>: one of them
S=$D/snap
snap=$(num snapshot)
if [ -n "$snap" ]; then
  kind=$(printf '%s' "$QUERY_STRING" | tr '&' '\n' | sed -n 's/^kind=\(params\|planner\|map\)$/\1/p')
  if [ "$kind" = map ]; then
    f=$(ls "$S"/map-*-x.json.gz 2>/dev/null | awk -F- -v t="$snap" '{ s = $(NF - 1) + 0 } s <= t + 60 { print }' | tail -n1)
    [ -n "$f" ] && gzip -dc "$f"
  else
    f=$(ls "$S"/snapshot-*-"${kind:-params}".json 2>/dev/null | awk -F- -v t="$snap" '{ s = $(NF - 1) + 0 } s <= t + 60 && s >= t - 3600 { print }' | tail -n1)
    [ -n "$f" ] && cat "$f"
  fi
  exit 0
fi
case "$QUERY_STRING" in
  plans*)
    from=$(num from)
    to=$(num to)
    ls "$S"/plan-*.json.gz 2>/dev/null | sed 's|.*/plan-\([0-9]*\)-\(.*\)\.json\.gz$|\1 \2|' | awk -v a="${from:-0}" -v b="${to:-0}" '$1 >= a && $1 <= b'
    exit 0
    ;;
  plan=*)
    p=$(printf '%s' "$QUERY_STRING" | sed -n 's/^plan=\([0-9]*-[A-Za-z0-9_-]*\)$/\1/p')
    [ -n "$p" ] && [ -f "$S/plan-$p.json.gz" ] && gzip -dc "$S/plan-$p.json.gz"
    exit 0
    ;;
esac
# ?cells=<cm>: all days kept, summed up per square of that size for the coverage on the map. lines:
# "<col> <row> <seconds> <over 5 cm or without gps> <without gps> <worst accuracy m> <wifi samples> <wifi dBm sum>
# <wifi worst>" (col, row: x and y divided by the size, rounded down). only while mowing or driving, not standing in the
# dock, and not the dock approach without gps (OpenMower switches it off there)
cellsum() {
  awk -v c="$1" '
    $2 == "IDLE" || $2 == "" || NF < 5 { next }
    ($2 == "DOCKING" || $2 == "UNDOCKING") && $5 >= 999 { next }
    {
      k = int(($3 * 100) / c - (($3 * 100) % c < 0)) " " int(($4 * 100) / c - (($4 * 100) % c < 0))
      n[k]++
      if ($5 >= 999) none[k]++
      else if ($5 > 0.05) over[k]++
      if ($5 < 999 && $5 > worst[k]) worst[k] = $5
      if (NF >= 6 && $6 != "-") { wn[k]++; ws[k] += $6; if (!(k in wmin) || $6 < wmin[k]) wmin[k] = $6 }
    }
    END { for (k in n) print k, n[k], over[k] + none[k], none[k] + 0, worst[k] + 0, wn[k] + 0, ws[k] + 0, (k in wmin) ? wmin[k] : 0 }'
}
cells=$(num cells)
if [ -n "$cells" ]; then
  # a finished day is summed up once and kept in cells/ as long as its log (a day takes the mower seconds), only the
  # newest one each time
  C=$D/cells
  mkdir -p "$C"
  newest=$(ls -1 "$D"/*.log | tail -n1)
  for f in "$D"/*.log; do
    [ "$f" = "$newest" ] && continue
    c="$C/$(basename "$f" .log)-$cells"
    [ -s "$c" ] && [ ! "$f" -nt "$c" ] && continue
    cellsum "$cells" < "$f" > "$c.$$" && mv "$c.$$" "$c"
  done
  for c in "$C"/*; do
    [ -f "$c" ] || continue
    n=${c##*/}
    case "$n" in *-"$cells") [ -f "$D/${n%-*}.log" ] || rm -f "$c" ;; *) rm -f "$c" ;; esac
  done
  { cat "$C"/*-"$cells" 2>/dev/null; cellsum "$cells" < "$newest"; } | awk '
    {
      k = $1 " " $2; n[k] += $3; over[k] += $4; none[k] += $5; wn[k] += $7; ws[k] += $8
      if ($6 > worst[k]) worst[k] = $6
      if ($7 > 0 && (!(k in wmin) || $9 < wmin[k])) wmin[k] = $9
    }
    END { for (k in n) print k, n[k], over[k], none[k], worst[k] + 0, wn[k], ws[k], (k in wmin) ? wmin[k] : 0 }'
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
