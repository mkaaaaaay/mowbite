#!/bin/sh
# the updater (a container of its own next to the app, docker/updater.sh): passes the app's questions on to it, on the
# stack's network (it keeps its settings and status itself), and tells it whether the mower is idle in the dock
# (?docked: "1", else "0 <state>"). without the updater: {} for the status, the app shows how to add it
. /broker.sh
. /openmower.sh
cors() { printf 'Access-Control-Allow-Origin: *\r\n'; }
plain() { cors; printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n%s\n' "$1"; exit 0; }
U=${UPDATER_URL:-http://mowbite-updater:8081}/cgi-bin/updater
post() { wget -q -T 10 -O - --post-data "$2" "$U?$1" 2>/dev/null || echo failed; }

case "$REQUEST_METHOD $QUERY_STRING" in
"GET docked")
  cors
  printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'
  host=$(find_broker)
  # only what OpenMower says now (-R: nothing kept by the broker from before a restart)
  # shellcheck disable=SC2086
  s=$([ -n "$host" ] && mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -R -C 1 -W 6 2>/dev/null)
  state=$(printf '%s' "$s" | sed -n 's/.*"current_state": *"\([A-Z_]*\)".*/\1/p')
  charging=$(printf '%s' "$s" | sed -n 's/.*"is_charging": *\([a-z0-9]*\).*/\1/p')
  # a full battery stops charging, the contacts' voltage still says it's in the dock
  # shellcheck disable=SC2086
  volt=$([ -n "$host" ] && [ "$state" = IDLE ] && mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_CHARGE_VOLTAGE" -R -C 1 -W 6 2>/dev/null)
  if [ "$state" = IDLE ] && { [ "$charging" = 1 ] || [ "$charging" = true ] || awk -v v="$volt" 'BEGIN {exit !(v + 0 >= 20)}'; }; then
    echo 1
  else
    echo "0 ${state:-unknown}"
  fi
  ;;
"POST conf")
  len=${CONTENT_LENGTH:-0}
  [ "$len" -gt 0 ] && [ "$len" -le 400 ] || plain bad
  plain "$(post conf "$(head -c "$len")")"
  ;;
"POST now" | "POST now=mowbite" | "POST now=openmower" | "POST now=planner" | "POST back=mowbite" | "POST check" | "POST room" | "POST free=cache" | "POST free=all")
  plain "$(post "$QUERY_STRING" "")"
  ;;
"POST free=img:"*)
  printf '%s' "${QUERY_STRING#free=img:}" | grep -Eqx '[0-9a-f]{12}' || plain bad
  plain "$(post "$QUERY_STRING" "")"
  ;;
*)
  cors
  printf 'Content-Type: application/json\r\nCache-Control: no-store\r\n\r\n'
  wget -q -T 10 -O - "$U" 2>/dev/null || echo '{}'
  ;;
esac
