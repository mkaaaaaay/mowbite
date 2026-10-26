#!/bin/sh
# one case of test/run.sh, in a MowBite container: the schedule ($SCHED), what the mower has retained (robot state, its
# params and map: $STATE, $PARAMS, $MAP), a pretend mower and then the scheduler as in the container.
# the pretend mower notes what's sent to it (actions, rpc calls) in /tmp/sent, answers the calls and leaves IDLE when
# it's told to mow, unless $MOWER is "stays". $AREA: the area it says it gets to a few seconds after that
pub() {
  t=$1
  shift
  mosquitto_pub -h "$MOWER_MQTT_HOST" -t "$MOWER_MQTT_PREFIX$t" "$@"
}

printf '%s\n' "$SCHED" > /data/schedule.txt
[ -z "$PARAMS" ] || pub params/json -r -m "$PARAMS"
[ -z "$MAP" ] || pub map/json -r -m "$MAP"
pub robot_state/json -r -m "$STATE"

mosquitto_sub -h "$MOWER_MQTT_HOST" -v -t "${MOWER_MQTT_PREFIX}action" -t "${MOWER_MQTT_PREFIX}rpc/request" | while read -r topic msg; do
  echo "${topic#"$MOWER_MQTT_PREFIX"} $msg" >> /tmp/sent
  case "$topic $msg" in
    *"action mower_logic:idle/start_mowing")
      [ "$MOWER" = stays ] && continue
      pub robot_state/json -r -m "$(echo "$STATE" | sed 's/"current_state":"[A-Z]*"/"current_state":"MOWING"/')"
      [ -z "$AREA" ] || { sleep 3 && pub events/json -m "{\"type\":\"AREA\",\"area_id\":\"$AREA\"}"; } &
      ;;
    *"rpc/request "*)
      id=$(printf '%s' "$msg" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
      pub rpc/response -m "{\"jsonrpc\":\"2.0\",\"result\":{},\"id\":\"$id\"}"
      ;;
  esac
done &

sleep 1
exec /scheduler.sh
