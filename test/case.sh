#!/bin/sh
# one case of test/run.sh, in a MowBite container: the schedule ($SCHED), what the mower has retained (robot state, its
# params and map: $STATE, $PARAMS, $MAP), a pretend mower and then the scheduler (or $RUN) as in the container. like
# OpenMower it sends its robot state now and then, not retained (what it says is in /tmp/state, a test may change it),
# with the charge contacts' voltage ($V_CHARGE, 28 V: in the dock) and its actions retained when the state changes.
# the pretend mower notes what's sent to it (actions, rpc calls) in /tmp/sent, answers the calls and leaves IDLE when
# it's told to mow, unless $MOWER is "stays" (or "refuses": MOWING_REFUSED as MowBite OS sends it;
# "undock_fails": it undocks and gives up, back in IDLE; "undock_once": that only the first time). $AREA: the area it
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
# start_mowing and reset_job in idle, as OpenMower has them
IDLE_ACTIONS='[{"action_id":"mower_logic:idle/start_mowing","action_name":"Start Mowing","enabled":1},{"action_id":"mower_logic:idle/reset_job","action_name":"Reset Job","enabled":0}]'
mower_state() { printf '%s' "$1" > /tmp/state; }
mower_state "$STATE"
while :; do
  s=$(cat /tmp/state)
  pub robot_state/json -m "$s"
  pub sensors/om_v_charge/data -m "${V_CHARGE:-28.0}"
  if [ -z "$ACTIONS" ] && [ "$s" != "$was" ]; then
    case "$s" in *'"current_state":"IDLE"'*) pub actions/json -r -m "$IDLE_ACTIONS" ;; *) pub actions/json -r -m '[]' ;; esac
    was=$s
  fi
  sleep 1
done &

mosquitto_sub -h "$MOWER_MQTT_HOST" -v -t "${MOWER_MQTT_PREFIX}action" -t "${MOWER_MQTT_PREFIX}rpc/request" | while read -r topic msg; do
  echo "${topic#"$MOWER_MQTT_PREFIX"} $msg" >> /tmp/sent
  case "$topic $msg" in
    *"action mower_logic:idle/start_mowing")
      [ "$MOWER" = stays ] && continue
      # MowBite OS turning it down, with why
      [ "$MOWER" = refuses ] && { pub events/json -m '{"type":"MOWING_REFUSED","reason":"BATTERY_LOW","battery_voltage":22.4,"limit":23,"severity":"warning","resume":"user","message":"Battery low"}'; continue; }
      if [ "$MOWER" = undock_fails ] || { [ "$MOWER" = undock_once ] && [ ! -f /tmp/undocked ]; }; then
        : > /tmp/undocked
        {
          mower_state "$(echo "$STATE" | sed 's/"current_state":"[A-Z]*"/"current_state":"UNDOCKING"/')"
          sleep 3
          pub events/json -m '{"type":"UNDOCKING_FAILED","reason":"path_failed"}'
          mower_state "$STATE"
        } &
        continue
      fi
      mower_state "$(echo "$STATE" | sed 's/"current_state":"[A-Z]*"/"current_state":"MOWING"/')"
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
