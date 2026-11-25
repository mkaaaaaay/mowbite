#!/bin/sh
# what stats.sh counted, for the activity page:
#   since <time counting started>
#   total <blade s> <m with blade> <m without> <runs>
#   hour <start> <blade s> <m with blade> <m without> <runs>   a line per hour with something in it, the one going on last
#   maint <part> <due after blade h> <blade s when last done> <time last done, 0: not yet>
# POST ?done=<part>: seen to now. POST ?due=<part>&h=<hours>: how many blade hours until it's due again
# the app on another mower may ask too, after a Status line: busybox httpd only reads that when it comes first
. /origin.sh
D=/data/stats
M=$D/maint
arg() { printf '%s' "$QUERY_STRING" | tr '&' '\n' | sed -n "s/^$1=\([a-z0-9]*\)$/\1/p" | head -n1; }
# put <file>: the lines on stdin as the file, the old one stays when the new one can't be written whole
put() { cat > "$1.$$" && mv "$1.$$" "$1" || { rm -f "$1.$$"; return 1; }; }

if [ "$REQUEST_METHOD" = POST ]; then
  # one at a time with notify.awk marking a part told, held until the cgi ends
  exec 9> /tmp/stats.lock && flock 9
  part=$(arg 'done')
  [ -n "$part" ] || part=$(arg due)
  if ! grep -q "^$part " "$M" 2>/dev/null; then
    printf 'Status: 400 Bad Request\r\n'
    cors
    printf 'Content-Type: text/plain\r\n\r\nunknown part\n'
    exit 0
  fi
  if [ -n "$(arg 'done')" ]; then
    blade=$(cut -d' ' -f2 "$D/state" 2>/dev/null)
    awk -v p="$part" -v b="${blade:-0}" -v t="$(date +%s)" '$1 == p { $3 = b; $4 = t } { print }' "$M" | put "$M"
  else
    h=$(arg h)
    case "$h" in '' | *[!0-9]*) h=0 ;; esac
    if [ "$h" -lt 1 ] || [ "$h" -gt 5000 ]; then
      printf 'Status: 400 Bad Request\r\n'
      cors
      printf 'Content-Type: text/plain\r\n\r\nhours out of range\n'
      exit 0
    fi
    awk -v p="$part" -v h="$h" '$1 == p { $2 = h } { print }' "$M" | put "$M"
    # told again once due by the new hours (notify.awk)
    [ -f "$D/reminded" ] && { awk -v p="$part" '$1 != p' "$D/reminded" | put "$D/reminded"; }
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
