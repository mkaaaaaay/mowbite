#!/bin/sh
# map backups in the /data volume, gzipped. one <id>.json.gz per backup and <id>.meta with
# name, number of areas, whether it was made automatically before a save and the how manyth one it is (the id has the
# time, the clock may go back)
# the app on another mower may ask too (several mowers in one app)
. /origin.sh
D=/data/backups
KEEP_AUTO=30
# the ones made by hand stay until deleted, so there's a most of them: a new one past that is turned down (409)
KEEP_HAND=50
mkdir -p "$D"

param() { printf '%s' "$QUERY_STRING" | tr '&' '\n' | sed -n "s/^$1=//p" | head -n1; }
json_str() { printf '%s' "$1" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g'; }

id=$(param id)
case "$id" in
  '' | *[!0-9-]*) id= ;;
esac

if [ "$REQUEST_METHOD" = "POST" ]; then
  action=$(param action)
  if [ "$action" = "delete" ]; then
    [ -n "$id" ] || fail 400 'no id'
    rm -f "$D/$id.json.gz" "$D/$id.meta"
    cors
    printf 'Content-Type: application/json\r\n\r\n{"ok":true}\n'
    exit 0
  fi
  len=${CONTENT_LENGTH:-0}
  if [ "$len" -le 0 ] || [ "$len" -gt 2000000 ]; then fail 413 'too large'; fi
  new="$(date +%s)-$$"
  # the app's 60 characters in bytes (up to 4 each), without a character cut in half at the end
  c=$(printf '\200-\277')
  name=$(httpd -d "$(param name)" | tr -d '\000-\037' | cut -c1-240 |
    sed "s/[$(printf '\300-\377')]\$//; s/[$(printf '\340-\377')][$c]\$//; s/[$(printf '\360-\377')][$c][$c]\$//")
  areas=$(param areas | tr -cd '0-9')
  auto=$(param auto | tr -cd '01')
  if [ "${auto:-0}" != 1 ] && ls "$D"/*.meta > /dev/null 2>&1 &&
    [ "$(awk 'FNR == 3 && $0 != "1" { n++ } END { print n + 0 }' "$D"/*.meta)" -ge $KEEP_HAND ]; then
    fail 409 "at most $KEEP_HAND backups made by hand"
  fi
  # written aside and checked first, a power cut leaves no half backup in the list (its rest goes with the next one)
  find "$D" -name '*.tmp' -mmin +10 -exec rm -f {} + 2>/dev/null
  head -c "$len" | gzip -9 > "$D/$new.json.gz.tmp" && gzip -t "$D/$new.json.gz.tmp" ||
    { rm -f "$D/$new.json.gz.tmp"; fail 500 'not saved'; }
  # a connection that broke off hands over less than it said
  [ "$(zcat "$D/$new.json.gz.tmp" | wc -c)" -eq "$len" ] || { rm -f "$D/$new.json.gz.tmp"; fail 400 'incomplete'; }
  # (on the disk before it's in the list: a power cut right after leaves it whole)
  sync "$D/$new.json.gz.tmp" && mv "$D/$new.json.gz.tmp" "$D/$new.json.gz" || { rm -f "$D/$new.json.gz.tmp"; fail 500 'not saved'; }
  # without its meta it wouldn't be listed nor thinned out. one at a time, each its own number
  exec 8> /tmp/backups.lock && flock 8
  n=$(awk 'FNR == 4 && $0 + 0 > n { n = $0 + 0 } END { print n + 1 }' "$D"/*.meta 2>/dev/null)
  printf '%s\n%s\n%s\n%s\n' "$name" "${areas:-0}" "${auto:-0}" "${n:-1}" > "$D/$new.meta.tmp" && sync "$D/$new.meta.tmp" &&
    mv "$D/$new.meta.tmp" "$D/$new.meta" || { rm -f "$D/$new.meta.tmp" "$D/$new.json.gz"; fail 500 'not saved'; }
  # only the automatic ones are thinned out, the ones made by hand stay: the ones made first go (one without a number
  # is from before those had one)
  awk 'FNR == 3 && $0 == "1" { a[FILENAME] = 1 } FNR == 4 { k[FILENAME] = $0 }
    END { for (f in a) { v = k[f]; gsub(/[^0-9]/, "", v); print (v == "" ? 0 : v), f } }' "$D"/*.meta 2>/dev/null | sort -k1,1nr -k2,2r | tail -n +$((KEEP_AUTO + 1)) | while read -r _ m; do
    rm -f "$m" "${m%.meta}.json.gz"
  done
  cors
  printf 'Content-Type: application/json\r\n\r\n{"id":"%s"}\n' "$new"
  exit 0
fi

if [ -n "$id" ]; then
  [ -f "$D/$id.json.gz" ] || fail 404 'not found'
  gzip -t "$D/$id.json.gz" 2> /dev/null || fail 500 'damaged'
  cors
  printf 'Content-Type: application/json\r\nCache-Control: no-store\r\n\r\n'
  zcat "$D/$id.json.gz"
  exit 0
fi

# how many are kept (automatic, by hand), for the app's texts, readable from another origin too
cors && printf 'Access-Control-Expose-Headers: X-Backups-Keep\r\n'
printf 'X-Backups-Keep: auto=%s hand=%s\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n[' $KEEP_AUTO $KEEP_HAND
first=1
for m in $(ls "$D"/*.meta 2>/dev/null | sort -r); do
  b=$(basename "$m" .meta)
  [ -f "$D/$b.json.gz" ] || continue
  [ $first = 1 ] || printf ','
  first=0
  printf '{"id":"%s","t":%s,"name":"%s","areas":%s,"auto":%s,"size":%s}' \
    "$b" "${b%%-*}" "$(json_str "$(sed -n 1p "$m")")" "$(sed -n 2p "$m" | tr -cd '0-9' | sed 's/^$/0/')" \
    "$([ "$(sed -n 3p "$m")" = 1 ] && echo true || echo false)" "$(wc -c < "$D/$b.json.gz")"
done
printf ']\n'
