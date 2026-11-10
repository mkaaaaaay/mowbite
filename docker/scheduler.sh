#!/bin/sh
# starts mowing at the times from the schedule page (/data/schedule.txt, written by schedule.cgi).
# a plan can name the areas to mow, the others get skipped when the mower gets to them.
# it only starts an idle mower without emergency, optionally not when its rain sensor is wet, rain
# is forecast or it's too cold, and waits up to two hours for the battery. not in the dark (sun times of the day at the garden,
# 6 pm to 6 am without a position) unless the plan says so. a run it started goes home at the plan's end time,
# and at sunset if the plan wants that. a plan can drop an interrupted job first so it begins with the first area,
# and it can be paused for some days, for all areas or some. a plan can have its own mowing direction (angle=<deg>),
# set on the mower before the start. no start while the MowBite Updater restarts OpenMower (its hold, retained), and it
# tells the updater when it may start next. what happened goes to /data/schedule.log for the page. on MowBite OS, which
# has a schedule of its own, it rests with its leftovers: no start, nothing told
. /broker.sh
. /openmower.sh
F=/data/schedule.txt
LOG=/data/schedule.log
# the mower's mowing direction before a start turned it, for the starts without their own
NORMAL=/data/angle.normal
WAIT=7200

# one line at a time, the runs in the background log too
log() {
  (
    flock 9
    echo "$(date +%s) $*" >> "$LOG"
    tail -n 100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  ) 9> /tmp/schedule.lock
}
# a plain value from compact or spaced out json, e.g. field "$state" current_state
field() { printf '%s' "$1" | grep -o "\"$2\" *: *[^,}]*" | head -n1 | sed 's/^[^:]*: *//' | tr -d '" '; }
conf() { sed -n "s/^$1 //p" "$F" | head -n1; }
# how full the battery is in %: battery.awk's while it's fresh, else OpenMower's from the robot state $1. at Done it
# counts as full, in the dock it goes down until the charger tops it up
battery() {
  lvl=$(cat /dev/shm/battery.level 2>/dev/null)
  case "$lvl" in
    [0-9]*' '[0-9]*' full') [ "$(($(date +%s) - ${lvl%% *}))" -le 120 ] && { echo 100; return; } ;;
    [0-9]*' '[0-9]*' '[a-z]*) [ "$(($(date +%s) - ${lvl%% *}))" -le 120 ] && { echo "$lvl" | cut -d' ' -f2; return; } ;;
  esac
  field "$1" battery_percentage | awk '{printf "%d", $1 * 100}'
}
# the areas of a map/json, one "id":"...","properties":{...} a line. objects in the properties (an area's planner
# settings) become null, so the properties end at their own brace. braces in strings (a name) are put aside meanwhile
map_areas() {
  tr -d ' \n' | awk 'BEGIN { FS = OFS = "\"" } {
    s = 0
    for (i = 2; i <= NF; i++) {
      # (a quote after an odd number of backslashes is part of the string)
      if (!s || !match($(i - 1), /\\+$/) || RLENGTH % 2 == 0) s = !s
      if (s && $i ~ /[{}]/) { gsub(/[{]/, "\001", $i); gsub(/[}]/, "\002", $i) }
    }
    print
  }' | sed -e 's/"properties":[{]/"properties":(/g' -e ':a' -e 's/\("[^"]*":\)[{][^{}]*[}]/\1null/g' -e 'ta' \
    -e 's/"properties":(/"properties":{/g' | grep -o '"id":"[^"]*","properties":{[^}]*}' | tr '\001\002' '{}'
}

# the pause of today as the file has it now: all, a list of area ids or nothing
paused_today() { awk -v day="$(TZ="$tz" date +%F)" '$1 == "pause" && day <= $2 { print $3; exit }' "$F" 2>/dev/null; }

# during a run this script started: skip every area the plan doesn't pick ($1: all or a list) and the ones
# paused for today (read again at every area, a pause set while it runs counts too), until the job is done (also
# across breaks for charging) or the next start. a run sent home at its end time keeps its job open, without
# stopping at the next start this would go on skipping the areas of the next plan or of a start by hand
skip_others() {
  timeout 86400 mosquitto_sub -h "$host" -p "$PORT" -v -t "${MOWER_MQTT_PREFIX}$TOPIC_EVENTS" \
    -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" | while read -r e; do
    case "$e" in *" $ACTION_START_MOWING") break ;; esac
    type=$(field "$e" type)
    case "$type" in
      # not on DOCKED: a run that docks to charge carries on afterwards, and it's still this run
      JOB_COMPLETE | JOB_RESET)
        rm -f "$RUN"
        break
        ;;
      SHUTDOWN) break ;;
      AREA)
        a=$(field "$e" area_id)
        p=$(paused_today)
        # the map as the mower has it now (retained), only its areas are skipped. a job resumed from
        # before a map change can name an area that isn't in it any more, that one is left alone.
        # inactive ones too (and ones it doesn't mow), the mower passes them by itself, and a skip
        # sent while it does would hit the next area instead
        props=$(mosquitto_sub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_MAP" -C 1 -W 5 2>/dev/null |
          map_areas | grep "^\"id\":\"$a\"," | head -n1)
        # skipped when the plan doesn't pick it (all or a list) or it's paused for today
        keep=1
        case ",$1," in ,all, | *",$a,"*) ;; *) keep=0 ;; esac
        case ",$p," in ,all, | *",$a,"*) keep=0 ;; esac
        [ "$keep" = 1 ] && continue
        if [ -z "$props" ]; then
          log unknown_area "$a"
          continue
        fi
        case "$props" in *'"active":false'* | *'"mowable":false'*) continue ;; esac
        mosquitto_pub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" -m "$ACTION_SKIP_AREA"
        case ",$p," in ,all, | *",$a,"*) log paused_area "$a" ;; *) log skipped_area "$a" ;; esac
        ;;
    esac
  done
}

# today's sunrise and sunset at the garden as minutes after local midnight, the NOAA formulas like
# src/lib/sun.ts. nothing without a position or when the sun doesn't rise or set
sun_today() {
  # shellcheck disable=SC2046
  set -- $(conf pos)
  # shellcheck disable=SC2086
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

# dark at this minute of the day: between sunset and sunrise, or 6 pm to 6 am without the sun times. a sunset after
# midnight comes before sunrise by the clock, then it's dark only between the two
is_dark() {
  # shellcheck disable=SC2046
  set -- "$1" $(sun_today) 360 1080
  if [ "$3" -le "$2" ]; then [ "$1" -ge "$3" ] && [ "$1" -lt "$2" ]; else [ "$1" -ge "$3" ] || [ "$1" -lt "$2" ]; fi
}

# HH:MM ($2) on the day $1 (YYYY-MM-DD) in the schedule's time zone as a unix time, a switch of summer time counted
local_time() { TZ="$tz" date -d "$1 $2" +%s; }

# the time a run started now has to be home by, as a unix time: the plan's end time (next one coming
# up, or $4 when it's known already), or the first sunset after the start when that comes earlier and the plan
# wants it, or has an end time without mowing in the dark being allowed. empty when neither
stop_time() {
  now=$(date +%s)
  midnight=$((now - $(minutes) * 60 - $(date +%S | sed 's/^0//')))
  stop=""
  if [ -n "$4" ]; then
    stop=$4
    why=end
  elif [ "$1" != - ]; then
    # by date and clock, a switch of summer time before it counts (tomorrow: the date 36 hours after midnight)
    stop=$(local_time "$(TZ="$tz" date +%F)" "$1")
    [ "$stop" -gt "$now" ] || stop=$(local_time "$(TZ="$tz" date -d "@$((midnight + 129600))" +%F)" "$1")
    why=end
  fi
  if [ "$2" = 1 ] || { [ "$3" != 1 ] && [ -n "$stop" ]; }; then
    # shellcheck disable=SC2046
    set -- $(sun_today) 360 1080
    # (sun_today counts by the clock as it is now, like midnight: right also on the day of a switch)
    dusk=$((midnight + $2 * 60))
    # a sunset after midnight (by the clock before sunrise) that's past: the next one is tomorrow's
    [ "$dusk" -gt "$now" ] || [ "$2" -gt "$1" ] || dusk=$((dusk + 86400))
    if [ "$dusk" -gt "$now" ] && { [ -z "$stop" ] || [ "$dusk" -lt "$stop" ]; }; then
      stop=$dusk
      why=dark
    fi
  fi
  [ -n "$stop" ] && echo "$stop $why"
}

# the stop time of the run started at $1 isn't to come any more (carried out, or a start ended the run)
stop_done() { rm -f "$DUE.$1"; }

# a run this script started: send it home at the stop time, and set OpenMower's own pause like going home does in its
# semi-automatic mode (manual_pause_mowing, params.set): a job still open (charging at the stop time, or in automatic
# mode) doesn't carry on by itself once the battery is full. the next start, by hand or by schedule, takes the pause
# off again. an OpenMower without params.set: for 12 hours it's sent home again whenever it starts mowing, until
# someone starts it by hand or the job is done. a start before the stop time ends it too, that's another run then (the
# next plan, or by hand after this one was sent home) with its own end
send_home_at() {
  echo "$1" > "$STOP"
  topics="-t ${MOWER_MQTT_PREFIX}$TOPIC_EVENTS -t ${MOWER_MQTT_PREFIX}$TOPIC_ACTION"
  while [ "$(date +%s)" -lt "$1" ]; do
    # waits for a message until the stop time at most, so it goes home on time. a broker that isn't there
    # fails right away, then it waits a bit instead of trying over and over
    w=$(($1 - $(date +%s)))
    [ "$w" -gt 60 ] && w=60
    [ "$w" -lt 1 ] && w=1
    t=$(date +%s)
    e=$(mosquitto_sub -h "$host" -p "$PORT" $topics -v -C 1 -W "$w" 2>/dev/null) ||
      { [ $(($(date +%s) - t)) -lt 1 ] && sleep 5; }
    case "$e" in *" $ACTION_START_MOWING") stop_done "$3"; return ;; esac
    case "$(field "$e" type)" in JOB_COMPLETE | SHUTDOWN) return ;; esac
  done
  stop_done "$3"
  logged=""
  s=$(mosquitto_sub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -C 1 -W 10 2>/dev/null)
  if [ "$(field "$s" current_state)" = MOWING ]; then
    mosquitto_pub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" -m "$ACTION_HOME" && log "stopped_$2" && logged=1
  fi
  if rpc_call "$RPC_SET_PARAMS" '{"params":{"/mower_logic/manual_pause_mowing":true}}' 10 | grep -q '"result"'; then
    [ -n "$logged" ] || log "stopped_$2"
    return
  fi
  while [ "$(date +%s)" -lt "$(($1 + 43200))" ]; do
    s=$(mosquitto_sub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -C 1 -W 10 2>/dev/null)
    if [ "$(field "$s" current_state)" = MOWING ]; then
      mosquitto_pub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" -m "$ACTION_HOME" &&
        log "$([ -z "$logged" ] && echo "stopped_$2" || echo stopped_again)"
      logged=1
    fi
    m=$(mosquitto_sub -h "$host" -p "$PORT" $topics -v -C 1 -W 30 2>/dev/null) || sleep 5
    case "$m" in *" $ACTION_START_MOWING") return ;; esac
    [ "$(field "$m" type)" = JOB_COMPLETE ] && return
  done
}

# what happened to the start that's due, with its time from the plan (at=HH:MM): logged later than that, after the
# wait for the battery say
slog() { log "$@" "at=$dtime"; }

# MowBite OS says why it turns a start down (MOWING_REFUSED, its reason a fixed name), right away: listened for before
# the start goes out
REFUSED=/tmp/start.refused
listen_refused() {
  rm -f "$REFUSED"
  mosquitto_sub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_EVENTS" -W 65 2>/dev/null | grep -m1 MOWING_REFUSED > "$REFUSED" &
  sleep 1
}

# the reason and the value it's about in the log: the battery, the position's accuracy or what it was busy with ($1: the
# start's time from the plan)
log_refused() {
  m=$(cat "$REFUSED" 2>/dev/null)
  why=$(field "$m" reason)
  case "$why" in '' | *[!A-Z0-9_]*) why="" ;; esac
  case "$why" in
    BATTERY_LOW) v=$(field "$m" battery_voltage) ;;
    POSITION_ACCURACY) v=$(field "$m" accuracy) ;;
    BUSY) v=$(field "$m" state) ;;
    *) v="" ;;
  esac
  # shellcheck disable=SC2086
  log start_refused $why $v ${1:+"at=$1"}
}

# a start that went out only says the broker took it ($1: its time from the plan, none for the leftovers'). the mower
# answers by leaving IDLE (undocking), when it doesn't within a minute that's logged, the page would say started otherwise
check_started() {
  at=$1
  t=$(($(date +%s) + 60))
  while [ "$(date +%s)" -lt "$t" ]; do
    [ -s "$REFUSED" ] && { log_refused "$at"; return; }
    s=$(mosquitto_sub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -C 1 -W 10 2>/dev/null)
    case "$(field "$s" current_state)" in '' | IDLE) sleep 2 ;; *) return ;; esac
  done
  if [ -s "$REFUSED" ]; then log_refused "$at"; else log start_failed ${at:+"at=$at"}; fi
}

# does the run have an area left: mowed ones in the map (retained) the plan picks ($1: all or a list) and
# that aren't paused ($2). when the map can't be read it's left to the run
area_left() {
  m=$(mosquitto_sub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_MAP" -C 1 -W 5 2>/dev/null | tr -d ' \n')
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

# rain right now or in the next hour(s) at the garden (open-meteo, position rounded to ~1 km).
# no answer counts as no rain
rain_forecast() {
  # shellcheck disable=SC2046
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
  # shellcheck disable=SC2046
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

# whether the MowBite Updater holds the starts right now (it's about to restart OpenMower): its hold's end is still to
# come and at most 30 minutes away, a later one is none of its own. its hold ends by itself when the updater stops
held() {
  [ -n "$host" ] || return 1
  hold=$(mosquitto_sub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_HOLD" -C 1 -W 2 2>/dev/null |
    grep -o '"until": *[0-9]*' | grep -o '[0-9]*$')
  [ -n "$hold" ] && [ "$hold" -gt "$(date +%s)" ] && [ "$hold" -le "$(($(date +%s) + 1800))" ]
}

# the next start of the schedule from now as unix time, by day and time only (a start in this minute is the one
# after it): the rest is only known when it's due
next_start() {
  # shellcheck disable=SC2046
  set -- $(TZ="$tz" date '+%u %H %M %S %s')
  awk -v now="$((($1 - 1) * 1440 + ${2#0} * 60 + ${3#0}))" -v at="$(($5 - ${4#0}))" '$1 == "plan" {
    split($3, hm, ":"); n = split($2, d, ",")
    for (i = 1; i <= n; i++) {
      m = ((d[i] - 1) * 1440 + hm[1] * 60 + hm[2] - now + 10080) % 10080
      if (m == 0) m = 10080
      if (best == "" || m < best) best = m
    }
  } END { if (best != "") print at + best * 60 }' "$F"
}
# when the schedule may start next, for the MowBite Updater (no OpenMower update in the 30 minutes before): a start
# waiting for the battery from when it was due until its wait is over, else the next start time. nothing without a
# schedule on. sent when it changed, and every 10 minutes for a broker started anew
told=""
told_at=0
tell_next() {
  if [ "$until" -gt 0 ]; then
    n="{\"from\":$due_at,\"to\":$until}"
  elif [ -f "$F" ] && [ "$(conf enabled)" = 1 ] && t=$(next_start) && [ -n "$t" ]; then
    n="{\"from\":$t,\"to\":$t}"
  else
    n=""
  fi
  [ "$n" = "$told" ] && [ $(($(date +%s) - told_at)) -lt 600 ] && return
  host=$(find_broker)
  [ -n "$host" ] || return
  os_does "$host" schedule && return
  if [ -n "$n" ]; then
    mosquitto_pub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_SCHEDULE_NEXT" -r -m "$n" 2>/dev/null || return
  else
    mosquitto_pub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_SCHEDULE_NEXT" -r -n 2>/dev/null || return
  fi
  told=$n told_at=$(date +%s)
}

# the leftovers setting from the app's settings (settings.cgi): "leftovers":{"auto":true,"min":0.5}
leftovers_conf() { grep -o '"leftovers":{[^}]*}' /data/settings.json 2>/dev/null | head -n1; }

# after a finished mow ($1: its job id): what its real track left unmowed, by the MowBite Planner on the mower
# (planner.leftovers), and when that's at least the m² set, the planner is armed and the mower started again once
# it's back in the dock and its battery full again (the schedule's least battery when set, else 90 %, at most 6 hours
# later): it drives only the passes over the leftovers then. not in the dark, the rain or the cold, with an emergency
# stop, on a day paused or after the end time of the run, like a start by schedule. the run for the leftovers doesn't
# get looked at itself
leftovers_after() {
  c=$(leftovers_conf)
  [ "$(field "$c" auto)" = true ] || return
  os_does "$host" schedule && return
  min=$(field "$c" min)
  # a planner that sends the mower out for the leftovers itself (its setting leftovers_auto on): not twice
  printf '%s' "$(rpc_call planner.settings '{}' 20)" | grep -o '"leftovers_auto": *{[^}]*}' | grep -q '"value": *true' && return
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
    s=$(mosquitto_sub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -C 1 -W 10 2>/dev/null)
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
  # a start by hand doesn't wait for the battery in OpenMower: waited for here, still in the dock and without anyone
  # starting it meanwhile
  need=$(conf minbattery)
  case "$need" in '' | 0 | *[!0-9]*) need=90 ;; esac
  t=$(($(date +%s) + 21600))
  waited=""
  while :; do
    s=$(mosquitto_sub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -C 1 -W 10 2>/dev/null)
    if [ "$(field "$s" current_state)" != IDLE ]; then log leftovers_skip "$(field "$s" current_state)"; return; fi
    bat=$(battery "$s")
    [ "${bat:-0}" -ge "$need" ] && break
    if [ "$(date +%s)" -ge "$t" ]; then log leftovers_skip battery "$bat"; return; fi
    [ -n "$waited" ] || { log leftovers_waiting_battery "$bat"; waited=1; }
    sleep 60
  done
  # what counts for a start by schedule, now that it would start
  if [ "$(field "$s" emergency)" != 0 ]; then log leftovers_skip emergency; return; fi
  if [ "$(conf skiprain)" = 1 ] && [ "$(field "$s" rain_detected)" != 0 ]; then log leftovers_skip rain; return; fi
  if is_dark "$(minutes)"; then log leftovers_skip dark; return; fi
  stop=$(cat "$STOP" 2>/dev/null)
  if [ -n "$stop" ] && [ "$(date +%s)" -ge "$stop" ] && [ "$(($(date +%s) - stop))" -lt 43200 ]; then log leftovers_skip end; return; fi
  if [ -f "$F" ] && [ "$(awk -v day="$(TZ="$tz" date +%F)" '$1 == "pause" && day <= $2 { print $3; exit }' "$F")" = all ]; then
    log leftovers_skip paused
    return
  fi
  if [ "$(conf skipforecast)" = 1 ] && rain_forecast; then log leftovers_skip forecast; return; fi
  if [ "$(conf skipcold)" = 1 ] && cold=$(too_cold); then log leftovers_skip cold "$cold"; return; fi
  if held; then log leftovers_skip hold; return; fi
  r=$(rpc_call planner.leftovers "{\"job_id\":\"$1\",\"arm\":true}" 240)
  if [ "$(echo "$(field "$r" armed)" | awk '{ print ($1 > 0) ? 1 : 0 }')" != 1 ]; then log leftovers_failed; return; fi
  # (the updater's hold once more after the planner's answer, which may take minutes. what's armed runs out by itself)
  if held; then log leftovers_skip hold; return; fi
  listen_refused
  if mosquitto_pub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" -m "$ACTION_START_MOWING"; then
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
      timeout 86400 mosquitto_sub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_EVENTS" | while read -r e; do
        [ "$(field "$e" type)" = JOB_COMPLETE ] || continue
        leftovers_after "$(field "$e" job_id)"
      done
    fi
    sleep 60
  done
}
LEFT=/tmp/leftovers.started
# the stop time of the run this script started last (send_home_at), for the leftovers after it
STOP=/tmp/run.stop
# kept over a restart of the container (an update while the mower charges in the middle of a run): the run this script
# started ("<started> <stop>|- <why>|- <areas>"), and a start waiting for the battery ("<until> <day> <HH:MM> <date>
# <end>|-"). both go when they're over. only the main loop writes them, and run.due.<started> (empty): there while that
# run's stop time is to come
RUN=/data/run.state
WAITING=/data/run.wait
DUE=/data/run.due
leftovers_watch &

# the mowing direction the app keeps for the mower (params.sh), while keeping is on
kept_angle() { grep -q '^enabled 1' /data/params.txt 2>/dev/null && sed -n "s|^$PARAM_MOW_ANGLE_OFFSET ||p" /data/params.txt | head -n1; }

# a job still open: the mower out (or charging in the middle of it), or idle with one left unfinished. after a start
# the actions come group by group (from []), the list is read again until it has the idle ones, a few seconds at most
run_open() {
  s=$(mosquitto_sub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -C 1 -W 10 2>/dev/null)
  [ -n "$s" ] || return 1
  [ "$(field "$s" current_state)" != IDLE ] && return 0
  for _ in 1 2 3 4 5; do
    a=$(mosquitto_sub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTIONS" -C 1 -W 5 2>/dev/null | tr -d ' \n')
    case "$a" in '' | *"\"${ACTION_RESET_JOB%/*}/"*) break ;; esac
    sleep 1
  done
  a=$(printf '%s' "$a" | tr '}' '\n' | grep "\"$ACTION_RESET_JOB\"")
  case "$a" in *'"enabled":1'* | *'"enabled":true'*) return 0 ;; esac
  return 1
}

# the run of before a restart: its areas skipped again and sent home at its time, while its job is still open. a stop
# time that passed meanwhile is carried out now, if its run.due is still there
restore_run() {
  # shellcheck disable=SC2034
  read -r at stop why areas < "$RUN" || return
  tz=$(conf tz)
  for _ in $(seq 30); do
    host=$(find_broker)
    [ -n "$host" ] && break
    sleep 10
  done
  # (a day old by the clock after the wait: a mower switched on after months may set its clock only meanwhile)
  if [ -z "$host" ] || [ $(($(date +%s) - ${at:-0})) -ge 86400 ] || ! run_open; then
    rm -f "$RUN"
    return
  fi
  # a start since then is another run, with its own
  [ "$(cut -d' ' -f1 "$RUN" 2>/dev/null)" = "$at" ] || return
  skip_others "$areas" &
  [ "$stop" != - ] && { [ "$stop" -gt "$(date +%s)" ] || [ -f "$DUE.$at" ]; } && send_home_at "$stop" "$why" "$at" &
}
[ -f "$RUN" ] && restore_run &

# a mowing direction of its own taken out of every plan, or the schedule switched off: the usual one back once the
# mower is idle without a job open, not only at the next start. tried every ten minutes
angle_tried=0
angle_back() {
  [ $(($(date +%s) - angle_tried)) -ge 600 ] || return
  angle_tried=$(date +%s)
  host=$(find_broker)
  [ -n "$host" ] && ! run_open || return
  turn=$(kept_angle)
  turn=${turn:-$(cat "$NORMAL" 2>/dev/null)}
  rpc_call "$RPC_SET_PARAMS" "{\"params\":{\"$PARAM_MOW_ANGLE_OFFSET\":${turn:-0}}}" 10 | grep -q '"result"' && rm -f "$NORMAL"
}

# the plan of a start (day 1-7, HH:MM) as the file has it: "areas end dark sunset fresh angle", - for what's not set.
# nothing when there's none then. plan <days> <HH:MM> [areas] [end=HH:MM] [dark=1] [sunset=1] [fresh=1] [angle=<deg>]
plan_at() {
  awk -v d="$1" -v t="$2" '$1 == "plan" && $3 == t {
    n = split($2, a, ","); for (i = 1; i <= n; i++) if (a[i] == d) {
      ar = "all"; en = "-"; dk = "-"; ss = "-"; fr = "-"; an = "-"
      for (j = 4; j <= NF; j++) {
        if ($j ~ /^end=/) en = substr($j, 5); else if ($j == "dark=1") dk = 1
        else if ($j == "sunset=1") ss = 1; else if ($j == "fresh=1") fr = 1
        else if ($j ~ /^angle=/) an = substr($j, 7); else ar = $j
      }
      print ar, en, dk, ss, fr, an; exit } }' "$F"
}

last=""
until=0
due_at=0
endat=""
waited=""
hwaited=""
dday=""
dtime=""
areas=all
end=-
dark=-
sunset=-
fresh=-
angle=-
paused=""
# a start that was waiting for the battery when the container restarted waits on
if [ -f "$WAITING" ]; then
  read -r u dday dtime ddate e < "$WAITING"
  if [ "${u:-0}" -gt "$(date +%s)" ]; then
    until=$u last="$ddate $dtime" waited=1 due_at=$(date +%s)
    [ "$e" = - ] || endat=$e
  else
    rm -f "$WAITING"
  fi
fi
while :; do
  if [ -f "$F" ] && [ "$(conf enabled)" = 1 ]; then
    tz=$(conf tz)
    now=$(TZ="$tz" date '+%u %H:%M %F')
    # shellcheck disable=SC2086
    set -- $now
    due=$(plan_at "$1" "$2")
    if [ -n "$due" ] && [ "$3 $2" != "$last" ]; then
      last="$3 $2"
      due_at=$(date +%s)
      until=$((due_at + WAIT))
      waited=""
      hwaited=""
      dday=$1 dtime=$2 ddate=$3
      # shellcheck disable=SC2086
      set -- $due
      # when this start ends: its end time today, or tomorrow when that's not after the start
      endat=""
      if [ "$2" != - ]; then
        endat=$(stop_time "$2" - 1 | cut -d' ' -f1)
      fi
      echo "$until $dday $dtime $ddate ${endat:--}" > "$WAITING"
    fi
  else
    until=0
  fi

  if [ "$until" -gt 0 ]; then
    # the plan and the pause as they are now, changed while it waits for the battery: a start time taken out or
    # moved isn't started any more
    cur=$(plan_at "$dday" "$dtime")
    # shellcheck disable=SC2086
    [ -n "$cur" ] && set -- $cur && areas=$1 end=$2 dark=$3 sunset=$4 fresh=$5 angle=$6
    paused=$(paused_today)
    host=$(find_broker)
    s=$([ -n "$host" ] && mosquitto_sub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_ROBOT_STATE" -C 1 -W 10 2>/dev/null)
    bat=$(battery "$s")
    minbat=$(conf minbattery)
    if [ -n "$host" ] && os_does "$host" schedule; then
      until=0
    elif [ -z "$cur" ]; then
      slog skip_gone; until=0
    elif [ -n "$endat" ] && [ "$(date +%s)" -ge "$endat" ]; then
      slog skip_end; until=0
    elif [ "$paused" = all ]; then
      slog skip_paused; until=0
    # a plan for some areas: one of them still has to be in the map, mowed and not paused
    elif { [ -n "$paused" ] || [ "$areas" != all ]; } && [ -n "$host" ] && ! area_left "$areas" "$paused"; then
      if [ -n "$paused" ] && area_left "$areas" ""; then slog skip_paused; else slog skip_no_area; fi
      until=0
    elif [ -z "$s" ]; then
      [ "$(date +%s)" -gt "$until" ] && { slog skip_offline; until=0; }
    elif [ "$(field "$s" emergency)" != 0 ]; then
      slog skip_emergency; until=0
    elif [ "$(conf skiprain)" = 1 ] && [ "$(field "$s" rain_detected)" != 0 ]; then
      slog skip_rain; until=0
    elif [ "$dark" != 1 ] && is_dark "$(minutes)"; then
      slog skip_dark; until=0
    elif [ "$(field "$s" current_state)" != IDLE ]; then
      slog skip_busy "$(field "$s" current_state)"; until=0
    elif [ "${bat:-0}" -lt "${minbat:-0}" ]; then
      if [ "$(date +%s)" -gt "$until" ]; then
        slog skip_battery "$bat"; until=0
      elif [ -z "$waited" ]; then
        slog waiting_battery "$bat"; waited=1
      fi
    # the MowBite Updater restarts OpenMower right now: started once it's done, within the wait for the battery
    elif held; then
      if [ "$(date +%s)" -gt "$until" ]; then
        slog skip_hold; until=0
      elif [ -z "$hwaited" ]; then
        slog waiting_hold; hwaited=1
      fi
    # the forecast and the temperature for when it really starts: asked for once, when the battery is enough
    elif [ "$(conf skipforecast)" = 1 ] && rain_forecast; then
      slog skip_forecast; until=0
    elif [ "$(conf skipcold)" = 1 ] && cold=$(too_cold); then
      slog skip_cold "$cold"; until=0
    else
      # the mowing direction of this start. one without its own gets the usual one back after one with its own: what
      # the app keeps for the mower (params.sh), else what the mower had before a start turned it
      turn=""
      mower_params=""
      if [ "$angle" != - ] || [ -f "$NORMAL" ]; then
        mower_params=$(mosquitto_sub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_PARAMS" -C 1 -W 10 2>/dev/null)
      fi
      usual=$(field "$mower_params" "$PARAM_MOW_ANGLE_OFFSET")
      if [ -n "$mower_params" ] && [ -z "$usual" ]; then
        # a mower without mower_logic's mowing direction (MowBite OS, its planner turns the lanes): nothing to turn
        rm -f "$NORMAL"
      elif [ "$angle" != - ]; then
        turn=$angle
        [ ! -f "$NORMAL" ] && [ -n "$usual" ] && echo "$usual" > "$NORMAL"
      elif [ -f "$NORMAL" ]; then
        turn=$(kept_angle)
        turn=${turn:-$(cat "$NORMAL" 2>/dev/null)}
        turn=${turn:-0}
        rm -f "$NORMAL"
      fi
      if [ -n "$turn" ]; then
        rpc_call "$RPC_SET_PARAMS" "{\"params\":{\"$PARAM_MOW_ANGLE_OFFSET\":$turn}}" 10 | grep -q '"result"' || slog angle_failed "$turn"
      fi
      # an interrupted job is dropped first, so it begins with the first area. the mower only takes it while it
      # has one, otherwise nothing happens
      if [ "$fresh" = 1 ]; then
        mosquitto_pub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" -m "$ACTION_RESET_JOB" && sleep 3
      fi
      # the updater's hold asked for once more right before (the mowing direction took a while): looked at again in 20 s
      # shellcheck disable=SC2086
      if held; then
        [ -n "$hwaited" ] || { slog waiting_hold; hwaited=1; }
      elif listen_refused && mosquitto_pub -h "$host" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_ACTION" -m "$ACTION_START_MOWING"; then
        slog started "$bat"
        check_started "$dtime" &
        # the end time of the start, not the next one from now (it may have waited for the battery)
        stop=$(stop_time "$end" "$sunset" "$dark" "$endat")
        began=$(date +%s)
        echo "$began ${stop:-- -} $areas" > "$RUN"
        rm -f "$DUE".*
        [ -n "$stop" ] && : > "$DUE.$began"
        # always: a pause set while it runs counts too
        skip_others "$areas" &
        # shellcheck disable=SC2086
        [ -n "$stop" ] && send_home_at $stop "$began" &
        until=0
      else
        slog skip_offline
        until=0
      fi
    fi
    [ "$until" -gt 0 ] || rm -f "$WAITING"
  elif [ -f "$NORMAL" ] && ! { [ -f "$F" ] && [ "$(conf enabled)" = 1 ] && grep -q '^plan .* angle=' "$F"; }; then
    angle_back
  fi
  tell_next
  sleep 20
done
