# shared by recorder.sh and scheduler.sh: where the mqtt broker is and how to log in
PORT=${MOWER_MQTT_PORT:-1883}
# the login goes to mosquitto_sub and mosquitto_pub through their options file (an option a line, its value the rest of
# it): as an argument a password with a space or a * would come apart
if [ -n "$MOWER_MQTT_USER$MOWER_MQTT_PASSWORD" ]; then
  export XDG_CONFIG_HOME=/tmp/mqtt-login
  (
    umask 077
    mkdir -p "$XDG_CONFIG_HOME"
    for t in mosquitto_sub mosquitto_pub; do
      { [ -z "$MOWER_MQTT_USER" ] || echo "-u $MOWER_MQTT_USER"; [ -z "$MOWER_MQTT_PASSWORD" ] || echo "-P $MOWER_MQTT_PASSWORD"; } > "$XDG_CONFIG_HOME/$t.$$" &&
        mv "$XDG_CONFIG_HOME/$t.$$" "$XDG_CONFIG_HOME/$t"
    done
  )
fi

# the broker runs on the mower: localhost with host networking, otherwise the docker gateway
find_broker() {
  for h in $MOWER_MQTT_HOST 127.0.0.1 host.docker.internal $(ip route | awk '/^default/ {print $3; exit}'); do
    nc -z -w 2 "$h" "$PORT" 2>/dev/null && echo "$h" && return
  done
}

# what MowBite OS does itself, so the container's scripts leave it be: os_does <host> schedule (it has schedule.get) or
# params (system.info names mowbite-os: it keeps its parameters). asked every 10 minutes at most, in /tmp/os for all of
# the scripts. without an answer what was known stays, before the first one it's taken for OpenMower
os_does() {
  if [ -z "$(find /tmp/os -mmin -10 2>/dev/null)" ]; then
    _m=$(mower_rpc "$1" "$RPC_METHODS" '[]' 10 | tr -d ' \t\n')
    if [ -z "$_m" ]; then
      if [ -f /tmp/os ]; then touch /tmp/os; else : > /tmp/os; fi
    else
      _t=$(mktemp /tmp/os.XXXXXX)
      {
        case $_m in *"\"$RPC_SCHEDULE_GET\""*) echo schedule ;; esac
        case $_m in *"\"$RPC_SYSTEM_INFO\""*)
          _i=$(mower_rpc "$1" "$RPC_SYSTEM_INFO" '{}' 10 | tr -d ' \t\n')
          if [ -z "$_i" ]; then grep -x params /tmp/os 2>/dev/null; else case $_i in *'"name":"mowbite-os"'*) echo params ;; esac; fi
          ;;
        esac
      } > "$_t" && mv "$_t" /tmp/os
    fi
  fi
  grep -qx "$2" /tmp/os 2>/dev/null
}

# a json-rpc call to the mower: mower_rpc <host> <method> <params json> [seconds]. prints the answer with our id,
# nothing when none came. needs the topics from openmower.sh. answers come on a topic others answer on too, pretty
# printed over several lines (OpenMower) or all on one (MowBite OS), so the one with our id is picked out: a message
# ends where its brackets close, the ones in strings don't count
mower_rpc() {
  # a subshell has the same $$: a random part, two calls in the same second don't take each other's answer
  _id="mowbite-$$-$(date +%s)-$(od -An -N4 -tx4 /dev/urandom | tr -d ' ')"
  _out=$(mktemp)
  mosquitto_sub -h "$1" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_RPC_RESPONSE" -t "${MOWER_MQTT_PREFIX}$TOPIC_RPC_ERROR" -W "${4:-15}" > "$_out" 2>/dev/null &
  _sub=$!
  sleep 1
  mosquitto_pub -h "$1" -p "$PORT" -t "${MOWER_MQTT_PREFIX}$TOPIC_RPC_REQUEST" \
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
    {
      line[++k] = $0
      if (index($0, id)) ours = 1
      s = $0
      gsub(/\\\\|\\"/, "", s)
      n = split(s, p, "\"")
      for (i = 1; i <= n; i += 2) depth += gsub(/[[{]/, "", p[i]) - gsub(/[]}]/, "", p[i])
    }
    depth <= 0 {
      if (ours) for (i = 1; i <= k; i++) print line[i]
      k = ours = depth = 0
    }' "$_out" 2>/dev/null
  rm -f "$_out"
}
