#!/bin/sh
# MowBite's updater, a container of its own next to the app (compose.yaml, service updater): the only one with docker.
# at the time and on the days set in the app, and when the app asks, with the mower idle in the dock, each part on the
# channel picked there:
#   MowBite    off | beta (:latest from main) | stable (the newest release without a dash)
#   OpenMower  off | check (only says when there's a newer image) | edge | release (its "latest"; not with the planner,
#              that needs edge)
#   planner    off | main (rebuilt from github when main moved; only a stack built from github, never a local copy)
# everything goes through the stacks' own compose files, so dockge shows the same. a part counts as updated when it
# answers afterwards, otherwise it goes back to what ran before and leaves that version out. OpenMower only when there's
# room for the old and the new image at once (the old one is what it goes back to), and the planner is built again on
# the new OpenMower right after. last the leftovers go: older rollback tags, images nothing uses, the build cache
#
# files in the app's data volume: update.conf (the app writes it), update.request (the app: now), update.status
# and update.log (written here). the app: http://mowbite:8080 on the stack's network
APP=${MOWBITE_SERVICE:-mowbite}
OM=${OPENMOWER_CONTAINER:-open_mower_ros}
PLANNER=${PLANNER_CONTAINER:-mowbite_planner}
D=/data
CONF=$D/update.conf
STATUS=$D/update.status
LOG=$D/update.log
REQ=$D/update.request
# rollback tags kept once all runs again: the app's are small, OpenMower's and the planner's are GBs and would keep the
# old OpenMower on a disk that has no room for it
KEEP=2
KEEP_BIG=0

conf() { v=$(sed -n "s/^$1 //p" "$CONF" 2>/dev/null | head -n1); echo "${v:-$2}"; }
now() { date +%s; }
log() {
  echo "$(date '+%F %T') $*" >> "$LOG"
  # a few hundred lines, the volume must not grow
  [ "$(wc -l < "$LOG")" -gt 400 ] && tail -n 300 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  chmod 644 "$LOG"
}
# one line per value, the app reads them (cgi-bin/update)
status() {
  key=$1
  shift
  { grep -v "^$key " "$STATUS" 2>/dev/null; echo "$key $*"; } > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
  chmod 644 "$STATUS"
}
get() { sed -n "s/^$1 //p" "$STATUS" 2>/dev/null | head -n1; }
app() { wget -q -T 10 -O - "http://$APP:8080/cgi-bin/$1" 2>/dev/null; }
docked() { case $(app "update?docked") in 1*) return 0 ;; *) return 1 ;; esac; }
short() { echo "$1" | sed 's/^sha256://' | cut -c1-8; }
exists() { docker inspect "$1" > /dev/null 2>&1; }

# a container's compose stack: project, folder, file, service
label() { docker inspect -f "{{index .Config.Labels \"com.docker.compose.$2\"}}" "$1" 2>/dev/null; }
stackfile() { label "$1" project.config_files | cut -d, -f1; }
compose() {
  c=$1
  shift
  docker compose -p "$(label "$c" project)" --project-directory "$(label "$c" project.working_dir)" -f "$(stackfile "$c")" "$@"
}
service() { label "$1" service; }

# a registry's digest of image:tag (ghcr.io and docker hub, anonymously), empty when it can't be had
remote_digest() {
  docker buildx imagetools inspect "$1" --format '{{.Manifest.Digest}}' 2>/dev/null
}

# the MB the newest image of ref needs that the local image doesn't have yet: its missing layers, packed size x5
need_mb() {
  ref=$1
  have=$(docker image inspect -f '{{range .RootFS.Layers}}{{.}} {{end}}' "$2" 2>/dev/null)
  arch=$(uname -m)
  case $arch in aarch64 | arm64) arch=arm64 ;; *) arch=amd64 ;; esac
  ids=$(docker buildx imagetools inspect "$ref" --format "{{json (index .Image \"linux/$arch\").RootFS.DiffIDs}}" 2>/dev/null | tr -d '[]"' | tr ',' '\n')
  dg=$(docker buildx imagetools inspect "$ref" --format "{{range .Manifest.Manifests}}{{if and (eq .Platform.Architecture \"$arch\") (eq .Platform.OS \"linux\")}}{{.Digest}}{{end}}{{end}}" 2>/dev/null)
  [ -n "$ids" ] && [ -n "$dg" ] || return 1
  echo "$ids" | grep . > /tmp/ids
  docker buildx imagetools inspect --raw "${ref%:*}@$dg" 2>/dev/null | sed -n '/"layers"/,$p' | sed -n 's/.*"size": *\([0-9]*\).*/\1/p' > /tmp/sizes
  paste -d' ' /tmp/ids /tmp/sizes | awk -v have=" $have " '{ if (index(have, " " $1 " ") == 0) s += $2 } END { printf "%d\n", s * 5 / 1048576 }'
}
# MB free where docker keeps its images (the stacks are on the same disk on OpenMowerOS)
free_mb() { df -Pm "$(label "$OM" project.working_dir)" 2>/dev/null | awk 'NR == 2 {print $4}'; }

# --- MowBite ---

# the stable channel: the newest github release that isn't a pre-release, as the image's version tag
stable_tag() {
  case $1 in ghcr.io/mkaaaaaay/mowbite) ;; *) return ;; esac
  wget -q -T 15 -O - https://api.github.com/repos/mkaaaaaay/mowbite/releases/latest |
    sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1
}

# the image line of a container's service in its compose file, changed to another image
set_image() {
  file=$(stackfile "$1")
  [ "$2" = "$3" ] && return 0
  cp "$file" "$file.before-update" &&
    sed -i "s|^\( *image: *\)$2 *\$|\1$3|" "$file" &&
    grep -q "image: *$3 *\$" "$file"
}

# the app answers again within two minutes
app_up() {
  n=0
  while [ $n -lt 24 ]; do
    sleep 5
    status alive "$(now)"
    app version | grep -q '"version"' && return 0
    n=$((n + 1))
  done
  return 1
}

update_app() {
  channel=$(conf mowbite off)
  current=$(docker inspect -f '{{.Config.Image}}' "$APP" 2>/dev/null)
  [ -n "$current" ] || { log "mowbite: no container $APP"; status mowbite error no_app; return 1; }
  repo=${current%:*}
  # after a rollback the compose file holds a prev- tag, the channel still says where it belongs
  case $channel in
  beta) target=$repo:latest ;;
  stable)
    v=$(stable_tag "$repo")
    [ -n "$v" ] || { log "mowbite: no stable release for $repo"; status mowbite error no_stable; return 1; }
    target=$repo:$v ;;
  *) return 0 ;;
  esac
  before=$(docker inspect -f '{{.Image}}' "$APP")
  docker pull -q "$target" > /dev/null 2>&1 || { log "mowbite: pull of $target failed"; status mowbite error pull; return 1; }
  pulled=$(docker image inspect -f '{{.Id}}' "$target")
  if [ "$pulled" = "$before" ] && [ "$target" = "$current" ]; then
    status mowbite current
    return 0
  fi
  if [ "$pulled" = "$(get mowbite_failed)" ]; then
    log "mowbite: not again, $target didn't start before"
    status mowbite skipped_failed
    return 0
  fi
  back=$repo:prev-$(short "$before")
  docker tag "$before" "$back" && log "mowbite: kept the version before as $back"
  set_image "$APP" "$current" "$target" || { log "mowbite: the compose file can't be changed"; status mowbite error compose; return 1; }
  log "mowbite: $current -> $target"
  compose "$APP" up -d --no-deps "$(service "$APP")" >> "$LOG" 2>&1
  if app_up; then
    v=$(app version | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
    log "mowbite: updated to $v"
    status mowbite updated "$(now)" "$v"
    return 0
  fi
  # back to what ran before, and that version left out from now on
  log "mowbite: didn't answer after the update, back to $back"
  status mowbite_failed "$pulled"
  set_image "$APP" "$target" "$back"
  compose "$APP" up -d --no-deps "$(service "$APP")" >> "$LOG" 2>&1
  if app_up; then status mowbite rolled_back; else status mowbite error rollback; fi
  return 1
}

# --- OpenMower ---

# the planner talks to OpenMower as its external planner, that needs edge
planner_on() { exists "$PLANNER" || grep -qs '^ *OM_PLANNER=["]*external' "$(label "$OM" project.working_dir)/.env"; }
om_env() { echo "$(label "$OM" project.working_dir)/.env"; }
om_version() { sed -n 's/^ *VERSION=["]*\([^"]*\)["]*.*/\1/p' "$(om_env)" | head -n1; }
set_om_version() {
  cp "$(om_env)" "$(om_env).before-update" && sed -i "s/^\( *VERSION=\).*/\1\"$1\"/" "$(om_env)"
}

# OpenMower runs again: the app sees the mower idle in the dock within six minutes
om_up() {
  sleep 30
  n=0
  while [ $n -lt 33 ]; do
    status alive "$(now)"
    docked && return 0
    sleep 10
    n=$((n + 1))
  done
  return 1
}

update_openmower() {
  channel=$(conf openmower off)
  exists "$OM" || return 0
  ref=$(docker inspect -f '{{.Config.Image}}' "$OM")
  repo=${ref%:*}
  case $channel in
  off) return 0 ;;
  check | edge) want=$(om_version) ;;
  release) want=latest ;;
  esac
  [ "$channel" = edge ] && want=edge
  if [ "$want" != edge ] && planner_on; then
    log "openmower: stays on edge, the MowBite Planner needs it"
    status openmower error planner_needs_edge
    return 1
  fi
  target=$repo:$want
  remote=$(remote_digest "$target")
  [ -n "$remote" ] || { log "openmower: can't reach the registry for $target"; status openmower error registry; return 1; }
  if [ "$target" = "$ref" ] && docker image inspect -f '{{join .RepoDigests " "}}' "$ref" | grep -q "@$remote"; then
    status openmower current "$target"
    return 0
  fi
  if [ "$channel" = check ]; then
    status openmower newer "$target"
    return 0
  fi
  [ "$remote" = "$(get openmower_failed)" ] && { status openmower skipped_failed "$target"; return 0; }
  before=$(docker inspect -f '{{.Image}}' "$OM")
  need=$(need_mb "$target" "$before")
  free=$(free_mb)
  if [ -z "$need" ] || [ -z "$free" ] || [ $((need + 1024)) -gt "$free" ]; then
    log "openmower: not enough room for $target (needs ${need:-?} MB and 1 GB to spare, ${free:-?} MB free), it stays as it is"
    status openmower nospace "${need:-?}" "${free:-?}"
    return 1
  fi
  back=$repo:prev-$(short "$before")
  docker tag "$before" "$back" && log "openmower: kept the version before as $back"
  old_version=$(om_version)
  [ "$want" = "$old_version" ] || set_om_version "$want"
  log "openmower: $ref -> $target (needs $need MB, $free MB free)"
  if ! compose "$OM" pull >> "$LOG" 2>&1; then
    log "openmower: pull failed, it stays as it is"
    [ "$want" = "$old_version" ] || set_om_version "$old_version"
    status openmower error pull
    return 1
  fi
  compose "$OM" up -d >> "$LOG" 2>&1
  if om_up; then
    log "openmower: updated to $target"
    status openmower updated "$(now)" "$target"
    # the planner is built on OpenMower's image: again on the new one
    exists "$PLANNER" && build_planner after_openmower
    return 0
  fi
  log "openmower: the mower isn't idle in the dock after the update, back to $back"
  status openmower_failed "$remote"
  docker tag "$back" "$ref"
  [ "$want" = "$old_version" ] || set_om_version "$old_version"
  compose "$OM" up -d >> "$LOG" 2>&1
  if om_up; then status openmower rolled_back; else status openmower error rollback; fi
  return 1
}

# --- the planner ---

# where it's built from: only a stack that builds from github is updated, a local copy is someone's own
planner_context() { compose "$PLANNER" config 2>/dev/null | sed -n 's/^ *context: *//p' | head -n1; }
planner_commit() { wget -q -T 15 -O - https://api.github.com/repos/mkaaaaaay/mowbite-planner/commits/main | sed -n 's/^  "sha": *"\([0-9a-f]*\)".*/\1/p' | head -n1; }

# it answers within three minutes of its start
planner_up() {
  since=$1
  n=0
  while [ $n -lt 18 ]; do
    sleep 10
    status alive "$(now)"
    docker logs --since "$since" "$PLANNER" 2>&1 | grep -q 'MowBite Planner answers' && return 0
    n=$((n + 1))
  done
  return 1
}

# build it again from its own context (also a local one, after OpenMower changed under it) and start it
build_planner() {
  why=$1
  img=$(docker inspect -f '{{.Config.Image}}' "$PLANNER")
  before=$(docker inspect -f '{{.Image}}' "$PLANNER")
  back=${img%:*}:prev-$(short "$before")
  docker tag "$before" "$back" && log "planner: kept the version before as $back"
  log "planner: building ($why)"
  # never --pull: it has to be built on the OpenMower that runs
  if ! timeout 900 docker compose -p "$(label "$PLANNER" project)" --project-directory "$(label "$PLANNER" project.working_dir)" \
    -f "$(stackfile "$PLANNER")" build >> "$LOG" 2>&1; then
    log "planner: the build failed, the one before keeps running"
    status planner error build
    return 1
  fi
  since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  compose "$PLANNER" up -d --no-build >> "$LOG" 2>&1
  if planner_up "$since"; then
    log "planner: running again"
    status planner updated "$(now)" "$(get planner_commit_wanted)"
    return 0
  fi
  log "planner: didn't answer after the build, back to $back"
  docker tag "$back" "$img"
  compose "$PLANNER" up -d --no-build >> "$LOG" 2>&1
  if planner_up "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; then status planner rolled_back; else status planner error rollback; fi
  return 1
}

update_planner() {
  [ "$(conf planner off)" = main ] || return 0
  exists "$PLANNER" || return 0
  case $(planner_context) in
  https://github.com/* | git@github.com:*) ;;
  *) status planner local; return 0 ;;
  esac
  want=$(planner_commit)
  [ -n "$want" ] || { status planner error github; return 1; }
  [ "$want" = "$(get planner_built)" ] && { status planner current; return 0; }
  status planner_commit_wanted "$want"
  build_planner "main $(echo "$want" | cut -c1-7)" && status planner_built "$want"
}

# --- leftovers ---

# older rollback tags (the app's: two, the big ones: none), then what nothing uses and the build cache
tidy() {
  for c in "$APP:$KEEP" "$OM:$KEEP_BIG" "$PLANNER:$KEEP_BIG"; do
    name=${c%:*}
    keep=${c##*:}
    exists "$name" || continue
    img=$(docker inspect -f '{{.Config.Image}}' "$name")
    docker images --format '{{.CreatedAt}}|{{.Repository}}:{{.Tag}}' "${img%:*}" | grep '|.*:prev-' | sort -r | tail -n +$((keep + 1)) |
      cut -d'|' -f2 | while read -r t; do docker rmi "$t" > /dev/null 2>&1 && log "removed $t"; done
  done
  freed=$(docker image prune -f 2>/dev/null | sed -n 's/^Total reclaimed space: //p')
  # (a test on a pc that builds other things too: PRUNE_BUILD_CACHE=0)
  [ "${PRUNE_BUILD_CACHE:-1}" = 0 ] || cache=$(docker builder prune -f 2>/dev/null | sed -n 's/^Total: *//p')
  log "tidied up: images ${freed:-0B}, build cache ${cache:-0B}, $(free_mb) MB free"
}

# itself, last: its new container ends this one
update_self() {
  me=$(docker inspect -f '{{.Config.Image}}' "$(hostname)" 2>/dev/null)
  [ -n "$me" ] || return
  old=$(docker inspect -f '{{.Image}}' "$(hostname)")
  docker pull -q "$me" > /dev/null 2>&1 || return
  [ "$(docker image inspect -f '{{.Id}}' "$me")" = "$old" ] && return
  log "updating the updater"
  compose "$(hostname)" up -d --no-deps "$(service "$(hostname)")" >> "$LOG" 2>&1
}

# all parts, OpenMower first (the planner is built on it), then the planner, then the app
run() {
  why=$1
  status checked "$(now)"
  # whether there's a newer OpenMower needs no dock
  [ "$(conf openmower off)" = check ] && update_openmower
  if ! docked; then
    log "skipped ($why): the mower isn't idle in the dock"
    status result waiting
    return 2
  fi
  [ "$(conf openmower off)" = check ] || update_openmower
  docked && update_planner
  update_app
  tidy
  status result done
  [ "$why" = request ] || update_self
}

# the days it may run: daily or the weekdays 1-7 (monday 1)
today_ok() {
  days=$(conf days daily)
  [ "$days" = daily ] && return 0
  case ",$days," in *",$(date +%u),"*) return 0 ;; esac
  return 1
}

log "started"
status alive "$(now)"
# the night's try: at the time set, then every 10 minutes for 3 hours while the mower isn't in the dock
tried=""
retry=0
while :; do
  status alive "$(now)"
  if [ -f "$REQ" ]; then
    rm -f "$REQ"
    run request
  fi
  day=$(date +%F)
  if [ "$tried" != "$day" ] && [ "$(date +%H:%M)" = "$(conf at 03:00)" ] && today_ok; then
    tried=$day
    retry=0
    run night
    [ $? -eq 2 ] && retry=1
  elif [ "$retry" -ge 1 ] && [ "$retry" -le 18 ] && [ $(($(date +%s) / 60 % 10)) -eq 0 ]; then
    retry=$((retry + 1))
    run night
    [ $? -eq 2 ] || retry=0
  fi
  sleep 60
done
