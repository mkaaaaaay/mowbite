# shared by recorder.sh and scheduler.sh: where the mqtt broker is and how to log in
PORT=${MOWER_MQTT_PORT:-1883}
AUTH="${MOWER_MQTT_USER:+-u $MOWER_MQTT_USER} ${MOWER_MQTT_PASSWORD:+-P $MOWER_MQTT_PASSWORD}"

# the broker runs on the mower: localhost with host networking, otherwise the docker gateway
find_broker() {
  for h in $MOWER_MQTT_HOST 127.0.0.1 host.docker.internal $(ip route | awk '/^default/ {print $3; exit}'); do
    nc -z -w 2 "$h" "$PORT" 2>/dev/null && echo "$h" && return
  done
}

# a json-rpc call to the mower: mower_rpc <host> <method> <params json> [seconds]. prints the answer with our id,
# nothing when none came. needs the topics from openmower.sh. answers come pretty printed over several lines on a
# topic others answer on too, so the one with our id is picked out
mower_rpc() {
  # a subshell has the same $$: a random part, two calls in the same second don't take each other's answer
  _id="mowbite-$$-$(date +%s)-$(od -An -N4 -tx4 /dev/urandom | tr -d ' ')"
  _out=$(mktemp)
  # shellcheck disable=SC2086
  mosquitto_sub -h "$1" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_RPC_RESPONSE" -t "${MOWER_MQTT_PREFIX}$TOPIC_RPC_ERROR" -W "${4:-15}" > "$_out" 2>/dev/null &
  _sub=$!
  sleep 1
  # shellcheck disable=SC2086
  mosquitto_pub -h "$1" -p "$PORT" $AUTH -t "${MOWER_MQTT_PREFIX}$TOPIC_RPC_REQUEST" \
    -m "{\"jsonrpc\":\"2.0\",\"method\":\"$2\",\"params\":$3,\"id\":\"$_id\"}" 2>/dev/null
  _n=0
  while [ "$_n" -lt "${4:-15}" ]; do
    grep -q "\"$_id\"" "$_out" 2>/dev/null && break
    sleep 1
    _n=$((_n + 1))
  done
  kill "$_sub" 2>/dev/null
  wait "$_sub" 2>/dev/null
  awk -v id="\"$_id\"" '
    /^\{/ { block = "" }
    { block = block $0 "\n" }
    /^\}/ || /^\{.*\}$/ { if (index(block, id)) printf "%s", block; block = "" }' "$_out" 2>/dev/null
  rm -f "$_out"
}
