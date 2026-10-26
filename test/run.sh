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
start areas "$(state)" "$(base "$DAY")"$'\n'"plan $D $M front" "MAP=$AREAS" AREA=back
start pausedarea "$(state)" "$(base "$DAY")"$'\n'"plan $D $M"$'\n'"pause $(day "$DAY") back" "MAP=$AREAS" AREA=back
start pausedareas "$(state)" "$(base "$DAY")"$'\n'"plan $D $M front"$'\n'"pause $(day "$DAY") front" "MAP=$AREAS"
start endtime "$(state)" "$(base "$DAY")"$'\n'"plan $D $M end=$(hm "$DAY" 1)"
start endlate "$(state IDLE 0 0 0.5)" "$(MINBAT=80 base "$DAY")"$'\n'"plan $D $M end=$(hm "$DAY" 1)"

logs "scheduler: starts at the time of a plan" start '^started 90$'
gets start '^action mower_logic:idle/start_mowing$' && ok "scheduler: the mower got the start" ||
  bad "scheduler: the mower got the start" "$(sent start)"
logs "scheduler: not in the dark" dark '^skip_dark$'
logs "scheduler: in the dark with dark=1" darkok '^started'
logs "scheduler: not with the emergency stop" emergency '^skip_emergency$'
logs "scheduler: not with the rain sensor wet" rain '^skip_rain$'
logs "scheduler: not while the mower is busy" busy '^skip_busy MOWING$'
logs "scheduler: not on a day paused" paused '^skip_paused$'
logs "scheduler: a pause that's over" pausedbefore '^started'
logs "scheduler: not when all the plan's areas are paused" pausedareas '^skip_paused$'
logs "scheduler: an interrupted job dropped first with fresh=1" fresh '^started'
gets fresh 'start_mowing$'
expect "scheduler: the job dropped before the start" "$(sent fresh | cut -d' ' -f2)" \
  $'mower_logic:idle/reset_job\nmower_logic:idle/start_mowing'
logs "scheduler: a plan with its own direction" angle '^started'
gets angle '^rpc/request .*"params":\{"/mower_logic/mow_angle_offset":30\}' &&
  ok "scheduler: the plan's direction set before the start" || bad "scheduler: the plan's direction set before the start" "$(sent angle)"
expect "scheduler: the usual direction kept for later" "$(docker exec mbt-angle cat /data/angle.normal 2> /dev/null)" 5
logs "scheduler: the areas the plan doesn't pick are skipped" areas '^skipped_area back$'
gets areas '^action mower_logic:mowing/skip_area$' && ok "scheduler: the mower told to skip it" ||
  bad "scheduler: the mower told to skip it" "$(sent areas)"
logs "scheduler: an area paused today is skipped" pausedarea '^paused_area back$'
logs "scheduler: waits for the battery" battery '^waiting_battery 50$'
docker exec mbt-battery mosquitto_pub -h mbt-mq -r -t battery/robot_state/json -m "$(state IDLE 0 0 0.95)"
logs "scheduler: starts once it's charged" battery '^started 95$' 40
expect "scheduler: nothing while switched off" "$(slog disabled)" ""
expect "scheduler: nothing on another day" "$(slog otherday)" ""
logs "scheduler: sends the run home at its end time" endtime '^stopped_end$' 90
gets endtime '^action mower_logic:mowing/abort_mowing$' && ok "scheduler: the mower got sent home" ||
  bad "scheduler: the mower got sent home" "$(sent endtime)"
gets endtime '^rpc/request .*"/mower_logic/manual_pause_mowing":true' &&
  ok "scheduler: and doesn't carry on by itself after charging" || bad "scheduler: and doesn't carry on by itself after charging" "$(sent endtime)"
logs "scheduler: a mower that doesn't move is noticed" stays '^start_failed$' 90
logs "scheduler: no start after the end time while waiting for the battery" endlate '^skip_end$' 90
docker exec mbt-endlate mosquitto_pub -h mbt-mq -r -t endlate/robot_state/json -m "$(state IDLE 0 0 0.95)"
sleep 25
slog endlate | grep -q '^started' && bad "scheduler: still no start once it's charged" "$(slog endlate)" ||
  ok "scheduler: still no start once it's charged"
slog start | grep -q '^start_failed' && bad "scheduler: a mower that drives off isn't taken for one that didn't" "$(slog start)" ||
  ok "scheduler: a mower that drives off isn't taken for one that didn't"

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
expect "settings: its version readable from another origin" \
  "$(curl -s -D - -o /dev/null -H 'Origin: http://192.168.178.20:8082' "$S" | tr -d '\r' | sed -n 's/^access-control-expose-headers: //Ip')" \
  X-Settings-Version

body=$'enabled 1\nplan 1 10:00; rm -rf /\nplan 8 10:00\nplan 1 10:00 $(id)\npause 2026-01-01 all\nminbattery 1000\ntz Europe/Berlin\nplan 1,2 07:30 a_b-c end=09:00 dark=1 sunset=1 fresh=1\nplan 3 08:00 angle=-45\nplan 3 08:00 angle=1000'
kept=$'enabled 1\npause 2026-01-01 all\ntz Europe/Berlin\nplan 1,2 07:30 a_b-c end=09:00 dark=1 sunset=1 fresh=1\nplan 3 08:00 angle=-45'
expect "schedule: only lines of the known shapes are kept" "$(curl -s --data-binary "$body" "$W/schedule")" "$kept"
expect "schedule: a page elsewhere can't change it" "$(code -H 'Origin: http://evil.example' --data-binary 'enabled 0' "$W/schedule")" 403
expect "schedule: and it's as it was" "$(curl -s "$W/schedule")" "$kept"

B=$W/backups
expect "backups: one made by hand" "$(code --data-binary '{"areas":[]}' "$B?name=mine&areas=0")" 200
# 49 more made by hand, straight into the volume: the next one is turned down, the automatic ones before a save aren't
docker exec mbt-web sh -c 'cd /data/backups && for i in $(seq 49); do printf "x\n0\n0\n" > 100$i-1.meta; echo | gzip > 100$i-1.json.gz; done'
expect "backups: at most 50 made by hand" "$(curl -s -w ' %{http_code}' --data-binary '{"areas":[]}' "$B?name=more" | tr -d '\n')" \
  "at most 50 backups made by hand 409"
expect "backups: the automatic ones still go" "$(code --data-binary '{"areas":[]}' "$B?name=auto&auto=1")" 200

N=$W/notify
curl -s -o /dev/null --data-binary $'server https://ntfy.invalid\ntopic mbt-test\ntoken secret-token-1\nenabled 1' "$N"
got=$(curl -s "$N")
grep -q secret <<< "$got" && bad "notify: the token isn't handed out" "$got" || ok "notify: the token isn't handed out"
grep -q '^token set$' <<< "$got" && ok "notify: it says there is one" || bad "notify: it says there is one" "$got"
curl -s -o /dev/null --data-binary $'server https://ntfy.invalid\ntopic mbt-test\nenabled 1' "$N"
expect "notify: a save without the token keeps it" "$(docker exec mbt-web sed -n 's/^token //p' /data/notify.conf)" secret-token-1
curl -s -o /dev/null --data-binary $'topic mbt-test\ntoken -' "$N"
expect "notify: token - drops it" "$(docker exec mbt-web grep -c '^token' /data/notify.conf)" 0

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
