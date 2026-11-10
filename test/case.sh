#!/bin/sh
# one case of test/run.sh, in a MowBite container: the schedule ($SCHED), what the mower has retained (robot state, its
# params and map: $STATE, $PARAMS, $MAP), a pretend mower and then the scheduler (or $RUN) as in the container.
# the pretend mower notes what's sent to it (actions, rpc calls) in /tmp/sent, answers the calls and leaves IDLE when
# it's told to mow, unless $MOWER is "stays" (or "refuses": MOWING_REFUSED as MowBite OS sends it). $AREA: the area it
# says it gets to a few seconds after that, $AREA_SOON: one it gets to a little after the start of the case without
# being told. from before a restart of the container: $RUN_STATE (a run the scheduler started), $WAITING (a start
# waiting for the battery), $ANGLE_NORMAL (the usual mowing direction before a plan turned it). $HOLD: the MowBite
# Updater's hold on starts (retained). $ACTIONS: the lists actions/json says one after the other (retained), a line
# each, a second apart. $LOGS, $PLANNER_LOG: what logs.recent and planner.log answer (@ID@ for the call's id), $OTHER:
# someone else's answer sent before each one. $METHODS, $INFO: rpc.methods and system.info (MowBite OS). $KEEP: the
# parameters the app keeps (/data/params.txt). $RUN_DUE: set while the stop time of $RUN_STATE's run is still to come.
# $SLOW: the seconds the pretend mower takes to answer a call that sets the pause
pub() {
  t=$1
  shift
  mosquitto_pub -h "$MOWER_MQTT_HOST" -t "$MOWER_MQTT_PREFIX$t" "$@"
}

printf '%s\n' "$SCHED" > /data/schedule.txt
[ -z "$RUN_STATE" ] || echo "$RUN_STATE" > /data/run.state
[ -z "$RUN_DUE" ] || : > "/data/run.due.${RUN_STATE%% *}"
[ -z "$WAITING" ] || echo "$WAITING" > /data/run.wait
[ -z "$ANGLE_NORMAL" ] || echo "$ANGLE_NORMAL" > /data/angle.normal
[ -z "$KEEP" ] || printf '%s\n' "$KEEP" > /data/params.txt
[ -z "$PARAMS" ] || pub params/json -r -m "$PARAMS"
[ -z "$MAP" ] || pub map/json -r -m "$MAP"
[ -z "$HOLD" ] || pub mowbite/hold -r -m "$HOLD"
pub robot_state/json -r -m "$STATE"

mosquitto_sub -h "$MOWER_MQTT_HOST" -v -t "${MOWER_MQTT_PREFIX}action" -t "${MOWER_MQTT_PREFIX}rpc/request" | while read -r topic msg; do
  echo "${topic#"$MOWER_MQTT_PREFIX"} $msg" >> /tmp/sent
  case "$topic $msg" in
    *"action mower_logic:idle/start_mowing")
      [ "$MOWER" = stays ] && continue
      # MowBite OS turning it down, with why
      [ "$MOWER" = refuses ] && { pub events/json -m '{"type":"MOWING_REFUSED","reason":"BATTERY_LOW","battery_voltage":22.4,"limit":23,"severity":"warning","resume":"user","message":"Battery low"}'; continue; }
      pub robot_state/json -r -m "$(echo "$STATE" | sed 's/"current_state":"[A-Z]*"/"current_state":"MOWING"/')"
      [ -z "$AREA" ] || { sleep 3 && pub events/json -m "{\"type\":\"AREA\",\"area_id\":\"$AREA\"}"; } &
      ;;
    *"rpc/request "*)
      id=$(printf '%s' "$msg" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
      a='{"jsonrpc":"2.0","result":{},"id":"@ID@"}'
      case "$msg" in
        *'"method":"logs.recent"'*) [ -z "$LOGS" ] || a=$LOGS ;;
        *'"method":"planner.log"'*) [ -z "$PLANNER_LOG" ] || a=$PLANNER_LOG ;;
        *'"method":"rpc.methods"'*) [ -z "$METHODS" ] || a=$METHODS ;;
        *'"method":"system.info"'*) [ -z "$INFO" ] || a=$INFO ;;
      esac
      [ -z "$OTHER" ] || pub rpc/response -m "$OTHER"
      case "$msg" in *manual_pause_mowing*) [ -z "$SLOW" ] || sleep "$SLOW" ;; esac
      pub rpc/response -m "$(printf '%s' "$a" | sed "s/@ID@/$id/")"
      ;;
  esac
done &

[ -z "$AREA_SOON" ] || { sleep 12 && pub events/json -m "{\"type\":\"AREA\",\"area_id\":\"$AREA_SOON\"}"; } &
[ -z "$ACTIONS" ] || printf '%s\n' "$ACTIONS" | while read -r l; do
  pub actions/json -r -m "$l"
  sleep 1
done &

sleep 1
exec "${RUN:-/scheduler.sh}"
