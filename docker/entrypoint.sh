#!/bin/sh
set -e

esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

printf 'window.__MOWER_CONFIG__ = {mqttUrl: "%s", mqttPrefix: "%s"};\n' \
  "$(esc "$MOWER_MQTT_WS_URL")" "$(esc "$MOWER_MQTT_PREFIX")" > /www/config.js

/recorder.sh &
# only where the schedule can be set up (the dev image), or when asked for with MOWBITE_SCHEDULER=on.
# a second copy (e.g. a dev container next to the one on the mower) sets it off so it doesn't start the mower too
[ "$MOWBITE_SCHEDULER" = on ] && /scheduler.sh &

exec httpd -f -v -p "${PORT:-8080}" -h /www
