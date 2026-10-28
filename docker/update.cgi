#!/bin/sh
# the MowBite Updater (github.com/mkaaaaaay/mowbite-updater, on the mower's own network, port 8083): the app's questions
# passed on to it (it keeps its settings and status itself), and where the browser finds its page (?where: UPDATER_URL,
# the mower's address for mqtt, or nothing: the same host as MowBite). without the updater: {} for the status, the app
# shows how to add it
. /origin.sh
plain() { cors; printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n%s\n' "$1"; exit 0; }
# where the updater answers: UPDATER_URL, else on the mower's own network. MowBite on the mower: here with host
# networking, else the host behind this container's gateway. MowBite somewhere else: the mower it has for mqtt
updater() {
  [ -n "${UPDATER_URL:-}" ] && echo "$UPDATER_URL" && return
  case ${MOWER_MQTT_HOST:-localhost} in
  localhost | 127.* | ::1 | host.docker.internal) ;;
  *) echo "http://$MOWER_MQTT_HOST:8083" && return ;;
  esac
  gw=$(ip route 2>/dev/null | awk '/^default/ {print $3; exit}')
  for h in 127.0.0.1 $gw host.docker.internal; do
    nc -z -w 2 "$h" 8083 2>/dev/null && echo "http://$h:8083" && return
  done
  echo "http://$gw:8083"
}
# (as json, the way the updater takes changes from programs. what MowBite's other scripts take from a browser, it
# passes on too: origin.sh)
post() { wget -q -T 10 -O - --header 'Content-Type: application/json' --post-data "$2" "$(updater)/cgi-bin/updater?$1" 2>/dev/null || echo failed; }
case "$REQUEST_METHOD $QUERY_STRING" in
"GET where")
  cors
  printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'
  # (an address of this host means nothing to the browser: then nothing, it takes MowBite's host)
  case ${MOWER_MQTT_HOST:-} in
  localhost | 127.* | ::1 | host.docker.internal) echo "${UPDATER_URL:-}" ;;
  *) echo "${UPDATER_URL:-${MOWER_MQTT_HOST:+http://$MOWER_MQTT_HOST:8083}}" ;;
  esac
  ;;
"POST conf")
  len=${CONTENT_LENGTH:-0}
  [ "$len" -gt 0 ] && [ "$len" -le 4000 ] || plain bad
  plain "$(post conf "$(head -c "$len")")"
  ;;
"POST now" | "POST check" | "POST room" | "POST free=cache" | "POST free=all" | "POST self")
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
  wget -q -T 10 -O - "$(updater)/cgi-bin/updater" 2>/dev/null || echo '{}'
  ;;
esac
