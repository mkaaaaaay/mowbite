#!/bin/sh
# starts mowing at the times from the schedule page (/data/schedule.txt, written by schedule.cgi).
# a plan can name the areas to mow, the others get skipped when the mower gets to them.
# it only starts an idle mower without emergency, optionally not when its rain sensor is wet or rain
# is forecast, and waits up to two hours for the battery. what happened goes to /data/schedule.log for the page
. /broker.sh
. /openmower.sh
F=/data/schedule.txt
LOG=/data/schedule.log
WAIT=7200

log() {
  echo "$(date +%s) $*" >> "$LOG"
  tail -n 100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
}
field() { printf '%s' "$1" | grep -o "\"$2\":[^,}]*" | head -n1 | cut -d: -f2 | tr -d '" '; }
conf() { sed -n "s/^$1 //p" "$F" | head -n1; }

# rain right now or in the next hour(s) at the garden (open-meteo, position rounded to ~1 km).
# no answer counts as no rain
# during a run this script started: skip every area that isn't in the list, until the mower is back
skip_others() {
  # shellcheck disable=SC2086
  timeout 21600 mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_EVENTS" | while read -r e; do
    type=$(field "$e" type)
    case "$type" in
      DOCKED | JOB_COMPLETE | SHUTDOWN) break ;;
      AREA)
        a=$(field "$e" area_id)
        # the map as the mower has it now (retained), only its areas are skipped. a job resumed from
        # before a map change can name an area that isn't in it any more, that one is left alone.
        # inactive ones too (and ones it doesn't mow), the mower passes them by itself, and a skip
        # sent while it does would hit the next area instead
        # shellcheck disable=SC2086
        props=$(mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_MAP" -C 1 -W 5 2>/dev/null |
          tr -d ' \n' | grep -o "\"id\":\"$a\",\"properties\":{[^}]*}" | head -n1)
        case ",$1," in
          *",$a,"*) ;;
          *)
            if [ -z "$props" ]; then
              log unknown_area "$a"
              continue
            fi
            case "$props" in *'"active":false'* | *'"skip_mowing":true'*) continue ;; esac
            # shellcheck disable=SC2086
            mosquitto_pub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" -m "$ACTION_SKIP_AREA"
            log skipped_area "$a"
            ;;
        esac
        ;;
    esac
  done
}

rain_forecast() {
  set -- $(conf pos)
  [ -n "$2" ] || return 1
  hours=$(conf forecasthours)
  case "$hours" in 1 | 2 | 3) ;; *) hours=1 ;; esac
  # quarter hours from now on, 4 per hour
  w=$(wget -q -T 15 -O- "https://api.open-meteo.com/v1/forecast?latitude=$1&longitude=$2&current=precipitation&minutely_15=precipitation&forecast_minutely_15=$((hours * 4))" 2>/dev/null)
  [ -n "$w" ] || return 1
  cur=$(printf '%s' "$w" | grep -o '"current":{[^}]*}' | grep -o '"precipitation":[0-9.]*' | cut -d: -f2)
  soon=$(printf '%s' "$w" | grep -o '"minutely_15":{.*' | grep -o '"precipitation":\[[^]]*\]' | sed 's/.*\[//; s/\].*//')
  # raining now, or at least 0.2 mm in one of the coming hours
  echo "${cur:-0} ${soon}" | awk -v per=4 '{ if ($1 >= 0.05) r = 1; n = split($2, q, ","); for (i = 1; i <= n; i++) { h[int((i - 1) / per)] += q[i] } for (k in h) if (h[k] >= 0.2) r = 1 } END { exit !r }'
}

last=""
until=0
waited=""
areas=all
while :; do
  if [ -f "$F" ] && [ "$(conf enabled)" = 1 ]; then
    tz=$(conf tz)
    now=$(TZ="$tz" date '+%u %H:%M %F')
    set -- $now
    due=$(awk -v d="$1" -v t="$2" '$1 == "plan" && $3 == t { n = split($2, a, ","); for (i = 1; i <= n; i++) if (a[i] == d) { print ($4 == "" ? "all" : $4); exit } }' "$F")
    if [ -n "$due" ] && [ "$3 $2" != "$last" ]; then
      last="$3 $2"
      until=$(($(date +%s) + WAIT))
      waited=""
      areas=$due
    fi
  else
    until=0
  fi

  if [ "$until" -gt 0 ]; then
    host=$(find_broker)
    # shellcheck disable=SC2086
    s=$([ -n "$host" ] && mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -C 1 -W 10 2>/dev/null)
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
      if mosquitto_pub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" -m "$ACTION_START_MOWING"; then
        log started "$bat"
        [ "$areas" = all ] || skip_others "$areas" &
      else
        log skip_offline
      fi
      until=0
    fi
  fi
  sleep 20
done
