#!/bin/sh
# starts mowing at the times from the schedule page (/data/schedule.txt, written by schedule.cgi).
# a plan can name the areas to mow, the others get skipped when the mower gets to them.
# it only starts an idle mower without emergency, optionally not when its rain sensor is wet or rain
# is forecast, and waits up to two hours for the battery. a run it started goes home at the plan's end
# time. what happened goes to /data/schedule.log for the page
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
            case "$props" in *'"active":false'* | *'"mowable":false'*) continue ;; esac
            # shellcheck disable=SC2086
            mosquitto_pub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" -m "$ACTION_SKIP_AREA"
            log skipped_area "$a"
            ;;
        esac
        ;;
    esac
  done
}

# minutes after local midnight, now
minutes() { TZ="$tz" date +%H:%M | awk -F: '{ print $1 * 60 + $2 }'; }

# the time a run started now has to be home by, as a unix time: the plan's end time, the next one
# coming up. empty without one
stop_time() {
  [ "$1" != - ] || return 0
  now=$(date +%s)
  midnight=$((now - $(minutes) * 60 - $(date +%S | sed 's/^0//')))
  stop=$((midnight + $(echo "$1" | awk -F: '{ print $1 * 3600 + $2 * 60 }')))
  [ "$stop" -gt "$now" ] || stop=$((stop + 86400))
  echo "$stop end"
}

# a run this script started: send it home at the stop time. a job that's still open (it was charging)
# carries on by itself once the battery is full, so for 12 hours it's sent home again whenever it starts
# mowing, until someone starts it by hand or the job is done
send_home_at() {
  topics="-t ${MOWER_MQTT_PREFIX}$TOPIC_EVENTS -t ${MOWER_MQTT_PREFIX}$TOPIC_ACTION"
  while [ "$(date +%s)" -lt "$1" ]; do
    # shellcheck disable=SC2086
    e=$(mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_EVENTS" -C 1 -W 60 2>/dev/null) || sleep 5
    case "$(field "$e" type)" in JOB_COMPLETE | SHUTDOWN) return ;; esac
  done
  logged=""
  while [ "$(date +%s)" -lt "$(($1 + 43200))" ]; do
    # shellcheck disable=SC2086
    s=$(mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -C 1 -W 10 2>/dev/null)
    if [ "$(field "$s" current_state)" = MOWING ]; then
      # shellcheck disable=SC2086
      mosquitto_pub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" -m "$ACTION_HOME" &&
        log "$([ -z "$logged" ] && echo "stopped_$2" || echo stopped_again)"
      logged=1
    fi
    # shellcheck disable=SC2086
    m=$(mosquitto_sub -h "$host" -p "$PORT" $AUTH $topics -v -C 1 -W 30 2>/dev/null) || sleep 5
    case "$m" in
      *" $ACTION_START_MOWING") return ;;
      *'"type":"JOB_COMPLETE"'* | *'"type": "JOB_COMPLETE"'*) return ;;
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
end=-
while :; do
  if [ -f "$F" ] && [ "$(conf enabled)" = 1 ]; then
    tz=$(conf tz)
    now=$(TZ="$tz" date '+%u %H:%M %F')
    set -- $now
    # plan <days> <HH:MM> [areas] [end=HH:MM]: areas and end time, - when not set. dark=1 in older
    # files is from the night lock, that's gone
    due=$(awk -v d="$1" -v t="$2" '$1 == "plan" && $3 == t {
      n = split($2, a, ","); for (i = 1; i <= n; i++) if (a[i] == d) {
        ar = "all"; en = "-"
        for (j = 4; j <= NF; j++) if ($j ~ /^end=/) en = substr($j, 5); else if ($j != "dark=1") ar = $j
        print ar, en; exit } }' "$F")
    if [ -n "$due" ] && [ "$3 $2" != "$last" ]; then
      last="$3 $2"
      until=$(($(date +%s) + WAIT))
      waited=""
      set -- $due
      areas=$1 end=$2
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
        stop=$(stop_time "$end")
        [ -n "$stop" ] && send_home_at $stop &
      else
        log skip_offline
      fi
      until=0
    fi
  fi
  sleep 20
done
