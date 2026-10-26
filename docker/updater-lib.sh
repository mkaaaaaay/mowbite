# shared by the updater (updater.sh), its own update (updater-self.sh) and its interface (updater.cgi): where things
# are, the settings, the status, the stacks. the settings, the status and the log live in the updater's own stack
# folder (.updater next to its compose.yaml): only it can write there, the app asks for them over http (updater.cgi),
# it has no access of its own
APP=${MOWBITE_SERVICE:-mowbite}
OM=${OPENMOWER_CONTAINER:-open_mower_ros}
PLANNER=${PLANNER_CONTAINER:-mowbite_planner}

# a container's compose label (project, project.working_dir, project.config_files, service)
label() { docker inspect -f "{{index .Config.Labels \"com.docker.compose.$2\"}}" "$1" 2>/dev/null; }
exists() { docker inspect "$1" > /dev/null 2>&1; }

# itself: by its name in compose.yaml, else by its hostname (the container's id)
ME=${UPDATER_CONTAINER:-mowbite-updater}
exists "$ME" || ME=$(hostname)

STATE=${STATE_DIR:-$(label "$ME" project.working_dir)/.updater}
CONF=$STATE/conf
STATUS=$STATE/status
LOG=$STATE/log
REQ=$STATE/request

now() { date +%s; }
log() {
  local tmp
  echo "$(date '+%F %T') $*" >> "$LOG"
  # a few hundred lines, nothing may grow
  if [ "$(wc -l < "$LOG")" -gt 400 ] && tmp=$(mktemp "$LOG.XXXXXX"); then
    if tail -n 300 "$LOG" > "$tmp"; then mv "$tmp" "$LOG"; else rm -f "$tmp"; fi
  fi
  # (callers chain on it: a log line never fails)
  return 0
}
# one line per value, updater.cgi hands them to the app. no value: the key goes. written whole and moved in place, only
# when all of it got written (a full disk leaves the one there was)
status() {
  local key="$1" tmp rc
  shift
  [ -f "$STATUS" ] || : > "$STATUS"
  tmp=$(mktemp "$STATUS.XXXXXX") || return 0
  grep -v "^$key " "$STATUS" > "$tmp"
  rc=$?
  if [ $rc -le 1 ] && { [ $# -eq 0 ] || echo "$key $*" >> "$tmp"; }; then mv "$tmp" "$STATUS"; else rm -f "$tmp"; fi
}
get() { sed -n "s/^$1 //p" "$STATUS" 2>/dev/null | head -n1; }

# a container's stack the way dockge runs it, within $1 seconds: all its compose files and env files, from its folder
compose() {
  local t="$1" c="$2" dir files envs
  shift 2
  dir=$(label "$c" project.working_dir)
  # (paths with spaces don't happen in dockge's stacks)
  files=$(label "$c" project.config_files | tr ',' '\n' | sed '/./!d; s/^/-f /')
  envs=$(label "$c" project.environment_file | tr ',' '\n' | sed '/./!d' | while read -r f; do
    case $f in /*) echo "--env-file $f" ;; *) echo "--env-file $dir/$f" ;; esac
  done)
  # shellcheck disable=SC2086
  timeout "$t" docker compose -p "$(label "$c" project)" --project-directory "$dir" $envs $files "$@"
}
in_compose() { [ -n "$(label "$1" project)" ] && [ -f "$(label "$1" project.config_files | cut -d, -f1)" ]; }
service() { label "$1" service; }

# a value as it was set, or the default. the file is only ever written by updater.cgi, which checks what goes in
conf() {
  v=$(sed -n "s/^$1 //p" "$CONF" 2>/dev/null | head -n1)
  echo "${v:-$2}"
}
valid() { printf '%s' "$1" | grep -Eq "^($2)\$"; }
TAG='[A-Za-z0-9][A-Za-z0-9._-]{0,63}'

# OpenMower's version as its .env says, the channel it's on when nothing else is set. read the way compose reads it:
# VERSION=edge, "edge", 'edge', with export in front or a comment after, windows line ends
om_env() { echo "$(label "$OM" project.working_dir)/.env"; }
om_version() {
  v=$(tr -d '\r' < "$(om_env)" 2>/dev/null | sed -n 's/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}VERSION=//p' | head -n1 |
    sed 's/[[:space:]][[:space:]]*#.*//; s/^["'\'']//; s/["'\''][[:space:]]*$//; s/[[:space:]]*$//')
  valid "$v" "$TAG" && echo "$v"
}

# the channels: MowBite beta or stable, OpenMower edge, latest (its release) or what its .env has, the planner only
# ever where its stack builds from. automatic: 1 or 0 each
app_channel() { [ "$(conf mowbite beta)" = stable ] && echo stable || echo beta; }
om_choices() { printf 'edge latest %s' "$(om_version)"; }
om_channel() {
  v=$(conf openmower "")
  case " $(om_choices) " in *" $v "*) [ -n "$v" ] && echo "$v" && return ;; esac
  v=$(om_version)
  echo "${v:-edge}"
}
auto() { [ "$(conf "$1_auto" 0)" = 1 ]; }
