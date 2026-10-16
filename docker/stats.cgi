#!/bin/sh
# what stats.sh counted, for the activity page:
#   since <time counting started>
#   total <blade s> <m with blade> <m without> <runs>
#   hour <start> <blade s> <m with blade> <m without> <runs>   a line per hour with something in it, the one going on last
#   maint <part> <due after blade h> <blade s when last done> <time last done, 0: not yet>
# POST ?done=<part>: seen to now. POST ?due=<part>&h=<hours>: how many blade hours until it's due again
# the app on another mower may ask too, after a Status line: busybox httpd only reads that when it comes first
cors() { printf 'Access-Control-Allow-Origin: *\r\n'; }
D=/data/stats
M=$D/maint
arg() { printf '%s' "$QUERY_STRING" | tr '&' '\n' | sed -n "s/^$1=\([a-z0-9]*\)$/\1/p" | head -n1; }

if [ "$REQUEST_METHOD" = POST ]; then
  part=$(arg done)
  [ -n "$part" ] || part=$(arg due)
  if ! grep -q "^$part " "$M" 2>/dev/null; then
    printf 'Status: 400 Bad Request\r\n'
    cors
    printf 'Content-Type: text/plain\r\n\r\nunknown part\n'
    exit 0
  fi
  if [ -n "$(arg done)" ]; then
    blade=$(cut -d' ' -f2 "$D/state" 2>/dev/null)
    awk -v p="$part" -v b="${blade:-0}" -v t="$(date +%s)" '$1 == p { $3 = b; $4 = t } { print }' "$M" > "$M.tmp" && mv "$M.tmp" "$M"
  else
    h=$(arg h)
    case "$h" in '' | *[!0-9]*) h=0 ;; esac
    if [ "$h" -lt 1 ] || [ "$h" -gt 5000 ]; then
      printf 'Status: 400 Bad Request\r\n'
      cors
      printf 'Content-Type: text/plain\r\n\r\nhours out of range\n'
      exit 0
    fi
    awk -v p="$part" -v h="$h" '$1 == p { $2 = h } { print }' "$M" > "$M.tmp" && mv "$M.tmp" "$M"
  fi
fi

cors
printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'
if [ -f "$D/state" ]; then
  awk '{ print "since", $1; print "total", $2, $3, $4, $5 }' "$D/state"
  [ -f "$D/hours" ] && sed 's/^/hour /' "$D/hours"
  awk '$7 > 0 || $8 > 0 || $9 > 0 || $10 > 0 { print "hour", $6, $7, $8, $9, $10 }' "$D/state"
fi
sed 's/^/maint /' "$M" 2>/dev/null
exit 0
