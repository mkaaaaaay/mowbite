#!/bin/sh
# the updater's interface for the app (MowBite's cgi-bin/update passes it on), on the stack's network only:
#   GET                 settings, status and the log as json
#   POST ?conf          lines "<key> <value>", each checked, the ones left out stay as they are
#   POST ?now[=<part>]  update all parts or one (mowbite, openmower, planner) within the next minute
#   POST ?back=mowbite  MowBite back to the version before (its newest rollback tag)
#   POST ?check         look within the next minute whether there's something new
#   POST ?room          list what can be deleted to make room
#   POST ?free=<what>   delete img:<id> (one from that list), all (the whole list) or cache (the build cache)
# it runs as root next to docker: nothing from the request gets anywhere unchecked
. /updater-lib.sh
plain() { printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n%s\n' "$1"; exit 0; }
# json string content: control characters out, backslashes and quotes escaped
jstr() { tr -d '\000-\010\013-\037' | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g'; }
request() { mkdir -p "$STATE" && echo "$1" >> "$REQ" && plain ok; }

case "$REQUEST_METHOD $QUERY_STRING" in
"POST conf")
  len=${CONTENT_LENGTH:-0}
  [ "$len" -gt 0 ] && [ "$len" -le 400 ] || plain bad
  body=$(head -c "$len")
  # each key: its pattern, the value only when it's one
  pick() { printf '%s\n' "$body" | sed -n "s/^$1 //p" | head -n1 | grep -Ex "$2"; }
  m=$(pick mowbite '(beta|stable)')
  ma=$(pick mowbite_auto '(0|1)')
  # OpenMower: only what the app offers, edge, its release or what its .env has
  om=$(pick openmower "$TAG")
  case " $(om_choices) " in *" $om "*) ;; *) om= ;; esac
  oa=$(pick openmower_auto '(0|1)')
  pa=$(pick planner_auto '(0|1)')
  at=$(pick at '([01][0-9]|2[0-3]):[0-5][0-9]')
  days=$(pick days '(daily|[1-7](,[1-7]){0,6})')
  mkdir -p "$STATE"
  {
    echo "mowbite ${m:-$(conf mowbite beta)}"
    echo "mowbite_auto ${ma:-$(conf mowbite_auto 0)}"
    echo "openmower ${om:-$(conf openmower "$(om_version)")}"
    echo "openmower_auto ${oa:-$(conf openmower_auto 0)}"
    echo "planner_auto ${pa:-$(conf planner_auto 0)}"
    echo "at ${at:-$(conf at 03:00)}"
    echo "days ${days:-$(conf days daily)}"
  } > "$CONF.$$" && mv "$CONF.$$" "$CONF" && plain ok
  plain failed
  ;;
"POST now") request all ;;
"POST now=mowbite" | "POST now=openmower" | "POST now=planner") request "${QUERY_STRING#now=}" ;;
"POST back=mowbite") request "back mowbite" ;;
"POST check") request check ;;
"POST room") request room ;;
"POST free=cache" | "POST free=all") request "free ${QUERY_STRING#free=}" ;;
"POST free=img:"*)
  id=${QUERY_STRING#free=img:}
  valid "$id" '[0-9a-f]{12}' && grep -q "^img $id " "$STATE/room" 2>/dev/null || plain bad
  request "free img $id"
  ;;
"GET "*)
  printf 'Content-Type: application/json\r\nCache-Control: no-store\r\n\r\n'
  printf '{"conf":{"mowbite":"%s","mowbite_auto":%s,"openmower":"%s","openmower_auto":%s,"planner_auto":%s,"at":"%s","days":"%s"},' \
    "$(app_channel)" "$(conf mowbite_auto 0 | grep -x '[01]' || echo 0)" "$(om_channel)" "$(conf openmower_auto 0 | grep -x '[01]' || echo 0)" \
    "$(conf planner_auto 0 | grep -x '[01]' || echo 0)" "$(conf at 03:00 | jstr)" "$(conf days daily | jstr)"
  printf '"requested":%s,"status":{' "$([ -s "$REQ" ] && echo true || echo false)"
  jstr < "$STATUS" 2> /dev/null | awk '{k = $1; sub(/^[^ ]* ?/, ""); printf "%s\"%s\":\"%s\"", (NR > 1 ? "," : ""), k, $0}'
  printf '},"room":{"items":['
  grep '^img ' "$STATE/room" 2> /dev/null | jstr | awk '$3 ~ /^[0-9]+$/ {printf "%s{\"id\":\"%s\",\"bytes\":%s,\"refs\":\"%s\",\"kind\":\"%s\"}", (n++ ? "," : ""), $2, $3, $4, $5}'
  printf '],"cache":%s},"log":[' "$(sed -n 's/^cache //p' "$STATE/room" 2> /dev/null | grep -x '[0-9][0-9]*' || echo 0)"
  tail -n 200 "$LOG" 2> /dev/null | jstr | awk '{printf "%s\"%s\"", (NR > 1 ? "," : ""), $0}'
  printf ']}\n'
  ;;
*) plain bad ;;
esac
