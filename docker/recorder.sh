#!/bin/sh
# keeps the last 24 h of sensor values (5 min buckets) in /data, so the sensors page has more
# than the time a browser had it open

PORT=${MOWER_MQTT_PORT:-1883}

# the broker runs on the mower: localhost with host networking, otherwise the docker gateway
find_broker() {
  for h in $MOWER_MQTT_HOST 127.0.0.1 host.docker.internal $(ip route | awk '/^default/ {print $3; exit}'); do
    nc -z -w 2 "$h" "$PORT" 2>/dev/null && echo "$h" && return
  done
}

while :; do
  host=$(find_broker)
  if [ -n "$host" ]; then
    mosquitto_sub -h "$host" -p "$PORT" ${MOWER_MQTT_USER:+-u "$MOWER_MQTT_USER"} ${MOWER_MQTT_PASSWORD:+-P "$MOWER_MQTT_PASSWORD"} \
      -t "${MOWER_MQTT_PREFIX}sensors/+/data" -F '%U %t %p' | OUT=/data/sensors.tsv awk -f /recorder.awk
  fi
  sleep 30
done
