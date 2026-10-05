#!/bin/sh
# push messages when the mower needs someone, what and when notify.awk decides. they go to the ntfy server and topic
# set on the settings page (notify.cgi writes /data/notify.conf), nothing happens without a topic there or while
# they're switched off.
# what was sent goes to /data/notify.log for the page
. /broker.sh
. /openmower.sh
C=/data/notify.conf
LOG=/data/notify.log
conf() { sed -n "s/^$1 //p" "$C" 2>/dev/null | head -n1; }

# $1: the message as json, ntfy takes it at the server's root
send() {
  server=$(conf server)
  token=$(conf token)
  if [ -n "$token" ]; then
    wget -q -T 15 -O /dev/null --header "Authorization: Bearer $token" --header 'Content-Type: application/json' \
      --post-data "$1" "${server:-https://ntfy.sh}" 2>/dev/null
  else
    wget -q -T 15 -O /dev/null --header 'Content-Type: application/json' --post-data "$1" "${server:-https://ntfy.sh}" 2>/dev/null
  fi
  r=$?
  echo "$(date +%s) $([ $r = 0 ] && echo sent || echo failed) $(printf '%s' "$1" | sed -n 's/.*"title":"\([^"]*\)".*/\1/p')" >> "$LOG"
  tail -n 50 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  return $r
}

# notify.cgi sends a test the same way
[ "$1" = test ] && { send "$2"; exit $?; }

while :; do
  host=$(find_broker)
  if [ -n "$host" ] && [ -n "$(conf topic)" ] && [ "$(conf enabled)" != 0 ]; then
    # shellcheck disable=SC2086
    mosquitto_sub -h "$host" -p "$PORT" $AUTH -F '%U %t %p' \
      -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -t "${MOWER_MQTT_PREFIX}$TOPIC_EVENTS" |
      CONF="$C" SNOOZE=/data/notify.snooze awk -f /notify.awk | while IFS= read -r m; do send "$m"; done
  fi
  sleep 30
done
