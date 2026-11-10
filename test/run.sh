#!/bin/bash
# the container's scripts without a mower: the scheduler against a pretend one (test/case.sh) on a broker of the test's
# own, the version the mower has, and the cgis through busybox httpd the way the app asks them.
# test/run.sh [image]: without an image the one from here is built first. needs docker and curl, takes about two minutes
set -u
cd "$(dirname "$0")/.." || exit 1
IMAGE=${1:-mowbite:test}
if [ -z "${1:-}" ]; then
  echo "building $IMAGE"
  docker build -q -t "$IMAGE" . > /dev/null || exit 1
fi
BROKER=eclipse-mosquitto:2.1.2-alpine
NET=mbt-net
# what the test starts carries this label and goes again at the end
LABEL=mowbite-test=1

pass=0
fail=0
ok() {
  pass=$((pass + 1))
  echo "ok   $1"
}
bad() {
  fail=$((fail + 1))
  echo "FAIL $1"
  [ -z "${2:-}" ] || printf '%s\n' "$2" | sed 's/^/     /'
}
expect() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "got: $2"; fi; }

cleanup() {
  docker ps -aq --filter "label=$LABEL" | xargs -r docker rm -fv > /dev/null
  docker network rm "$NET" > /dev/null 2>&1
}
trap cleanup EXIT
cleanup
docker network create --label "$LABEL" "$NET" > /dev/null || exit 1
docker run -d --name mbt-mq --label "$LABEL" --network "$NET" "$BROKER" mosquitto -c /mosquitto-no-auth.conf > /dev/null || exit 1

# --- the scheduler ---

# a time zone where it's about noon now and one where it's about midnight: without the garden's position 6 am to 6 pm
# is day for the scheduler, whatever time the test runs at
h=$((10#$(date -u +%H)))
zone() {
  o=$((($1 - h + 36) % 24 - 12))
  if [ $o -ge 0 ]; then echo "TST-$o"; else echo "TST+$((-o))"; fi
}
DAY=$(zone 12)
NIGHT=$(zone 0)
dow() { TZ=$1 date -d "+${2:-0} min" +%u; }
hm() { TZ=$1 date -d "+${2:-0} min" +%H:%M; }
day() { TZ=$1 date -d "${2:-today}" +%F; }
base() { printf 'enabled 1\nminbattery %s\nskiprain 1\nskipforecast 0\ntz %s\n' "${MINBAT:-0}" "$1"; }
state() {
  printf '{"current_state":"%s","emergency":%s,"rain_detected":%s,"battery_percentage":%s}' "${1:-IDLE}" "${2:-0}" "${3:-0}" "${4:-0.9}"
}
# start <case> <robot state> <schedule> [VAR=value ...]: the case's scheduler with its pretend mower, under its own prefix
start() {
  local name=$1 st=$2 sched=$3 e envs=()
  shift 3
  for e in "$@"; do envs+=(-e "$e"); done
  docker run -d --name "mbt-$name" --label "$LABEL" --network "$NET" -v "$PWD/test:/t:ro" \
    -e MOWER_MQTT_HOST=mbt-mq -e "MOWER_MQTT_PREFIX=$name/" -e "STATE=$st" -e "SCHED=$sched" "${envs[@]}" \
    --entrypoint sh "$IMAGE" /t/case.sh > /dev/null
}
# what case $1's scheduler logged (without the times) and what its mower got
slog() { docker exec "mbt-$1" cat /data/schedule.log 2> /dev/null | cut -d' ' -f2-; }
sent() { docker exec "mbt-$1" cat /tmp/sent 2> /dev/null; }
# the stop times case $1 keeps as still to come, and nodue <case> <seconds>: until it keeps none
due() { docker exec "mbt-$1" sh -c 'ls /data/run.due.*' 2> /dev/null; }
nodue() {
  local i
  for ((i = 0; i < $2; i++)); do
    [ -z "$(due "$1")" ] && return 0
    sleep 1
  done
  return 1
}
# waitlog <case> <regex> <seconds>: until the case's log has a line like that
waitlog() {
  local i
  for ((i = 0; i < $3; i += 2)); do
    slog "$1" | grep -qE "$2" && return 0
    sleep 2
  done
  return 1
}
# what case $1's mower got, until a line like $2 came, at most $3 s
gets() {
  local i
  for ((i = 0; i < ${3:-15}; i++)); do
    sent "$1" | grep -qE "$2" && return 0
    sleep 1
  done
  return 1
}
# logs <test> <case> <regex> [seconds]
logs() {
  if waitlog "$2" "$3" "${4:-30}"; then ok "$1"; else bad "$1" "log: $(slog "$2" | tr '\n' '|') sent: $(sent "$2" | tr '\n' '|')"; fi
}

until docker exec mbt-mq mosquitto_pub -h localhost -t up -m 1 2> /dev/null; do sleep 0.5; done
# the plans are for this minute, they all start well within it
while [ $((10#$(date +%S))) -gt 40 ]; do sleep 1; done
D=$(dow "$DAY") M=$(hm "$DAY") DN=$(dow "$NIGHT") MN=$(hm "$NIGHT")
AREAS='{"areas":[{"id":"front","properties":{"type":"mow"},"outline":[]},{"id":"back","properties":{"type":"mow"},"outline":[]}]}'
start start "$(state)" "$(base "$DAY")"$'\n'"plan $D $M"
start disabled "$(state)" "$(base "$DAY" | sed 's/^enabled 1/enabled 0/')"$'\n'"plan $D $M"
start otherday "$(state)" "$(base "$DAY")"$'\n'"plan $((D % 7 + 1)) $M"
start dark "$(state)" "$(base "$NIGHT")"$'\n'"plan $DN $MN"
start darkok "$(state)" "$(base "$NIGHT")"$'\n'"plan $DN $MN dark=1"
start emergency "$(state IDLE 1)" "$(base "$DAY")"$'\n'"plan $D $M"
start rain "$(state IDLE 0 1)" "$(base "$DAY")"$'\n'"plan $D $M"
start busy "$(state MOWING)" "$(base "$DAY")"$'\n'"plan $D $M"
start paused "$(state)" "$(base "$DAY")"$'\n'"plan $D $M"$'\n'"pause $(day "$DAY") all"
start pausedbefore "$(state)" "$(base "$DAY")"$'\n'"plan $D $M"$'\n'"pause $(day "$DAY" yesterday) all"
start battery "$(state IDLE 0 0 0.5)" "$(MINBAT=80 base "$DAY")"$'\n'"plan $D $M"
start fresh "$(state)" "$(base "$DAY")"$'\n'"plan $D $M fresh=1"
start angle "$(state)" "$(base "$DAY")"$'\n'"plan $D $M angle=30" 'PARAMS={"/mower_logic/mow_angle_offset":5}'
start stays "$(state)" "$(base "$DAY")"$'\n'"plan $D $M" MOWER=stays
start refused "$(state)" "$(base "$DAY")"$'\n'"plan $D $M" MOWER=refuses
start areas "$(state)" "$(base "$DAY")"$'\n'"plan $D $M front" "MAP=$AREAS" AREA=back
start pausedarea "$(state)" "$(base "$DAY")"$'\n'"plan $D $M"$'\n'"pause $(day "$DAY") back" "MAP=$AREAS" AREA=back
start pausedareas "$(state)" "$(base "$DAY")"$'\n'"plan $D $M front"$'\n'"pause $(day "$DAY") front" "MAP=$AREAS"
start endtime "$(state)" "$(base "$DAY")"$'\n'"plan $D $M end=$(hm "$DAY" 1)"
start endkept "$(state)" "$(base "$DAY")"$'\n'"plan $D $M end=$(hm "$DAY" 10)"
start endlate "$(state IDLE 0 0 0.5)" "$(MINBAT=80 base "$DAY")"$'\n'"plan $D $M end=$(hm "$DAY" 1)"
start noarea "$(state)" "$(base "$DAY")"$'\n'"plan $D $M gone" "MAP=$AREAS"
# braces in the areas' names: the plan's area is found, an inactive one isn't skipped
BRACES='{"areas":[{"id":"front","properties":{"name":"Beet }","type":"mow"},"outline":[]},{"id":"back","properties":{"name":"{Rand}","type":"mow","active":false},"outline":[]}]}'
start braces "$(state)" "$(base "$DAY")"$'\n'"plan $D $M front" "MAP=$BRACES" AREA=back
start gone "$(state IDLE 0 0 0.5)" "$(MINBAT=80 base "$DAY")"$'\n'"plan $D $M"
# MowBite OS with its own schedule and its own store of the parameters
OS_METHODS='{"jsonrpc":"2.0","result":["rpc.methods","system.info","schedule.get"],"id":"@ID@"}'
OS_INFO='{"jsonrpc":"2.0","result":{"name":"mowbite-os","version":"0.1"},"id":"@ID@"}'
start os "$(state)" "$(base "$DAY")"$'\n'"plan $D $M" "METHODS=$OS_METHODS" "INFO=$OS_INFO"
# from before a restart of the container: a run of a plan for the front, a start waiting for the battery (its plan an
# hour ago), the mowing direction of a plan that has none any more
start restored "$(state MOWING)" "$(base "$DAY")" "MAP=$AREAS" "RUN_STATE=$(date +%s) - - front" AREA_SOON=back
start waited "$(state)" "$(base "$DAY")"$'\n'"plan $(dow "$DAY" -60) $(hm "$DAY" -60)" \
  "WAITING=$(($(date +%s) + 600)) $(dow "$DAY" -60) $(hm "$DAY" -60) $(day "$DAY") -"
start angleback "$(state)" "$(base "$DAY")"$'\n'"plan $((D % 7 + 1)) $M" ANGLE_NORMAL=7
# the MowBite Updater's hold: one that ends soon, one too far ahead to be its own
start held "$(state)" "$(base "$DAY")"$'\n'"plan $D $M" "HOLD={\"until\":$(($(date +%s) + 600))}"
start heldfar "$(state)" "$(base "$DAY")"$'\n'"plan $D $M" "HOLD={\"until\":$(($(date +%s) + 7200))}"
start waitnext "$(state IDLE 0 0 0.5)" "$(MINBAT=80 base "$DAY")"$'\n'"plan $D $M"
# idle with the job of the run from before the restart still open, while actions/json grows the way OpenMower and
# MowBite OS send it after a start: empty, then mower_logic's own group, the idle one last
ROOT='{"action_id":"mower_logic/reset_emergency","action_name":"Reset Emergency","enabled":0}'
IDLE='{"action_id":"mower_logic:idle/start_mowing","action_name":"Start Mowing","enabled":1},{"action_id":"mower_logic:idle/reset_job","action_name":"Reset Job","enabled":1}'
start growing "$(state)" "$(base "$DAY")" "MAP=$AREAS" "RUN_STATE=$(date +%s) - - front" AREA_SOON=back \
  "ACTIONS=[]"$'\n'"[]"$'\n'"[$ROOT]"$'\n'"[$ROOT,$IDLE]"
# a run whose stop time passed during the restart, still to come before it: out mowing, and idle with its job done
past=$(($(date +%s) - 60))
start restoredlate "$(state MOWING)" "$(base "$DAY")" "RUN_STATE=$((past - 600)) $past end front" RUN_DUE=1
start restoreddone "$(state)" "$(base "$DAY")" "RUN_STATE=$((past - 600)) $past end front" RUN_DUE=1

logs "scheduler: starts at the time of a plan" start '^started 90( at=[0-9:]+)?$'
gets start '^action mower_logic:idle/start_mowing$' && ok "scheduler: the mower got the start" ||
  bad "scheduler: the mower got the start" "$(sent start)"
logs "scheduler: not in the dark" dark '^skip_dark( at=[0-9:]+)?$'
logs "scheduler: in the dark with dark=1" darkok '^started'
logs "scheduler: not with the emergency stop" emergency '^skip_emergency( at=[0-9:]+)?$'
logs "scheduler: not with the rain sensor wet" rain '^skip_rain( at=[0-9:]+)?$'
logs "scheduler: not while the mower is busy" busy '^skip_busy MOWING( at=[0-9:]+)?$'
logs "scheduler: not on a day paused" paused '^skip_paused( at=[0-9:]+)?$'
logs "scheduler: a pause that's over" pausedbefore '^started'
logs "scheduler: not when all the plan's areas are paused" pausedareas '^skip_paused( at=[0-9:]+)?$'
logs "scheduler: an interrupted job dropped first with fresh=1" fresh '^started'
gets fresh 'start_mowing$'
expect "scheduler: the job dropped before the start" "$(sent fresh | grep '^action' | cut -d' ' -f2)" \
  $'mower_logic:idle/reset_job\nmower_logic:idle/start_mowing'
logs "scheduler: a plan with its own direction" angle '^started'
gets angle '^rpc/request .*"params":\{"/mower_logic/mow_angle_offset":30\}' &&
  ok "scheduler: the plan's direction set before the start" || bad "scheduler: the plan's direction set before the start" "$(sent angle)"
expect "scheduler: the usual direction kept for later" "$(docker exec mbt-angle cat /data/angle.normal 2> /dev/null)" 5
logs "scheduler: the areas the plan doesn't pick are skipped" areas '^skipped_area back$'
gets areas '^action mower_logic:mowing/skip_area$' && ok "scheduler: the mower told to skip it" ||
  bad "scheduler: the mower told to skip it" "$(sent areas)"
logs "scheduler: an area paused today is skipped" pausedarea '^paused_area back$'
logs "scheduler: waits for the battery" battery '^waiting_battery 50( at=[0-9:]+)?$'
docker exec mbt-battery mosquitto_pub -h mbt-mq -r -t battery/robot_state/json -m "$(state IDLE 0 0 0.95)"
logs "scheduler: starts once it's charged" battery '^started 95( at=[0-9:]+)?$' 40
expect "scheduler: nothing while switched off" "$(slog disabled)" ""
expect "scheduler: nothing on another day" "$(slog otherday)" ""
logs "scheduler: sends the run home at its end time" endtime '^stopped_end$' 90
gets endtime '^action mower_logic:mowing/abort_mowing$' && ok "scheduler: the mower got sent home" ||
  bad "scheduler: the mower got sent home" "$(sent endtime)"
gets endtime '^rpc/request .*"/mower_logic/manual_pause_mowing":true' &&
  ok "scheduler: and doesn't carry on by itself after charging" || bad "scheduler: and doesn't carry on by itself after charging" "$(sent endtime)"
nodue endtime 5 && ok "scheduler: its stop time no longer to come then" || bad "scheduler: its stop time no longer to come then" "$(due endtime)"
logs "scheduler: a run with an end time ahead" endkept '^started'
r=$(docker exec mbt-endkept sh -c 'cat /data/run.state; ls /data/run.due.*' 2> /dev/null)
[ "$(wc -l <<< "$r")" = 2 ] && [ "$(sed -n 2p <<< "$r")" = "/data/run.due.$(head -n1 <<< "$r" | cut -d' ' -f1)" ] &&
  ok "scheduler: its stop time kept as still to come for a restart" || bad "scheduler: its stop time kept as still to come for a restart" "$r"
logs "scheduler: a mower that doesn't move is noticed" stays '^start_failed( at=[0-9:]+)?$' 90
logs "scheduler: why MowBite OS turned the start down" refused '^start_refused BATTERY_LOW 22.4( at=[0-9:]+)?$' 30
slog refused | grep -q '^start_failed' && bad "scheduler: a start turned down isn't one the mower didn't react to" "$(slog refused)" ||
  ok "scheduler: a start turned down isn't one the mower didn't react to"
logs "scheduler: no start after the end time while waiting for the battery" endlate '^skip_end( at=[0-9:]+)?$' 90
docker exec mbt-endlate mosquitto_pub -h mbt-mq -r -t endlate/robot_state/json -m "$(state IDLE 0 0 0.95)"
sleep 25
slog endlate | grep -q '^started' && bad "scheduler: still no start once it's charged" "$(slog endlate)" ||
  ok "scheduler: still no start once it's charged"
slog start | grep -q '^start_failed' && bad "scheduler: a mower that drives off isn't taken for one that didn't" "$(slog start)" ||
  ok "scheduler: a mower that drives off isn't taken for one that didn't"
logs "scheduler: no start when none of the plan's areas is in the map" noarea '^skip_no_area( at=[0-9:]+)?$'
logs "scheduler: an area with a brace in its name is found" braces '^started'
sleep 5
slog braces | grep -q '^skipped_area' && bad "scheduler: an inactive area with a brace in its name isn't skipped" "$(slog braces)" ||
  ok "scheduler: an inactive area with a brace in its name isn't skipped"
logs "scheduler: waits for the battery (start time taken out next)" gone '^waiting_battery 50( at=[0-9:]+)?$'
docker exec mbt-gone sh -c "grep -v '^plan' /data/schedule.txt > /tmp/s && cat /tmp/s > /data/schedule.txt"
logs "scheduler: a start time taken out while it waits isn't started" gone '^skip_gone( at=[0-9:]+)?$' 40
logs "scheduler: a run from before a restart still skips the areas it doesn't pick" restored '^skipped_area back$' 60
logs "scheduler: its job seen open once the actions have the idle ones, not by the first lists" growing '^skipped_area back$' 60
logs "scheduler: a start waiting for the battery goes on after a restart" waited '^started' 40
logs "scheduler: a stop time that passed during a restart is carried out after it" restoredlate '^stopped_end$' 30
gets restoredlate '"/mower_logic/manual_pause_mowing":true' && sent restoredlate | grep -q 'abort_mowing$' &&
  ok "scheduler: sent home and paused then" || bad "scheduler: sent home and paused then" "$(sent restoredlate)"
nodue restoredlate 5
expect "scheduler: and no longer to come, its run kept" "$(due restoredlate)$(docker exec mbt-restoredlate cut -d' ' -f2 /data/run.state)" "$past"
docker exec -d mbt-restoredlate /scheduler.sh
sleep 10
expect "scheduler: not again after the next restart" \
  "$(slog restoredlate | grep -c '^stopped_end$') $(sent restoredlate | grep -c 'abort_mowing$')" "1 1"
# a mower slow to answer the pause: the stop time stays to come until it's carried out, for a container ending meanwhile
past=$(($(date +%s) - 60))
start restoredslow "$(state MOWING)" "$(base "$DAY")" "RUN_STATE=$((past - 600)) $past end front" RUN_DUE=1 SLOW=8
gets restoredslow 'abort_mowing$' 30 && [ -n "$(due restoredslow)" ] &&
  ok "scheduler: a stop time still counts as to come while it's carried out" ||
  bad "scheduler: a stop time still counts as to come while it's carried out" "$(sent restoredslow)"
nodue restoredslow 20
expect "scheduler: and no longer once the mower is sent home and paused" "$(due restoredslow) $(slog restoredslow | grep -c '^stopped_end$')" " 1"
for _ in $(seq 30); do docker exec mbt-restoreddone test -f /data/run.state || break; sleep 1; done
expect "scheduler: nothing for a run that's over by then" \
  "$(docker exec mbt-restoreddone ls /data/run.state 2> /dev/null)$(slog restoreddone)$(sent restoreddone | grep -c 'abort_mowing$\|manual_pause')" 0
gets angleback '^rpc/request .*"params":\{"/mower_logic/mow_angle_offset":7\}' 40 &&
  ok "scheduler: the usual direction back once no plan has one of its own" ||
  bad "scheduler: the usual direction back once no plan has one of its own" "$(sent angleback)"
logs "scheduler: no start while the updater holds it" held '^waiting_hold( at=[0-9:]+)?$'
sleep 3
sent held | grep -q 'start_mowing$' && bad "scheduler: the mower got no start while held" "$(sent held)" ||
  ok "scheduler: the mower got no start while held"
docker exec mbt-held mosquitto_pub -h mbt-mq -r -n -t held/mowbite/hold
logs "scheduler: starts once the hold is gone" held '^started' 40
logs "scheduler: a hold far ahead isn't the updater's" heldfar '^started'
# when it may start next, retained for the updater
next() { docker exec mbt-mq mosquitto_sub -h localhost -t "$1/mowbite/schedule/next" -C 1 -W 3 2> /dev/null; }
at=$(TZ=$DAY date -d "$(day "$DAY" tomorrow) $M" +%s)
expect "scheduler: tells the next start" "$(next otherday)" "{\"from\":$at,\"to\":$at}"
w=$(next waitnext)
expect "scheduler: a start waiting for the battery may come within its two hours" \
  "$(($(sed 's/.*"to":\([0-9]*\).*/\1/' <<< "$w") - $(sed 's/.*"from":\([0-9]*\).*/\1/' <<< "$w")))" 7200
expect "scheduler: nothing to tell while switched off" "$(next disabled)" ""
gets os '"method":"rpc.methods"' 30 && sleep 3
if [ -n "$(sent os)" ] && ! sent os | grep -q '^action'; then ok "scheduler: rests on MowBite OS, which has a schedule of its own"; else
  bad "scheduler: rests on MowBite OS, which has a schedule of its own" "$(sent os)"; fi
expect "scheduler: and tells nothing there" "$(next os)$(slog os)" ""

# when a run has to be home, for times of the year the test can't wait for: stop_time with the clock set to the start,
# in the image (a start in the dark without dark=1 isn't one). <what>|<tz> <lat,lon|-> <day> <start> <end> <sunset>
# <dark>|<home at> <why>
BERLIN='<+0100>-1<+0200>-2,M3.5.0/2,M10.5.0/3'
STOPS=(
  "20:00 to 07:00 in june: at sunset|$BERLIN 52.37,9.73 2026-06-21 20:00 07:00 - -|2026-06-21 21:47 dark"
  "17:00 to 08:00 in june: at sunset|$BERLIN 52.37,9.73 2026-06-21 17:00 08:00 - -|2026-06-21 21:47 dark"
  "17:00 to 23:00: at sunset|$BERLIN 52.37,9.73 2026-06-21 17:00 23:00 - -|2026-06-21 21:47 dark"
  "10:00 to 14:00: at its end|$BERLIN 52.37,9.73 2026-06-21 10:00 14:00 - -|2026-06-21 14:00 end"
  "04:00 to 08:00, before sunrise: not started|$BERLIN 52.37,9.73 2026-06-21 04:00 08:00 - -|dark start"
  "20:00 to 07:00 allowed in the dark: at its end|$BERLIN 52.37,9.73 2026-06-21 20:00 07:00 - 1|2026-06-22 07:00 end"
  "22:00 to 06:00 over the switch in october: at 06:00 winter time|$BERLIN 52.37,9.73 2026-10-24 22:00 06:00 - 1|2026-10-25 06:00 end"
  "22:00 to 06:00 over the switch in march: at 06:00 summer time|$BERLIN 52.37,9.73 2026-03-28 22:00 06:00 - 1|2026-03-29 06:00 end"
  "01:00, home at sunset, before the switch that day: at sunset|$BERLIN 52.37,9.73 2026-10-25 01:00 - 1 1|2026-10-25 17:06 dark"
  "17:00 to 08:00 without a position: at 6 pm|$BERLIN - 2026-06-21 17:00 08:00 - -|2026-06-21 18:00 dark"
  "10:00 to 03:00 in reykjavik, home at sunset: after midnight|<+0000>0 64.15,-21.94 2026-06-21 10:00 03:00 1 1|2026-06-22 00:04 dark"
  "10:00 to 03:00 in reykjavik: after midnight|<+0000>0 64.15,-21.94 2026-06-21 10:00 03:00 - -|2026-06-22 00:04 dark"
  "01:00 to 03:00 in reykjavik, before sunrise: not started|<+0000>0 64.15,-21.94 2026-06-21 01:00 03:00 - -|dark start"
)
got=$(printf '%s\n' "${STOPS[@]}" | cut -d'|' -f2 | docker run -i --rm --entrypoint sh "$IMAGE" -c '
  eval "$(sed -n "/^conf() /p; /^sun_today() {/,/^}/p; /^minutes() /p; /^is_dark() {/,/^}/p; /^local_time() /p; /^stop_time() {/,/^}/p" /scheduler.sh)"
  date() { case "$1" in -u | -d) command date "$@" ;; +%s) echo "$at" ;; *) command date -d "@$at" "$@" ;; esac; }
  F=/tmp/schedule.txt where=""
  while read -r tz pos day start end sunset dark; do
    { echo "tz $tz"; [ "$pos" = - ] || echo "pos ${pos%,*} ${pos#*,}"; } > "$F"
    at=$(TZ="$tz" command date -d "$day $start" +%s)
    if [ "$dark" != 1 ] && is_dark "$(minutes)"; then echo "dark start"; continue; fi
    set -- $(stop_time "$end" "$sunset" "$dark")
    echo "$(TZ="$tz" command date -d "@$1" "+%F %H:%M") $2"
  done')
for i in "${!STOPS[@]}"; do
  expect "stop time: ${STOPS[$i]%%|*}" "$(sed -n "$((i + 1))p" <<< "$got")" "${STOPS[$i]##*|}"
done

# --- the parameters kept by the app ---

KEEP=$'enabled 1\n/mower_logic/mow_angle_offset 7'
start keepom "$(state)" "" RUN=/params.sh 'PARAMS={"/mower_logic/mow_angle_offset":5}' "KEEP=$KEEP"
start keepos "$(state)" "" RUN=/params.sh 'PARAMS={"/mower_logic/mow_angle_offset":5}' "KEEP=$KEEP" "METHODS=$OS_METHODS" "INFO=$OS_INFO"
gets keepom '"params":\{"/mower_logic/mow_angle_offset":7\}' 30 && ok "params: what the mower lost set again" ||
  bad "params: what the mower lost set again" "$(sent keepom)"
gets keepos '"method":"system.info"' 30 && sleep 3
sent keepos | grep -q 'params.set' && bad "params: not on MowBite OS, it keeps them itself" "$(sent keepos)" ||
  ok "params: not on MowBite OS, it keeps them itself"

# --- the log keeper ---

# logs.recent and planner.log answered the way OpenMower does (pretty printed) and MowBite OS does (all on one line),
# someone else's answer on the same topic before each
LOGS_PRETTY=$(cat << 'EOF'
{
  "jsonrpc": "2.0",
  "result": [
    {
      "level": "WARN",
      "msg": "a \"quoted\" {brace} [x], and: colon\nline",
      "node": "/mower_logic",
      "t": 1793643491.3263488
    }
  ],
  "id": "@ID@"
}
EOF
)
PLANNER_PRETTY=$(cat << 'EOF'
{
  "jsonrpc": "2.0",
  "result": {
    "lines": [
      {
        "t": 1793644779.7615213,
        "level": "INFO",
        "msg": "line one\nline \"two\""
      }
    ]
  },
  "id": "@ID@"
}
EOF
)
OTHER_PRETTY=$(cat << 'EOF'
{
  "jsonrpc": "2.0",
  "result": [
    {
      "level": "ERROR",
      "msg": "not ours",
      "node": "/x",
      "t": 1793643000
    }
  ],
  "id": "someone"
}
EOF
)
start pretty "$(state)" "" RUN=/logkeeper.sh "LOGS=$LOGS_PRETTY" "PLANNER_LOG=$PLANNER_PRETTY" "OTHER=$OTHER_PRETTY"
start compact "$(state)" "" RUN=/logkeeper.sh \
  'LOGS={"id":"@ID@","jsonrpc":"2.0","result":[{"level":"WARN","msg":"a \"quoted\" {brace} [x], and: colon\nline","node":"/mower_logic","t":1793643491.3263488}]}' \
  'PLANNER_LOG={"id":"@ID@","jsonrpc":"2.0","result":{"lines":[{"level":"INFO","msg":"line one\nline \"two\"","t":1793644779.7615213}]}}' \
  'OTHER={"id":"someone","jsonrpc":"2.0","result":[{"level":"ERROR","msg":"not ours","node":"/x","t":1793643000}]}'
# what case $1 kept in /data/$2 once it went through its first round
kept() {
  local i
  for ((i = 0; i < 30; i++)); do
    docker exec "mbt-$1" test -f "/data/$2/.last" && break
    sleep 1
  done
  docker exec "mbt-$1" sh -c "cat /data/$2/*.log" 2> /dev/null
}
for c in pretty compact; do
  expect "logkeeper: ros's lines from a $c answer" "$(kept "$c" roslog)" \
    '1793643491.3263488 WARN /mower_logic: a "quoted" {brace} [x], and: colon line'
  expect "logkeeper: the planner's lines from a $c answer" "$(kept "$c" plannerlog)" \
    '1793644779.7615213 INFO line one\nline \"two\"'
  expect "logkeeper: goes on after the newest kept ($c)" \
    "$(docker exec "mbt-$c" cat /data/roslog/.last /data/plannerlog/.last 2> /dev/null)" $'1793643491.3263488\n1793644779.7615213'
done

# --- the cgis, through busybox httpd as in the container ---

docker run -d --name mbt-web --label "$LABEL" --network "$NET" -p 127.0.0.1::8080 -e MOWER_MQTT_HOST=mbt-mq \
  -e MOWER_MQTT_PREFIX=web/ -e MOWBITE_SCHEDULER=off -e MOWBITE_ORIGINS=https://garden.example.org "$IMAGE" > /dev/null
port=$(docker port mbt-web 8080 | head -n1 | sed 's/.*://')
W=http://127.0.0.1:$port/cgi-bin
for _ in $(seq 40); do curl -sf "$W/version" > /dev/null && break; sleep 0.5; done
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# only MowBite itself asks: the app (its own page, the phone app's http://localhost) and its page on another mower
# on the same network, not some web page the phone happens to have open
for o in http://localhost capacitor://localhost http://192.168.178.20:8082 http://10.0.0.5 http://172.20.1.2:8082 \
  http://100.101.102.103:8082 http://mower.local:8082 http://mower.fritz.box http://mower:8082 'http://[fd12::1]:8082' \
  'http://[fe80::1]:8082' https://garden.example.org "http://127.0.0.1:$port"; do
  expect "origin $o asks" "$(code -H "Origin: $o" "$W/version")" 200
done
for o in http://evil.example https://10.evil.com http://192.168.1.5.evil.com null http://172.32.0.1 http://100.128.0.1 \
  'http://[2001:db8::1]' https://garden.example.org.evil.com http://mower.local.evil.com 'http://a"b'; do
  expect "origin $o turned down" "$(code -H "Origin: $o" "$W/version")" 403
done
expect "no origin (the page itself, curl) asks" "$(code "$W/version")" 200
expect "an origin that asks gets itself back for cors" \
  "$(curl -s -D - -o /dev/null -H 'Origin: http://192.168.178.20:8082' "$W/version" | tr -d '\r' | sed -n 's/^access-control-allow-origin: //Ip')" \
  http://192.168.178.20:8082
expect "no cors header without an origin" "$(curl -s -D - -o /dev/null "$W/version" | grep -ci '^access-control-allow-origin')" 0
expect "update: a page elsewhere can't start one" "$(code -X POST -H 'Origin: http://evil.example' "$W/update")" 403

S=$W/settings
ver() { curl -s -D - -o /dev/null "$S" | tr -d '\r' | sed -n 's/^x-settings-version: //Ip'; }
expect "settings: version 0 while nothing is stored" "$(ver)" 0
expect "settings: saved from version 0" "$(code --data-binary '{"a":1}' "$S?v=0")" 200
v1=$(ver)
expect "settings: saved from an old version: 409 with what's stored" "$(curl -s -w ' %{http_code}' --data-binary '{"a":2}' "$S?v=0")" '{"a":1} 409'
expect "settings: saved from the current version" "$(code --data-binary '{"a":2}' "$S?v=$v1")" 200
expect "settings: no json object, 400" "$(code --data-binary '[1]' "$S")" 400
expect "settings: what's stored stays" "$(curl -s "$S")" '{"a":2}'
expect "settings: the version read from v= itself, not from another parameter's end" \
  "$(code --data-binary '{"a":3}' "$S?v=$(ver)&x=v=1")" 200
# three devices saving from the same version at once: one gets through, the others are told
v=$(ver)
expect "settings: of saves at once from one version only one gets through" \
  "$(for i in 1 2 3; do (code --data-binary "{\"p\":$i}" "$S?v=$v" && echo) & done | sort | tr '\n' ' ')" '200 409 409 '
expect "settings: its version readable from another origin" \
  "$(curl -s -D - -o /dev/null -H 'Origin: http://192.168.178.20:8082' "$S" | tr -d '\r' | sed -n 's/^access-control-expose-headers: //Ip')" \
  X-Settings-Version

body=$'enabled 1\nplan 1 10:00; rm -rf /\nplan 8 10:00\nplan 1 10:00 $(id)\npause 2026-01-01 all\nminbattery 1000\ntz Europe/Berlin\nplan 1,2 07:30 a_b-c end=09:00 dark=1 sunset=1 fresh=1\nplan 3 08:00 angle=-45\nplan 3 08:00 angle=1000'
kept=$'enabled 1\npause 2026-01-01 all\ntz Europe/Berlin\nplan 1,2 07:30 a_b-c end=09:00 dark=1 sunset=1 fresh=1\nplan 3 08:00 angle=-45'
expect "schedule: only lines of the known shapes are kept" "$(curl -s --data-binary "$body" "$W/schedule")" "$kept"
expect "schedule: a page elsewhere can't change it" "$(code -H 'Origin: http://evil.example' --data-binary 'enabled 0' "$W/schedule")" 403
expect "schedule: and it's as it was" "$(curl -s "$W/schedule")" "$kept"
# a connection that breaks off: curl gives up waiting for the rest it said would come
broken() { curl -s -o /dev/null -m 2 -H 'Content-Length: 1000' --data-binary "$2" "$1"; sleep 1; }
broken "$W/schedule" 'enabled 0'
expect "schedule: a body that broke off leaves it as it was" "$(curl -s "$W/schedule")" "$kept"

P=$W/params
body=$'enabled 1\n/mower_logic/a_b 1.5\n/mower_logic/c true\n/other/x 1\n/mower_logic/d 1e9\n/mower_logic/e $(id)'
kept=$'enabled 1\n/mower_logic/a_b 1.5\n/mower_logic/c true'
expect "params: only lines of the known shapes are kept" "$(curl -s --data-binary "$body" "$P")" "$kept"
broken "$P" 'enabled 0'
expect "params: a body that broke off leaves them as they were" "$(curl -s "$P")" "$kept"
s=$(curl -s "$S")
broken "$S" '{"a":{"b":1}'
expect "settings: a body that broke off leaves them as they were" "$(curl -s "$S")" "$s"

B=$W/backups
expect "backups: one made by hand" "$(code --data-binary '{"areas":[]}' "$B?name=mine&areas=0")" 200
# 49 more made by hand, straight into the volume: the next one is turned down, the automatic ones before a save aren't
docker exec mbt-web sh -c 'cd /data/backups && for i in $(seq 49); do printf "x\n0\n0\n" > 100$i-1.meta; echo | gzip > 100$i-1.json.gz; done'
expect "backups: at most 50 made by hand" "$(curl -s -w ' %{http_code}' --data-binary '{"areas":[]}' "$B?name=more" | tr -d '\n')" \
  "at most 50 backups made by hand 409"
expect "backups: the automatic ones still go" "$(code --data-binary '{"areas":[]}' "$B?name=auto&auto=1")" 200
expect "backups: the list says how many are kept" "$(curl -s -D - -o /dev/null "$B" | tr -d '\r' | sed -n 's/^x-backups-keep: //Ip')" \
  'auto=30 hand=50'
expect "backups: nothing left half written" "$(docker exec mbt-web sh -c 'ls /data/backups | grep -c tmp')" 0
broken "$B?name=cut&auto=1" '{"areas":['
expect "backups: a body that broke off isn't kept" "$(curl -s "$B" | grep -c '"name":"cut"')" 0
bid() { sed -n 's/.*"id":"\([0-9-]*\)".*/\1/p'; }
id=$(curl -s --data-binary '{"areas":[1]}' "$B?name=load&auto=1" | bid)
expect "backups: one loaded" "$(curl -s "$B?id=$id")" '{"areas":[1]}'
curl -s -o /dev/null -X POST "$B?action=delete&id=$id"
expect "backups: one deleted" "$(code "$B?id=$id")$(curl -s "$B" | grep -c '"name":"load"')" 4040
# 60 characters of two bytes kept whole, a byte limit that falls into a character doesn't leave half of it
meta() { docker exec mbt-web sed -n 1p "/data/backups/$1.meta"; }
id=$(curl -s --data-binary '{"areas":[]}' "$B?name=$(printf '%%C3%%A4%.0s' $(seq 60))&auto=1" | bid)
expect "backups: a name of 60 umlauts kept whole" "$(meta "$id")" "$(printf 'ä%.0s' $(seq 60))"
long=$(printf 'a%.0s' $(seq 239))
id=$(curl -s --data-binary '{"areas":[]}' "$B?name=$long%C3%A4&auto=1" | bid)
expect "backups: a name cut without half a character at its end" "$(meta "$id")" "$long"
# one more automatic than are kept, the others with later times (a clock gone back): the oldest goes, not the new one
old=$(curl -s "$B" | grep -o '"id":"[0-9-]*","t":[0-9]*,"name":"auto"' | bid)
docker exec mbt-web sh -c 'cd /data/backups && for i in $(seq 30); do printf "x\n0\n1\n" > $((2000000000 + i))-1.meta; echo | gzip > $((2000000000 + i))-1.json.gz; done'
id=$(curl -s --data-binary '{"areas":[]}' "$B?name=new&auto=1" | bid)
expect "backups: the one just made is kept" "$(code "$B?id=$id")" 200
expect "backups: the oldest automatic one goes" "$(code "$B?id=$old")" 404
expect "backups: as many automatic ones left as the list says" \
  "$(docker exec mbt-web sh -c 'awk "FNR == 3 && \$0 == 1 { n++ } END { print n + 0 }" /data/backups/*.meta')" 30

N=$W/notify
curl -s -o /dev/null --data-binary $'server https://ntfy.invalid\ntopic mbt-test\ntoken secret-token-1\nenabled 1' "$N"
got=$(curl -s "$N")
grep -q secret <<< "$got" && bad "notify: the token isn't handed out" "$got" || ok "notify: the token isn't handed out"
grep -q '^token set$' <<< "$got" && ok "notify: it says there is one" || bad "notify: it says there is one" "$got"
curl -s -o /dev/null --data-binary $'server https://ntfy.invalid\ntopic mbt-test\nenabled 1' "$N"
expect "notify: a save without the token keeps it" "$(docker exec mbt-web sed -n 's/^token //p' /data/notify.conf)" secret-token-1
curl -s -o /dev/null --data-binary $'topic mbt-test\ntoken -' "$N"
expect "notify: token - drops it" "$(docker exec mbt-web grep -c '^token' /data/notify.conf)" 0
docker exec mbt-web sh -c 'echo "push https://ntfy.invalid/upA?up=1" > /data/notify.conf'
expect "notify: a phone that's the only line goes" \
  "$(curl -s --data-binary 'https://ntfy.invalid/upA?up=1' "$N?push-remove") $(docker exec mbt-web cat /data/notify.conf | wc -l)" "ok 0"

docker exec mbt-web sh -c 'mkdir -p /data/stats && printf "blade 80 0 0\nclean 200 0 0\n" > /data/stats/maint &&
  printf "blade 0\nclean 0\n" > /data/stats/reminded'
expect "stats: a part given other hours is told about again once due by them" \
  "$(code -X POST "$W/stats?due=blade&h=100") $(docker exec mbt-web cat /data/stats/reminded)" "200 clean 0"

docker exec mbt-web sh -c 'mkdir -p /data/gpslog && echo "1793644779.0 MOWING 1.200 3.400 0.020 -60" > /data/gpslog/20261103.log'
expect "gpslog: a cell of 0 cm is taken as 10" "$(curl -s "$W/gpslog?cells=0" | head -n1 | cut -d' ' -f1-3)" "12 34 1"

# httpd killed starts again after a pause
docker exec mbt-web pkill httpd
sleep 2
expect "httpd killed is gone first" "$(code "$W/version")" 000
for _ in $(seq 30); do curl -sf "$W/version" > /dev/null && break; sleep 1; done
expect "httpd killed is back after a pause" "$(code "$W/version")" 200

# logs grown too long, cut to size by the next start
docker exec mbt-web sh -c 'mkdir -p /data/stats && seq 10050 > /data/stats/hours && seq 2050 > /data/battery.log && seq 4050 > /data/battery-health.log'
t0=$(date +%s)
docker stop mbt-web > /dev/null
expect "it stops right away, not after docker's 10 s" "$(($(date +%s) - t0 < 5))" 1
docker start mbt-web > /dev/null
sizes() { docker exec mbt-web sh -c 'wc -l < /data/stats/hours; wc -l < /data/battery.log; wc -l < /data/battery-health.log' | tr '\n' ' '; }
for _ in $(seq 30); do [ "$(sizes)" = '10000 2000 4000 ' ] && break; sleep 1; done
expect "the logs in /data kept to their size" "$(sizes)" '10000 2000 4000 '

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
