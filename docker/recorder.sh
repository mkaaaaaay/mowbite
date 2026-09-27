#!/bin/sh
# keeps the last 24 h of sensor values (5 min buckets) in /data, so the sensors page has more
# than the time a browser had it open
. /broker.sh
. /openmower.sh

while :; do
  host=$(find_broker)
  if [ -n "$host" ]; then
    # shellcheck disable=SC2086
    mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_SENSOR_DATA" -F '%U %t %p' |
      OUT=/data/sensors.tsv awk -f /recorder.awk
  fi
  sleep 30
done
