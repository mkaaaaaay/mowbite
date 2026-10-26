#!/bin/sh
# the MowBite Updater (github.com/mkaaaaaay/mowbite-updater, on the mower's own network, port 8083): the app's questions
# passed on to it (it keeps its settings and status itself), and whether the mower is idle in the dock (?docked: "1",
# else "0 <state>"). without the updater: {} for the status, the app shows how to add it
. /broker.sh
. /openmower.sh
cors() { printf 'Access-Control-Allow-Origin: *\r\n'; }
plain() { cors; printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n%s\n' "$1"; exit 0; }
# (it runs on the mower's own network: on the mower, the gateway of this container. MowBite somewhere else: the mower's
# address it has for mqtt, or UPDATER_URL)
U=${UPDATER_URL:-http://${MOWER_MQTT_HOST:-$(ip route 2>/dev/null | awk '/^default/ {print $3; exit}')}:8083}/cgi-bin/updater
# (as json: the updater takes changes only from programs and its own page)
post() { wget -q -T 10 -O - --header 'Content-Type: application/json' --post-data "$2" "$U?$1" 2>/dev/null || echo failed; }
# a change only from MowBite itself: its own page (also on another docker), the app on a phone, a program without a
# browser, and the addresses in MOWBITE_ORIGINS (its files on a web server of their own, a proxy). not from any page a
# browser in the network has open
from_mowbite() {
  case ${HTTP_ORIGIN:-} in
  "" | "http://$HTTP_HOST" | "https://$HTTP_HOST" | http://localhost | http://localhost:* | https://localhost | capacitor://localhost) return 0 ;;
  esac
  for o in $(echo "${MOWBITE_ORIGINS:-}" | tr ',' ' '); do [ "$HTTP_ORIGIN" = "${o%/}" ] && return 0; done
  return 1
}

[ "$REQUEST_METHOD" = POST ] && ! from_mowbite && plain denied
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
  [ "$len" -gt 0 ] && [ "$len" -le 4000 ] || plain bad
  plain "$(post conf "$(head -c "$len")")"
  ;;
"POST now" | "POST check" | "POST room" | "POST free=cache" | "POST free=all")
  plain "$(post "$QUERY_STRING" "")"
  ;;
"POST now="* | "POST back="*)
  printf '%s' "${QUERY_STRING#*=}" | grep -Eqx '[a-z][a-z0-9_]{0,40}' || plain bad
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
