#!/bin/sh
# starts mowing at the times from the schedule page (/data/schedule.txt, written by schedule.cgi).
# it only starts an idle mower without emergency, optionally not when its rain sensor is wet or rain
# is forecast, and waits up to two hours for the battery. what happened goes to /data/schedule.log for the page
. /broker.sh
F=/data/schedule.txt
LOG=/data/schedule.log
WAIT=7200

log() {
  echo "$(date +%s) $*" >> "$LOG"
  tail -n 100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
}
field() { printf '%s' "$1" | grep -o "\"$2\":[^,}]*" | head -n1 | cut -d: -f2 | tr -d '" '; }
conf() { sed -n "s/^$1 //p" "$F" | head -n1; }

# rain right now or in the next two hours at the garden (open-meteo, position rounded to ~1 km).
# no answer counts as no rain
rain_forecast() {
  set -- $(conf pos)
  [ -n "$2" ] || return 1
  w=$(wget -q -T 15 -O- "https://api.open-meteo.com/v1/forecast?latitude=$1&longitude=$2&current=precipitation&hourly=precipitation&forecast_hours=3" 2>/dev/null)
  [ -n "$w" ] || return 1
  cur=$(printf '%s' "$w" | grep -o '"current":{[^}]*}' | grep -o '"precipitation":[0-9.]*' | cut -d: -f2)
  soon=$(printf '%s' "$w" | grep -o '"hourly":{.*' | grep -o '"precipitation":\[[^]]*\]' | sed 's/.*\[//; s/\].*//' | cut -d, -f1-2)
  echo "${cur:-0},$soon" | tr ',' '\n' | awk '$1 >= 0.2 { r = 1 } END { exit !r }'
}

last=""
until=0
waited=""
while :; do
  if [ -f "$F" ] && [ "$(conf enabled)" = 1 ]; then
    tz=$(conf tz)
    now=$(TZ="$tz" date '+%u %H:%M %F')
    set -- $now
    due=$(awk -v d="$1" -v t="$2" '$1 == "plan" && $3 == t { n = split($2, a, ","); for (i = 1; i <= n; i++) if (a[i] == d) { print "yes"; exit } }' "$F")
    if [ -n "$due" ] && [ "$3 $2" != "$last" ]; then
      last="$3 $2"
      until=$(($(date +%s) + WAIT))
      waited=""
    fi
  else
    until=0
  fi

  if [ "$until" -gt 0 ]; then
    host=$(find_broker)
    # shellcheck disable=SC2086
    s=$([ -n "$host" ] && mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}robot_state/json" -C 1 -W 10 2>/dev/null)
    bat=$(field "$s" battery_percentage | awk '{printf "%d", $1 * 100}')
    minbat=$(conf minbattery)
    if [ -z "$s" ]; then
      [ "$(date +%s)" -gt "$until" ] && { log skip_offline; until=0; }
    elif [ "$(field "$s" emergency)" != 0 ]; then
      log skip_emergency; until=0
    elif [ "$(conf skiprain)" = 1 ] && [ "$(field "$s" rain_detected)" != 0 ]; then
      log skip_rain; until=0
    elif [ "$(conf skipforecast)" = 1 ] && rain_forecast; then
      log skip_forecast; until=0
    elif [ "$(field "$s" current_state)" != IDLE ]; then
      log skip_busy "$(field "$s" current_state)"; until=0
    elif [ "${bat:-0}" -lt "${minbat:-0}" ]; then
      if [ "$(date +%s)" -gt "$until" ]; then
        log skip_battery "$bat"; until=0
      elif [ -z "$waited" ]; then
        log waiting_battery "$bat"; waited=1
      fi
    else
      # shellcheck disable=SC2086
      if mosquitto_pub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}action" -m 'mower_logic:idle/start_mowing'; then
        log started "$bat"
      else
        log skip_offline
      fi
      until=0
    fi
  fi
  sleep 20
done
