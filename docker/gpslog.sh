#!/bin/sh
# OpenMower keeps the mower's track without times and without the gps accuracy. so the position and its accuracy
# are kept here, once a second while the mower is out of the dock, one file per day (utc), 14 days and 20 MB, for the
# activity page and the diagnosis file. lines: "<unix time> <state> <x> <y> <accuracy m> <wifi dBm> <charge V>
# <charge A> <heading rad> <area> <path> <path index> <battery V> <mow motor A> <mow motor rpm> <left esc °C>
# <right esc °C>", accuracy 999 is no gps at all, - for what can't be read (area, path and index as in robot_state).
# the wifi signal comes from the mower's own /proc/net/wireless, only there with /proc/1/net mounted at /host-net
# (compose.yaml). a jump of the charge voltage is written right away, so a short touch of the contacts shows.
# in snap/: the settings and the map when the mower leaves the dock (the map only when it changed), and the plan of
# each area when the mower starts on it, 14 days and 10 MB
D=/data/gpslog
S=$D/snap
mkdir -p "$S"
# kept next to the logs before
mv "$D"/snapshot-* "$S"/ 2>/dev/null

if [ "$1" = tidy ]; then
  # the logs: 14 days and 20 MB, the oldest days first (today's last)
  ls -1 "$D"/*.log 2>/dev/null | sort -r | tail -n +15 | xargs rm -f
  while [ "$(cat "$D"/*.log 2>/dev/null | wc -c)" -gt 20971520 ] && [ "$(ls -1 "$D"/*.log 2>/dev/null | wc -l)" -gt 1 ]; do
    rm -f "$(ls -1 "$D"/*.log | sort | head -n1)"
  done
  # snap/: 14 days and 10 MB, the oldest first. the newest map stays, a run uses it as long as the map doesn't change
  keep=$(ls -1 "$S"/map-*.json.gz 2>/dev/null | sort | tail -n1)
  find "$S" -type f -mtime +14 ! -path "$keep" -exec rm -f {} + 2>/dev/null
  while [ "$(du -sk "$S" | cut -f1)" -gt 10240 ]; do
    old=$(ls -1 "$S" | grep -v "^${keep##*/}$" | sed 's/^[a-z]*-\([0-9]*\)-.*/\1 &/' | sort -n | head -n1 | cut -d' ' -f2)
    [ -n "$old" ] || break
    rm -f "${S:?}/$old"
  done
  exit 0
fi
. /broker.sh
. /openmower.sh

# the settings and the map at the start of a run: $2 its time
if [ "$1" = snapshot ]; then
  host=$(find_broker)
  [ -n "$host" ] || exit 0
  # shellcheck disable=SC2086
  mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_PARAMS" -C 1 -W 5 > "$S/snapshot-$2-params.json" 2>/dev/null
  [ -s "$S/snapshot-$2-params.json" ] || rm -f "$S/snapshot-$2-params.json"
  mower_rpc "$host" "$RPC_PLANNER_SETTINGS" '{}' 15 > "$S/snapshot-$2-planner.json"
  grep -q '"result"' "$S/snapshot-$2-planner.json" || rm -f "$S/snapshot-$2-planner.json"
  # the map only when it changed since the one kept last, that one is touched so it doesn't run out
  m=/tmp/gpslog.map.$$
  # shellcheck disable=SC2086
  mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_MAP" -C 1 -W 5 > "$m" 2>/dev/null
  if [ -s "$m" ]; then
    sum=$(md5sum < "$m" | cut -d' ' -f1)
    last=$(ls -1 "$S"/map-*.json.gz 2>/dev/null | sort | tail -n1)
    if [ -n "$last" ] && [ "$(cat "$S/.mapsum" 2>/dev/null)" = "$sum" ]; then
      touch "$last"
    else
      gzip -c "$m" > "$S/map-$2-x.json.gz"
      echo "$sum" > "$S/.mapsum"
    fi
  fi
  rm -f "$m"
  exit 0
fi

# the plan of an area as the mower starts on it: $2 the time, $3 the area id. the MowBite Planner's when it's there
# (the plan mower_logic got), OpenMower's own otherwise
if [ "$1" = plan ]; then
  host=$(find_broker)
  [ -n "$host" ] || exit 0
  case "$3" in *[!A-Za-z0-9_-]* | '') exit 0 ;; esac
  f="$S/plan-$2-$3.json"
  mower_rpc "$host" "$RPC_PLANNER_PLAN" "{\"area_id\":\"$3\"}" 90 > "$f"
  grep -q '"result"' "$f" || mower_rpc "$host" "$RPC_AREA_PLAN" "{\"area_id\":\"$3\"}" 30 > "$f"
  if grep -q '"result"' "$f"; then gzip -f "$f"; else rm -f "$f"; fi
  exit 0
fi

/gpslog.sh tidy

while :; do
  host=$(find_broker)
  if [ -n "$host" ]; then
    # shellcheck disable=SC2086
    mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -t "${MOWER_MQTT_PREFIX}$TOPIC_EVENTS" \
      -t "${MOWER_MQTT_PREFIX}$TOPIC_SENSOR_DATA" -F '%U %t %p' 2>/dev/null |
      awk -v dir="$D" -v wf=/host-net/wireless '
        # the signal of the first wifi interface, some drivers count it from 0 instead of in dBm
        function wifi(    l, a, w) {
          w = "-"
          while ((getline l < wf) > 0) if (w == "-" && l ~ /^ *[a-z0-9]+: /) { split(l, a, " "); w = a[4] + 0; if (w > 0) w -= 256 }
          close(wf)
          return w
        }
        function num(key,    s) {
          if (!match($0, "\"" key "\":-?[0-9.eE+-]+")) return "-"
          s = substr($0, RSTART, RLENGTH); sub(/^[^:]*:/, "", s); return s + 0
        }
        function val(id) { return (id in sensor) ? sensor[id] : "-" }
        function write(t,    f, line) {
          f = dir "/" strftime("%Y%m%d", int(t)) ".log"
          # tidied up on a new day and every 10 minutes of writing
          if (f != lastf || ++lines % 600 == 0) { system("/gpslog.sh tidy"); lastf = f }
          line = sprintf("%.1f %s %.3f %.3f %.3f %s %s %s", t, last_state, x, y, acc, wifi(), val("om_v_charge"), val("om_charge_current"))
          line = line sprintf(" %s %s %s %s %s", heading, area, path, pidx, val("om_v_battery"))
          line = line sprintf(" %s %s %s %s", val("om_mow_motor_current"), val("om_mow_motor_rpm"), val("om_left_esc_temp"), val("om_right_esc_temp"))
          print line >> f
          close(f)
          written = t
        }
        $2 ~ /sensors\/[a-z0-9_]+\/data$/ {
          id = $2; sub(/.*sensors\//, "", id); sub(/\/data$/, "", id)
          if ($3 !~ /^-?[0-9.]+$/) next
          old = val(id)
          sensor[id] = $3 + 0
          # contact made or lost: right away, out of the dock only
          if (id == "om_v_charge" && (old == "-" || $3 - old > 3 || old - $3 > 3) && last_state != "" && !was_home) write($1 + 0)
          next
        }
        # an area started: its plan as the mower got it
        $2 ~ /events\/json$/ {
          if ($0 ~ /"type": *"AREA"/ && match($0, /"area_id": *"[A-Za-z0-9_-]+"/)) {
            a = substr($0, RSTART, RLENGTH); sub(/.*"area_id": *"/, "", a); sub(/"$/, "", a)
            system("/gpslog.sh plan " int($1) " " a " &")
          }
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
          # leaving the dock (or idle) starts a run: its settings and map as they are now
          if (state != "IDLE" && (last_state == "IDLE" || last_state == "")) system("/gpslog.sh snapshot " int(t) " &")
          x = num("x"); y = num("y"); acc = num("pos_accuracy"); h = num("heading")
          if (x == "-" || y == "-" || acc == "-") next
          was_home = home
          last_state = state
          heading = h == "-" ? "-" : sprintf("%.2f", h)
          area = num("current_area"); path = num("current_path"); pidx = num("current_path_index")
          write(t)
        }'
  fi
  sleep 30
done
