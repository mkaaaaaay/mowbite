#!/bin/sh
set -e

esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

printf 'window.__MOWER_CONFIG__ = {mqttUrl: "%s", mqttPrefix: "%s"};\n' \
  "$(esc "$MOWER_MQTT_WS_URL")" "$(esc "$MOWER_MQTT_PREFIX")" > /www/config.js

/recorder.sh &
/logkeeper.sh &
/gpslog.sh &
/battery.sh &
# mowing hours, distance and runs, and the blade hours the maintenance counts from
/stats.sh &
# push messages, only once a topic is set on the settings page
/notify.sh &
# a second copy (e.g. a dev container next to the one on the mower) shouldn't start the mower too, nor set its
# settings again after the mower restarts (two copies would take turns setting theirs)
if [ "$MOWBITE_SCHEDULER" != off ]; then
  /params.sh &
  /scheduler.sh &
fi

exec httpd -f -v -p "${PORT:-8080}" -h /www
