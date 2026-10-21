#!/bin/sh
# push messages when the mower needs someone, what and when notify.awk decides. they go to the ntfy server and topic
# set on the settings page and to the phones signed up in MowBite's app (notify.cgi writes /data/notify.conf), nothing
# happens without either or while they're switched off.
# what was sent goes to /data/notify.log for the page
. /broker.sh
. /openmower.sh
C=/data/notify.conf
LOG=/data/notify.log
conf() { sed -n "s/^$1 //p" "$C" 2>/dev/null | head -n1; }

log() {
  echo "$(date +%s) $1" >> "$LOG"
  tail -n 50 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
}
title() { printf '%s' "$1" | sed -n 's/.*"title":"\([^"]*\)".*/\1/p'; }

# $1: the message as json for the topic, ntfy takes it at the server's root
send_ntfy() {
  server=$(conf server)
  token=$(conf token)
  if [ -n "$token" ]; then
    wget -q -T 15 -O /dev/null --header "Authorization: Bearer $token" --header 'Content-Type: application/json' \
      --post-data "$1" "${server:-https://ntfy.sh}" 2>/dev/null
  else
    wget -q -T 15 -O /dev/null --header 'Content-Type: application/json' --post-data "$1" "${server:-https://ntfy.sh}" 2>/dev/null
  fi
  r=$?
  log "$([ $r = 0 ] && echo sent || echo failed) $(title "$1")"
  return $r
}

# $1: the message as json for MowBite's app, to every phone signed up (push lines, or only $2). the address is the
# distributor's (UnifiedPush), it takes the body as it is. one it gave up (404, 410: the app or its sign up gone) is
# dropped
send_push() {
  r=1
  # (the addresses hold a ?, not a file pattern)
  set -f
  for ep in ${2:-$(sed -n 's/^push //p' "$C")}; do
    if err=$(wget -q -T 15 -O /dev/null --header 'Content-Type: application/json' --post-data "$1" "$ep" 2>&1); then
      r=0
    else
      case "$err" in
      *" 404"* | *" 410"*) grep -vxF "push $ep" "$C" > "$C.tmp" && mv "$C.tmp" "$C" ;;
      esac
    fi
  done
  set +f
  log "$([ $r = 0 ] && echo sent || echo failed) $(title "$1") (App)"
  return $r
}

# a line from notify.awk: "ntfy <json>" or "push <json>"
send() {
  case "$1" in
  "ntfy "*) send_ntfy "${1#ntfy }" ;;
  "push "*) send_push "${1#push }" ;;
  esac
}

# notify.cgi sends tests the same way: test <line> (the topic or every phone), test-push <address> <json> (one phone)
[ "$1" = test ] && { send "$2"; exit $?; }
[ "$1" = test-push ] && { send_push "$3" "$2"; exit $?; }

while :; do
  host=$(find_broker)
  if [ -n "$host" ] && { [ -n "$(conf topic)" ] || grep -q '^push ' "$C" 2>/dev/null; } && [ "$(conf enabled)" != 0 ]; then
    # shellcheck disable=SC2086
    mosquitto_sub -h "$host" -p "$PORT" $AUTH -F '%U %t %p' \
      -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -t "${MOWER_MQTT_PREFIX}$TOPIC_EVENTS" -t "${MOWER_MQTT_PREFIX}$TOPIC_CHARGE_VOLTAGE" \
      -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTIONS" |
      CONF="$C" SNOOZE=/data/notify.snooze STATS=/data/stats awk -f /notify.awk | while IFS= read -r m; do send "$m"; done
  fi
  sleep 30
done
