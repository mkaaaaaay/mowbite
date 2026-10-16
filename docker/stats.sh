#!/bin/sh
# mowing hours, distance and runs (stats.awk): a line per hour in /data/stats/hours, about three years of mowing, and
# the totals since counting started in /data/stats/state. the maintenance counters (stats.cgi, notify.awk) count the
# blade hours since a part was last seen to, in /data/stats/maint: "<part> <due after blade h> <blade s then> <time>"
. /broker.sh
. /openmower.sh
D=/data/stats
mkdir -p "$D"
# blades and cleaning as a robot mower maker suggests them, until the page sets others
for p in "blade 80" "clean 200"; do
  grep -q "^${p% *} " "$D/maint" 2>/dev/null || echo "$p 0 0" >> "$D/maint"
done
while :; do
  [ -f "$D/hours" ] && tail -n 10000 "$D/hours" > "$D/hours.tmp" && mv "$D/hours.tmp" "$D/hours"
  host=$(find_broker)
  if [ -n "$host" ]; then
    # shellcheck disable=SC2086
    mosquitto_sub -h "$host" -p "$PORT" $AUTH -F '%U %t %p' \
      -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -t "${MOWER_MQTT_PREFIX}sensors/om_mow_motor_rpm/data" |
      HOURS="$D/hours" STATE="$D/state" awk -f /stats.awk
  fi
  sleep 30
done
