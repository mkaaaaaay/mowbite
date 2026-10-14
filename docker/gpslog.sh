#!/bin/sh
# OpenMower keeps the mower's track without times and without the gps accuracy. so the position and its accuracy
# are kept here, once a second while the mower is out of the dock, one file per day (utc), 14 days, for the
# activity page: was the gps good when it bumped into something. lines: "<unix time> <state> <x> <y> <accuracy m>
# <wifi dBm> <charge V> <charge A>", accuracy 999 is no gps at all, - for what can't be read. the wifi signal comes from
# the mower's own /proc/net/wireless, only there with /proc/1/net mounted at /host-net (compose.yaml). a jump of the
# charge voltage is written right away, so a short touch of the contacts shows. when the mower leaves the dock, its
# settings are kept as they were then (snapshot-<time>-params.json, -planner.json) for the diagnosis file
D=/data/gpslog
mkdir -p "$D"

# never more than 14 days and never more than 20 MB together, the oldest days go first (today's last)
if [ "$1" = tidy ]; then
  ls -1 "$D"/*.log 2>/dev/null | sort -r | tail -n +15 | xargs rm -f
  find "$D" -name 'snapshot-*' -mtime +14 -exec rm -f {} + 2>/dev/null
  while [ "$(du -sk "$D" | cut -f1)" -gt 20480 ] && [ "$(ls -1 "$D"/*.log 2>/dev/null | wc -l)" -gt 1 ]; do
    rm -f "$(ls -1 "$D"/*.log | sort | head -n1)"
  done
  exit 0
fi
. /broker.sh
. /openmower.sh
# the settings at the start of a run: $2 its time
if [ "$1" = snapshot ]; then
  host=$(find_broker)
  [ -n "$host" ] || exit 0
  # shellcheck disable=SC2086
  mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_PARAMS" -C 1 -W 5 > "$D/snapshot-$2-params.json" 2>/dev/null
  [ -s "$D/snapshot-$2-params.json" ] || rm -f "$D/snapshot-$2-params.json"
  mower_rpc "$host" "$RPC_PLANNER_SETTINGS" '{}' 15 > "$D/snapshot-$2-planner.json"
  grep -q '"result"' "$D/snapshot-$2-planner.json" || rm -f "$D/snapshot-$2-planner.json"
  exit 0
fi
/gpslog.sh tidy

while :; do
  host=$(find_broker)
  if [ -n "$host" ]; then
    # shellcheck disable=SC2086
    mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" \
      -t "${MOWER_MQTT_PREFIX}$TOPIC_CHARGE_VOLTAGE" -t "${MOWER_MQTT_PREFIX}$TOPIC_CHARGE_CURRENT" -F '%U %t %p' 2>/dev/null |
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
        function write(t,    f) {
          f = dir "/" strftime("%Y%m%d", int(t)) ".log"
          # tidied up on a new day and every 10 minutes of writing
          if (f != lastf || ++lines % 600 == 0) { system("/gpslog.sh tidy"); lastf = f }
          printf "%.1f %s %.3f %.3f %.3f %s %s %s\n", t, last_state, x, y, acc, wifi(), vch, ich >> f
          close(f)
          written = t
        }
        BEGIN { vch = "-"; ich = "-" }
        $2 ~ /om_charge_current\/data$/ { ich = $3 + 0; next }
        $2 ~ /om_v_charge\/data$/ {
          v = $3 + 0
          jump = vch == "-" || v - vch > 3 || vch - v > 3
          vch = v
          # contact made or lost: right away, out of the dock only
          if (jump && last_state != "" && !was_home) write($1 + 0)
          next
        }
        {
          t = $1 + 0
          state = ""
          if (match($0, /"current_state":"[A-Z_]*"/)) { state = substr($0, RSTART + 17, RLENGTH - 18) }
          # standing in the dock says nothing, but the moment it got there does
          home = state == "IDLE" && num("is_charging") == 1
          if (home && was_home) next
          if (state == last_state && t - written < 0.9) next
          # leaving the dock (or idle) starts a run: its settings as they are now
          if (state != "IDLE" && (last_state == "IDLE" || last_state == "")) system("/gpslog.sh snapshot " int(t) " &")
          was_home = home
          last_state = state
          x = num("x"); y = num("y"); acc = num("pos_accuracy")
          write(t)
        }'
  fi
  sleep 30
done
