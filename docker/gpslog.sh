#!/bin/sh
# OpenMower keeps the mower's track without times and without the gps accuracy. so the position and its accuracy
# are kept here, once a second while the mower is out of the dock, one file per day (utc), 14 days, for the
# activity page: was the gps good when it bumped into something. lines: "<unix time> <state> <x> <y> <accuracy m>",
# accuracy 999 is no gps at all
. /broker.sh
. /openmower.sh
D=/data/gpslog
mkdir -p "$D"

while :; do
  host=$(find_broker)
  if [ -n "$host" ]; then
    # shellcheck disable=SC2086
    mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -F '%U %p' 2>/dev/null |
      awk -v dir="$D" '
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
          # a new day: the oldest beyond 14 days go
          if (f != lastf) { system("ls -1 " dir "/*.log 2>/dev/null | sort -r | tail -n +15 | xargs rm -f"); lastf = f }
          printf "%.1f %s %.3f %.3f %.3f\n", t, state, num("x"), num("y"), num("pos_accuracy") >> f
          close(f)
        }'
  fi
  sleep 30
done
