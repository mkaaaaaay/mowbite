#!/bin/sh
# OpenMower doesn't store what an app sets with params.set, after its restart the values of its yaml are back. the
# app hands what's set in it to params.cgi (/data/params.txt), and every minute the ones the mower has differently
# are set again. the mowing direction is left alone while a start time of the schedule has its own, scheduler.sh
# sets it then
. /broker.sh
. /openmower.sh
F=/data/params.txt
S=/data/schedule.txt

while :; do
  if [ -f "$F" ] && [ "$(sed -n 's/^enabled //p' "$F" | head -n1)" != 0 ] && grep -q '^/' "$F"; then
    host=$(find_broker)
    # shellcheck disable=SC2086
    now=$([ -n "$host" ] && mosquitto_sub -h "$host" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_PARAMS" -C 1 -W 10 2>/dev/null)
    if [ -n "$now" ]; then
      skip=""
      if [ "$(sed -n 's/^enabled //p' "$S" 2>/dev/null | head -n1)" = 1 ] && grep -q '^plan .* angle=' "$S"; then
        skip=$PARAM_MOW_ANGLE_OFFSET
      fi
      set=$(grep '^/' "$F" | while read -r name want; do
        [ "$name" = "$skip" ] && continue
        has=$(printf '%s' "$now" | grep -o "\"$name\" *: *[^,}]*" | head -n1 | sed 's/^[^:]*: *//' | tr -d ' ')
        # a mower that doesn't have it: asking for it would fail the whole call
        [ -z "$has" ] && continue
        same=$(awk -v a="$has" -v b="$want" 'BEGIN {
          if (a ~ /^(true|false)$/ || b ~ /^(true|false)$/) print (a == b)
          else { d = a - b; print (d < 0.000001 && d > -0.000001) } }')
        [ "$same" = 1 ] || printf '"%s":%s,' "$name" "$want"
      done)
      [ -n "$set" ] && mower_rpc "$host" "$RPC_SET_PARAMS" "{\"params\":{${set%,}}}" 15 > /dev/null
    fi
  fi
  sleep 60
done
