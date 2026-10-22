#!/bin/sh
# the battery over weeks: a line per charge and per discharge in /data/battery.log (battery.awk), about a year. what its
# capacity is read from in /data/battery-health.log, a few years, and a trace of each charge in /data/charges/, 60 of
# them and 10 MB. how full it is now in /dev/shm/battery.level, for the app and the schedule
F=/data/battery.log
H=/data/battery-health.log
C=/data/charges
# packed, or added to the one packed before (a charge the container restarted in, zcat reads both parts)
pack() {
  for f; do
    [ -f "$f" ] || continue
    if [ -e "$f.gz" ]; then gzip -c "$f" >> "$f.gz" && rm -f "$f"; else gzip "$f"; fi
  done
}
if [ "$1" = tidy ]; then
  # $2 a trace that's done. one left unpacked a day (its charge lost with the state) too
  pack "$2"
  find "$C" -name '*.tsv' -mmin +1440 | while read -r f; do pack "$f"; done
  ls -1 "$C"/*.tsv.gz 2>/dev/null | sort -r | tail -n +61 | xargs rm -f
  # the packed ones, not the one being written
  while [ "$(du -ck "$C"/*.tsv.gz 2>/dev/null | tail -n1 | cut -f1)" -gt 10240 ] 2>/dev/null &&
    [ "$(ls -1 "$C"/*.tsv.gz 2>/dev/null | wc -l)" -gt 1 ]; do
    rm -f "$(ls -1 "$C"/*.tsv.gz | sort | head -n1)"
  done
  exit 0
fi
. /broker.sh
. /openmower.sh
mkdir -p "$C"
/battery.sh tidy
# the cpu's zone as system.sh picks it, when MowBite runs on the mower
T=""
case "${MOWER_MQTT_HOST:-localhost}" in
  localhost | 127.0.0.1 | host.docker.internal)
    for z in /sys/class/thermal/thermal_zone*; do
      [ -r "$z/temp" ] || continue
      [ -n "$T" ] || T=$z/temp
      case "$(cat "$z/type" 2>/dev/null)" in *cpu* | *soc* | *CPU*) T=$z/temp; break ;; esac
    done
    ;;
esac
while :; do
  [ -f "$F" ] && tail -n 2000 "$F" > "$F.tmp" && mv "$F.tmp" "$F"
  [ -f "$H" ] && tail -n 4000 "$H" > "$H.tmp" && mv "$H.tmp" "$H"
  host=$(find_broker)
  if [ -n "$host" ]; then
    # shellcheck disable=SC2086
    mosquitto_sub -h "$host" -p "$PORT" $AUTH -F '%U %t %p' \
      -t "${MOWER_MQTT_PREFIX}sensors/om_v_battery/data" -t "${MOWER_MQTT_PREFIX}sensors/om_charge_current/data" \
      -t "${MOWER_MQTT_PREFIX}sensors/om_charge_state/data" -t "${MOWER_MQTT_PREFIX}sensors/om_mow_motor_rpm/data" \
      -t "${MOWER_MQTT_PREFIX}$TOPIC_CHARGE_VOLTAGE" -t "${MOWER_MQTT_PREFIX}sensors/om_mow_motor_temp/data" \
      -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -t "${MOWER_MQTT_PREFIX}sensor_infos/json" |
      OUT="$F" STATE=/data/battery.state HEALTH="$H" TRACES="$C" TIDY="/battery.sh tidy" CPUT="$T" LEVEL=/dev/shm/battery.level \
        awk -f /battery.awk
  fi
  sleep 30
done
