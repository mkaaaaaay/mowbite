#!/bin/sh
# starts mowing at the times from the schedule page (/data/schedule.txt, written by schedule.cgi).
# a plan can name the areas to mow, the others get skipped when the mower gets to them.
# it only starts an idle mower without emergency, optionally not when its rain sensor is wet, rain
# is forecast or it's too cold, and waits up to two hours for the battery. not in the dark (sun times of the day at the garden,
# 6 pm to 6 am without a position) unless the plan says so. a run it started goes home at the plan's end time,
# and at sunset if the plan wants that. a plan can drop an interrupted job first so it begins with the first area,
# and it can be paused for some days, for all areas or some. a plan can have its own mowing direction (angle=<deg>),
# set on the mower before the start. what happened goes to /data/schedule.log for the page
. /broker.sh
. /openmower.sh
F=/data/schedule.txt
LOG=/data/schedule.log
# the mower's mowing direction before a start turned it, for the starts without their own
NORMAL=/data/angle.normal
WAIT=7200

log() {
  echo "$(date +%s) $*" >> "$LOG"
  tail -n 100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
}
# a plain value from compact or spaced out json, e.g. field "$state" current_state
field() { printf '%s' "$1" | grep -o "\"$2\" *: *[^,}]*" | head -n1 | sed 's/^[^:]*: *//' | tr -d '" '; }
conf() { sed -n "s/^$1 //p" "$F" | head -n1; }
# the areas of a map/json, one "id":"...","properties":{...} a line. objects in the properties (an area's planner
# settings) become null, so the properties end at their own brace
map_areas() {
  tr -d ' \n' | sed -e 's/"properties":[{]/"properties":(/g' -e ':a' -e 's/\("[^"]*":\)[{][^{}]*[}]/\1null/g' -e 'ta' \
    -e 's/"properties":(/"properties":{/g' | grep -o '"id":"[^"]*","properties":{[^}]*}'
}

# rain right now or in the next hour(s) at the garden (open-meteo, position rounded to ~1 km).
# no answer counts as no rain
# during a run this script started: skip every area the plan doesn't pick ($1: all or a list) and the ones
# paused for today ($2), until the job is done (also across breaks for charging) or the next start. a run sent
# home at its end time keeps its job open, without stopping at the next start this would go on skipping the
# areas of the next plan or of a start by hand
skip_others() {
  # shellcheck disable=SC2086
  timeout 86400 mosquitto_sub -h "$host" -p "$PORT" $AUTH -v -t "${MOWER_MQTT_PREFIX}$TOPIC_EVENTS" \
    -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" | while read -r e; do
    case "$e" in *" $ACTION_START_MOWING") break ;; esac
    type=$(field "$e" type)
    case "$type" in
      # not on DOCKED: a run that docks to charge carries on afterwards, and it's still this run
      JOB_COMPLETE | JOB_RESET | SHUTDOWN) break ;;
      AREA)
        a=$(field "$e" area_id)
        # the map as the mower has it now (retained), only its areas are skipped. a job resumed from
        # before a map change can name an area that isn't in it any more, that one is left alone.
        # inactive ones too (and ones it doesn't mow), the mower passes them by itself, and a skip
        # sent while it does would hit the next area instead
        # shellcheck disable=SC2086
        props=$(mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_MAP" -C 1 -W 5 2>/dev/null |
          map_areas | grep "^\"id\":\"$a\"," | head -n1)
        # skipped when the plan doesn't pick it (all or a list) or it's paused for today
        keep=1
        case ",$1," in ,all, | *",$a,"*) ;; *) keep=0 ;; esac
        case ",$2," in *",$a,"*) keep=0 ;; esac
        [ "$keep" = 1 ] && continue
        if [ -z "$props" ]; then
          log unknown_area "$a"
          continue
        fi
        case "$props" in *'"active":false'* | *'"mowable":false'*) continue ;; esac
        # shellcheck disable=SC2086
        mosquitto_pub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" -m "$ACTION_SKIP_AREA"
        case ",$2," in *",$a,"*) log paused_area "$a" ;; *) log skipped_area "$a" ;; esac
        ;;
    esac
  done
}

# today's sunrise and sunset at the garden as minutes after local midnight, the NOAA formulas like
# src/lib/sun.ts. nothing without a position or when the sun doesn't rise or set
sun_today() {
  set -- $(conf pos)
  [ -n "$2" ] || set -- $where
  [ -n "$2" ] || return 1
  noon=$(date -u -d "$(TZ="$tz" date +%F) 12:00:00" +%s 2>/dev/null) || return 1
  awk -v lat="$1" -v lon="$2" -v noon="$noon" -v off="$(TZ="$tz" date +%z)" '
    function rad(d) { return d * 3.14159265358979 / 180 }
    function deg(r) { return r * 180 / 3.14159265358979 }
    function clock(m) { m = int(m + 0.5) % 1440; return m < 0 ? m + 1440 : m }
    BEGIN {
      t = (noon / 86400 + 2440587.5 - 2451545) / 36525
      L = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
      M = 357.52911 + t * (35999.05029 - 0.0001537 * t)
      e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
      C = sin(rad(M)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + sin(rad(2 * M)) * (0.019993 - 0.000101 * t) + sin(rad(3 * M)) * 0.000289
      om = 125.04 - 1934.136 * t
      lam = L + C - 0.00569 - 0.00478 * sin(rad(om))
      eps = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * cos(rad(om))
      x = sin(rad(eps)) * sin(rad(lam)); decl = deg(atan2(x, sqrt(1 - x * x)))
      y = (sin(rad(eps / 2)) / cos(rad(eps / 2))) ^ 2
      eq = 4 * deg(y * sin(2 * rad(L)) - 2 * e * sin(rad(M)) + 4 * e * y * sin(rad(M)) * cos(2 * rad(L)) - 0.5 * y * y * sin(4 * rad(L)) - 1.25 * e * e * sin(2 * rad(M)))
      c = (cos(rad(90.833)) - sin(rad(lat)) * sin(rad(decl))) / (cos(rad(lat)) * cos(rad(decl)))
      if (c < -1 || c > 1) exit 1
      ha = deg(atan2(sqrt(1 - c * c), c))
      o = (substr(off, 1, 1) == "-" ? -1 : 1) * (substr(off, 2, 2) * 60 + substr(off, 4, 2))
      n = 720 - 4 * lon - eq + o
      print clock(n - 4 * ha), clock(n + 4 * ha)
    }'
}

# minutes after local midnight, now
minutes() { TZ="$tz" date +%H:%M | awk -F: '{ print $1 * 60 + $2 }'; }

# dark at this minute of the day: between sunset and sunrise, or 6 pm to 6 am without the sun times
is_dark() {
  set -- "$1" $(sun_today) 360 1080
  [ "$1" -ge "$3" ] || [ "$1" -lt "$2" ]
}

# the time a run started now has to be home by, as a unix time: the plan's end time (next one coming
# up, or $4 when it's known already), and sunset if the plan wants that, or if its end time lies in the dark
# without mowing in the dark being allowed. empty when neither
stop_time() {
  now=$(date +%s)
  midnight=$((now - $(minutes) * 60 - $(date +%S | sed 's/^0//')))
  stop=""
  if [ -n "$4" ]; then
    stop=$4
    why=end
  elif [ "$1" != - ]; then
    stop=$((midnight + $(echo "$1" | awk -F: '{ print $1 * 3600 + $2 * 60 }')))
    [ "$stop" -gt "$now" ] || stop=$((stop + 86400))
    why=end
  fi
  endmin=$([ "$1" != - ] && echo "$1" | awk -F: '{ print $1 * 60 + $2 }')
  if [ "$2" = 1 ] || { [ "$3" != 1 ] && [ -n "$endmin" ] && is_dark "$endmin"; }; then
    set -- $(sun_today) 360 1080
    dusk=$((midnight + $2 * 60))
    if [ "$dusk" -gt "$now" ] && { [ -z "$stop" ] || [ "$dusk" -lt "$stop" ]; }; then
      stop=$dusk
      why=dark
    fi
  fi
  [ -n "$stop" ] && echo "$stop $why"
}

# a run this script started: send it home at the stop time. a job that's still open (it was charging)
# carries on by itself once the battery is full, so for 12 hours it's sent home again whenever it starts
# mowing, until someone starts it by hand or the job is done. a start before the stop time ends it too, that's
# another run then (the next plan, or by hand after this one was sent home) with its own end
send_home_at() {
  topics="-t ${MOWER_MQTT_PREFIX}$TOPIC_EVENTS -t ${MOWER_MQTT_PREFIX}$TOPIC_ACTION"
  while [ "$(date +%s)" -lt "$1" ]; do
    # waits for a message until the stop time at most, so it goes home on time. a broker that isn't there
    # fails right away, then it waits a bit instead of trying over and over
    w=$(($1 - $(date +%s)))
    [ "$w" -gt 60 ] && w=60
    [ "$w" -lt 1 ] && w=1
    t=$(date +%s)
    # shellcheck disable=SC2086
    e=$(mosquitto_sub -h "$host" -p "$PORT" $AUTH $topics -v -C 1 -W "$w" 2>/dev/null) ||
      { [ $(($(date +%s) - t)) -lt 1 ] && sleep 5; }
    case "$e" in *" $ACTION_START_MOWING") return ;; esac
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
    case "$m" in *" $ACTION_START_MOWING") return ;; esac
    [ "$(field "$m" type)" = JOB_COMPLETE ] && return
  done
}

# a start that went out only says the broker took it. the mower answers by leaving IDLE (undocking), when it
# doesn't within a minute that's logged, the page would say started otherwise
check_started() {
  t=$(($(date +%s) + 60))
  while [ "$(date +%s)" -lt "$t" ]; do
    # shellcheck disable=SC2086
    s=$(mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -C 1 -W 10 2>/dev/null)
    case "$(field "$s" current_state)" in '' | IDLE) sleep 2 ;; *) return ;; esac
  done
  log start_failed
}

# does the run have an area left: mowed ones in the map (retained) the plan picks ($1: all or a list) and
# that aren't paused ($2). when the map can't be read it's left to the run
area_left() {
  # shellcheck disable=SC2086
  m=$(mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_MAP" -C 1 -W 5 2>/dev/null | tr -d ' \n')
  [ -n "$m" ] || return 0
  printf '%s' "$m" | map_areas | grep '"type":"mow"' |
    grep -v '"active":false' | grep -v '"mowable":false' | sed 's/^"id":"\([^"]*\)".*/\1/' | {
    while read -r a; do
      case ",$1," in ,all, | *",$a,"*) ;; *) continue ;; esac
      case ",$2," in *",$a,"*) continue ;; esac
      exit 0
    done
    exit 1
  }
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

# colder at the garden right now than mintemp (open-meteo, like the rain): says the temperature. no answer counts as warm
# enough
too_cold() {
  set -- $(conf pos)
  [ -n "$2" ] || return 1
  w=$(wget -q -T 15 -O- "https://api.open-meteo.com/v1/forecast?latitude=$1&longitude=$2&current=temperature_2m" 2>/dev/null)
  temp=$(printf '%s' "$w" | grep -o '"current":{[^}]*}' | grep -o '"temperature_2m":-\{0,1\}[0-9.]*' | cut -d: -f2)
  [ -n "$temp" ] || return 1
  min=$(conf mintemp)
  awk -v t="$temp" -v m="${min:-5}" 'BEGIN { exit !(t < m) }' && echo "$temp"
}

# a json-rpc call over mqtt ($1 method, $2 params as json, $3 seconds to wait): the answer as one line, nothing without
# one
rpc_call() { mower_rpc "$host" "$1" "$2" "$3" | tr -d '\n'; }

# the leftovers setting from the app's settings (settings.cgi): "leftovers":{"auto":true,"min":0.5}
leftovers_conf() { grep -o '"leftovers":{[^}]*}' /data/settings.json 2>/dev/null | head -n1; }

# after a finished mow ($1: its job id): what its real track left unmowed, by the MowBite Planner on the mower
# (planner.leftovers), and when that's at least the m² set, the planner is armed and the mower started again once
# it's back in the dock: it drives only the passes over the leftovers then. not in the dark, the rain or with an
# emergency stop, like a start by schedule. the run for the leftovers doesn't get looked at itself
leftovers_after() {
  c=$(leftovers_conf)
  [ "$(field "$c" auto)" = true ] || return
  min=$(field "$c" min)
  # a planner that sends the mower out for the leftovers itself (its setting leftovers_auto): not twice
  case "$(rpc_call planner.settings '{}' 20)" in *'"leftovers_auto"'*) return ;; esac
  if [ -f "$LEFT" ]; then
    # the run that just finished was the one for the leftovers (a flag older than 6 h is a leftover itself)
    age=$(($(date +%s) - $(cat "$LEFT")))
    rm -f "$LEFT"
    [ "$age" -lt 21600 ] && return
  fi
  tz=$(conf tz)
  # without a schedule saved the time zone and the place come with the setting (the app adds them)
  [ -n "$tz" ] || tz=$(printf '%s' "$c" | grep -o '"tz":"[A-Za-z0-9<>+:,./-]*"' | cut -d'"' -f4)
  where=$(printf '%s' "$c" | grep -o '"pos":"-\{0,1\}[0-9.]* -\{0,1\}[0-9.]*"' | cut -d'"' -f4)
  # home first: the mower docks after the job, a start only works while it stands idle there
  t=$(($(date +%s) + 900))
  s=""
  while [ "$(date +%s)" -lt "$t" ]; do
    # shellcheck disable=SC2086
    s=$(mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -C 1 -W 10 2>/dev/null)
    [ "$(field "$s" current_state)" = IDLE ] && break
    sleep 10
  done
  if [ "$(field "$s" current_state)" != IDLE ]; then log leftovers_skip "$(field "$s" current_state)"; return; fi
  if [ "$(field "$s" emergency)" != 0 ]; then log leftovers_skip emergency; return; fi
  if [ "$(conf skiprain)" = 1 ] && [ "$(field "$s" rain_detected)" != 0 ]; then log leftovers_skip rain; return; fi
  if is_dark "$(minutes)"; then log leftovers_skip dark; return; fi
  r=$(rpc_call planner.leftovers "{\"job_id\":\"$1\"}" 240)
  if [ -z "$r" ] || printf '%s' "$r" | grep -q '"error"'; then log leftovers_failed; return; fi
  # m² left over all areas, from each area's stats.leftovers
  left=$(printf '%s' "$r" | grep -o '"leftovers": *{[^}]*}' | grep -o '"left_m2": *[0-9.eE+-]*' | cut -d: -f2 | awk '{ s += $1 } END { printf "%.2f", s }')
  if [ "$(echo "${left:-0} ${min:-0.5}" | awk '{ print ($1 >= $2 && $1 > 0) ? 1 : 0 }')" != 1 ]; then log leftovers_little "$left"; return; fi
  r=$(rpc_call planner.leftovers "{\"job_id\":\"$1\",\"arm\":true}" 240)
  if [ "$(echo "$(field "$r" armed)" | awk '{ print ($1 > 0) ? 1 : 0 }')" != 1 ]; then log leftovers_failed; return; fi
  # shellcheck disable=SC2086
  if mosquitto_pub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" -m "$ACTION_START_MOWING"; then
    date +%s > "$LEFT"
    log leftovers_started "$left"
    check_started &
  else
    log leftovers_failed
  fi
}

# every finished mow (JOB_COMPLETE, with the job's id) gets its leftovers looked at, while that's switched on
leftovers_watch() {
  while :; do
    host=$(find_broker)
    if [ -n "$host" ] && [ "$(field "$(leftovers_conf)" auto)" = true ]; then
      # shellcheck disable=SC2086
      timeout 86400 mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_EVENTS" | while read -r e; do
        [ "$(field "$e" type)" = JOB_COMPLETE ] || continue
        leftovers_after "$(field "$e" job_id)"
      done
    fi
    sleep 60
  done
}
LEFT=/tmp/leftovers.started
leftovers_watch &

last=""
until=0
endat=""
waited=""
areas=all
end=-
dark=-
sunset=-
fresh=-
angle=-
paused=""
while :; do
  if [ -f "$F" ] && [ "$(conf enabled)" = 1 ]; then
    tz=$(conf tz)
    now=$(TZ="$tz" date '+%u %H:%M %F')
    set -- $now
    # plan <days> <HH:MM> [areas] [end=HH:MM] [dark=1] [sunset=1] [fresh=1] [angle=<deg>]: areas, end time, dark,
    # sunset, fresh and the angle, - when not set
    due=$(awk -v d="$1" -v t="$2" '$1 == "plan" && $3 == t {
      n = split($2, a, ","); for (i = 1; i <= n; i++) if (a[i] == d) {
        ar = "all"; en = "-"; dk = "-"; ss = "-"; fr = "-"; an = "-"
        for (j = 4; j <= NF; j++) {
          if ($j ~ /^end=/) en = substr($j, 5); else if ($j == "dark=1") dk = 1
          else if ($j == "sunset=1") ss = 1; else if ($j == "fresh=1") fr = 1
          else if ($j ~ /^angle=/) an = substr($j, 7); else ar = $j
        }
        print ar, en, dk, ss, fr, an; exit } }' "$F")
    if [ -n "$due" ] && [ "$3 $2" != "$last" ]; then
      last="$3 $2"
      until=$(($(date +%s) + WAIT))
      waited=""
      set -- $due
      areas=$1 end=$2 dark=$3 sunset=$4 fresh=$5 angle=$6
      # when this start ends: its end time today, or tomorrow when that's not after the start
      endat=""
      if [ "$end" != - ]; then
        endat=$(stop_time "$end" - 1 | cut -d' ' -f1)
      fi
      # pause <YYYY-MM-DD> all|<area ids>: off up to and including that day, or those areas skipped
      paused=$(awk -v day="$(TZ="$tz" date +%F)" '$1 == "pause" && day <= $2 { print $3; exit }' "$F")
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
    if [ -n "$endat" ] && [ "$(date +%s)" -ge "$endat" ]; then
      log skip_end; until=0
    elif [ "$paused" = all ]; then
      log skip_paused; until=0
    elif [ -n "$paused" ] && host=$(find_broker) && [ -n "$host" ] && ! area_left "$areas" "$paused"; then
      log skip_paused; until=0
    elif [ -z "$s" ]; then
      [ "$(date +%s)" -gt "$until" ] && { log skip_offline; until=0; }
    elif [ "$(field "$s" emergency)" != 0 ]; then
      log skip_emergency; until=0
    elif [ "$(conf skiprain)" = 1 ] && [ "$(field "$s" rain_detected)" != 0 ]; then
      log skip_rain; until=0
    elif [ "$(conf skipforecast)" = 1 ] && rain_forecast; then
      log skip_forecast; until=0
    elif [ "$(conf skipcold)" = 1 ] && cold=$(too_cold); then
      log skip_cold "$cold"; until=0
    elif [ "$dark" != 1 ] && is_dark "$(minutes)"; then
      log skip_dark; until=0
    elif [ "$(field "$s" current_state)" != IDLE ]; then
      log skip_busy "$(field "$s" current_state)"; until=0
    elif [ "${bat:-0}" -lt "${minbat:-0}" ]; then
      if [ "$(date +%s)" -gt "$until" ]; then
        log skip_battery "$bat"; until=0
      elif [ -z "$waited" ]; then
        log waiting_battery "$bat"; waited=1
      fi
    else
      # the mowing direction of this start. one without its own gets the usual one back when other start times
      # have theirs: what the app keeps for the mower (params.sh), else what the mower had before a start turned it
      turn=""
      if [ "$angle" != - ]; then
        turn=$angle
        if [ ! -f "$NORMAL" ]; then
          # shellcheck disable=SC2086
          now=$(mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_PARAMS" -C 1 -W 10 2>/dev/null)
          now=$(field "$now" "$PARAM_MOW_ANGLE_OFFSET")
          [ -n "$now" ] && echo "$now" > "$NORMAL"
        fi
      elif grep -q '^plan .* angle=' "$F"; then
        turn=$(sed -n "s|^$PARAM_MOW_ANGLE_OFFSET ||p" /data/params.txt 2>/dev/null | head -n1)
        turn=${turn:-$(cat "$NORMAL" 2>/dev/null)}
        turn=${turn:-0}
        rm -f "$NORMAL"
      fi
      if [ -n "$turn" ]; then
        rpc_call "$RPC_SET_PARAMS" "{\"params\":{\"$PARAM_MOW_ANGLE_OFFSET\":$turn}}" 10 | grep -q '"result"' || log angle_failed "$turn"
      fi
      # an interrupted job is dropped first, so it begins with the first area. the mower only takes it while it
      # has one, otherwise nothing happens
      if [ "$fresh" = 1 ]; then
        # shellcheck disable=SC2086
        mosquitto_pub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" -m "$ACTION_RESET_JOB" && sleep 3
      fi
      # shellcheck disable=SC2086
      if mosquitto_pub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" -m "$ACTION_START_MOWING"; then
        log started "$bat"
        check_started &
        if [ "$areas" != all ] || [ -n "$paused" ]; then skip_others "$areas" "$paused" & fi
        # the end time of the start, not the next one from now (it may have waited for the battery)
        stop=$(stop_time "$end" "$sunset" "$dark" "$endat")
        [ -n "$stop" ] && send_home_at $stop &
      else
        log skip_offline
      fi
      until=0
    fi
  fi
  sleep 20
done
