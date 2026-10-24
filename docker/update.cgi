#!/bin/sh
# the updater (updater.sh, a container of its own): what the app sets for it, "now", what it did, and for the updater
# whether the mower is idle in the dock (?docked: "1", else "0 <state>").
# conf lines: mowbite off|beta|stable, openmower off|check|edge|release, planner off|main, at HH:MM, days daily|1,3,5 (monday 1)
. /broker.sh
. /openmower.sh
cors() { printf 'Access-Control-Allow-Origin: *\r\n'; }
D=/data
C=$D/update.conf
conf() { v=$(sed -n "s/^$1 //p" "$C" 2>/dev/null | head -n1); echo "${v:-$2}"; }
esc() { sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g'; }

case "$REQUEST_METHOD $QUERY_STRING" in
"GET docked")
  cors
  printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'
  host=$(find_broker)
  # shellcheck disable=SC2086
  s=$([ -n "$host" ] && mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -C 1 -W 6 2>/dev/null)
  state=$(printf '%s' "$s" | sed -n 's/.*"current_state": *"\([A-Z_]*\)".*/\1/p')
  charging=$(printf '%s' "$s" | sed -n 's/.*"is_charging": *\([a-z0-9]*\).*/\1/p')
  # a full battery stops charging, the contacts' voltage still says it's in the dock
  # shellcheck disable=SC2086
  volt=$([ -n "$host" ] && mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_CHARGE_VOLTAGE" -C 1 -W 6 2>/dev/null)
  if [ "$state" = IDLE ] && { [ "$charging" = 1 ] || [ "$charging" = true ] || awk -v v="$volt" 'BEGIN {exit !(v + 0 >= 20)}'; }; then
    echo 1
  else
    echo "0 ${state:-unknown}"
  fi
  ;;
"POST conf")
  cors
  printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'
  len=${CONTENT_LENGTH:-0}
  [ "$len" -gt 0 ] && [ "$len" -le 300 ] || { echo "bad"; exit 0; }
  body=$(head -c "$len")
  m=$(printf '%s\n' "$body" | sed -En 's/^mowbite (off|beta|stable)$/\1/p' | head -n1)
  at=$(printf '%s\n' "$body" | sed -En 's/^at ([01][0-9]|2[0-3]):([0-5][0-9])$/\1:\2/p' | head -n1)
  om=$(printf '%s\n' "$body" | sed -En 's/^openmower (off|check|edge|release)$/\1/p' | head -n1)
  pl=$(printf '%s\n' "$body" | sed -En 's/^planner (off|main)$/\1/p' | head -n1)
  days=$(printf '%s\n' "$body" | sed -En 's/^days (daily|[1-7](,[1-7]){0,6})$/\1/p' | head -n1)
  printf 'mowbite %s\nopenmower %s\nplanner %s\nat %s\ndays %s\n' "${m:-$(conf mowbite off)}" "${om:-$(conf openmower off)}" \
    "${pl:-$(conf planner off)}" "${at:-$(conf at 03:00)}" "${days:-$(conf days daily)}" > "$C.tmp" &&
    mv "$C.tmp" "$C" && echo ok || echo failed
  ;;
"POST now")
  cors
  printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'
  touch "$D/update.request" && echo ok || echo failed
  ;;
*)
  cors
  printf 'Content-Type: application/json\r\nCache-Control: no-store\r\n\r\n'
  printf '{"conf":{"mowbite":"%s","openmower":"%s","planner":"%s","at":"%s","days":"%s"},"requested":%s,"status":{' \
    "$(conf mowbite off)" "$(conf openmower off)" "$(conf planner off)" "$(conf at 03:00)" "$(conf days daily)" \
    "$([ -f "$D/update.request" ] && echo true || echo false)"
  sed 's/^\([a-z_]*\) \(.*\)$/\1\t\2/' "$D/update.status" 2>/dev/null |
    awk -F'\t' '{gsub(/\\/, "\\\\", $2); gsub(/"/, "\\\"", $2); printf "%s\"%s\":\"%s\"", (NR > 1 ? "," : ""), $1, $2}'
  printf '},"log":['
  tail -n 40 "$D/update.log" 2>/dev/null | esc | awk '{printf "%s\"%s\"", (NR > 1 ? "," : ""), $0}'
  printf ']}\n'
  ;;
esac
