#!/bin/sh
set -e

esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

printf 'window.__MOWER_CONFIG__ = {mqttUrl: "%s", mqttPrefix: "%s"};\n' \
  "$(esc "$MOWER_MQTT_WS_URL")" "$(esc "$MOWER_MQTT_PREFIX")" > /www/config.js

# (the format of /data, for the updater)
/schema.sh || :

# the services in the background: one that ended (out of memory) ends the container, docker starts it again with all of
# them (restart: unless-stopped), the scheduler carries its run on
pids=""
service() {
  "$@" &
  pids="$pids $!"
}
service /recorder.sh
service /logkeeper.sh
service /gpslog.sh
service /battery.sh
# mowing hours, distance and runs, and the blade hours the maintenance counts from
service /stats.sh
# push messages, only once a topic is set on the settings page
service /notify.sh
# a second copy (e.g. a dev container next to the one on the mower) shouldn't start the mower too, nor set its
# settings again after the mower restarts (two copies would take turns setting theirs)
if [ "$MOWBITE_SCHEDULER" != off ]; then
  service /params.sh
  service /scheduler.sh
fi

# httpd as pid 1 would ignore docker's stop: 10 s and then killed. the shell passes it on to all of them instead.
# killed (out of memory) or without its port it starts again after a pause
until httpd -f -v -p "${PORT:-8080}" -h /www; do sleep 10; done &
trap 'trap - TERM INT; kill 0; exit 0' TERM INT
# (wait, not sleep: a stop comes through right away)
while :; do
  sleep 30 &
  wait $!
  for p in $pids; do
    kill -0 "$p" 2>/dev/null && continue
    echo "a service ended (pid $p), the container ends" >&2
    trap - TERM INT
    kill 0
    exit 1
  done
done
