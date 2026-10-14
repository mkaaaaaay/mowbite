#!/bin/sh
# OpenMower keeps the mower's track without times and without the gps accuracy. so the position and its accuracy
# are kept here, once a second while the mower is out of the dock, one file per day (utc), 14 days, for the
# activity page: was the gps good when it bumped into something. lines: "<unix time> <state> <x> <y> <accuracy m>
# <wifi dBm>", accuracy 999 is no gps at all, wifi - when it can't be read: the mower's own /proc/net/wireless is only
# there with /proc/1/net mounted at /host-net (compose.yaml)
D=/data/gpslog
mkdir -p "$D"

# never more than 14 days and never more than 20 MB together, the oldest days go first (today's last)
if [ "$1" = tidy ]; then
  ls -1 "$D"/*.log 2>/dev/null | sort -r | tail -n +15 | xargs rm -f
  while [ "$(du -sk "$D" | cut -f1)" -gt 20480 ] && [ "$(ls -1 "$D"/*.log 2>/dev/null | wc -l)" -gt 1 ]; do
    rm -f "$(ls -1 "$D"/*.log | sort | head -n1)"
  done
  exit 0
fi
. /broker.sh
. /openmower.sh
/gpslog.sh tidy

while :; do
  host=$(find_broker)
  if [ -n "$host" ]; then
    # shellcheck disable=SC2086
    mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -F '%U %p' 2>/dev/null |
      awk -v dir="$D" -v wf=/host-net/wireless '
        # the signal of the first wifi interface, some drivers count it from 0 instead of in dBm
        function wifi(    l, a, w) {
          w = "-"
          while ((getline l < wf) > 0) if (w == "-" && l ~ /^ *[a-z0-9]+: /) { split(l, a, " "); w = a[4] + 0; if (w > 0) w -= 256 }
          close(wf)
          return w
        }
        function num(key,    s) {
          if (!match($0, "\"" key "\":-?[0-9.eE+-]+")) return ""
          s = substr($0, RSTART, RLENGTH); sub(/^[^:]*:/, "", s); return s + 0
        }
        {
          t = $1 + 0
          state = ""
          if (match($0, /"current_state":"[A-Z_]*"/)) { state = substr($0, RSTART + 17, RLENGTH - 18) }
          # standing in the dock says nothing, but the moment it got there does
          home = state == "IDLE" && num("is_charging") == 1
          if (home && was_home) next
          if (state == last_state && t - written < 0.9) next
          was_home = home
          last_state = state
          written = t
          f = dir "/" strftime("%Y%m%d", int(t)) ".log"
          # tidied up on a new day and every 10 minutes of writing
          if (f != lastf || ++lines % 600 == 0) { system("/gpslog.sh tidy"); lastf = f }
          printf "%.1f %s %.3f %.3f %.3f %s\n", t, state, num("x"), num("y"), num("pos_accuracy"), wifi() >> f
          close(f)
        }'
  fi
  sleep 30
done
