#!/bin/sh
# MowBite's updater, a container of its own next to the app (compose.yaml, service updater): the only one with docker.
# once a night at the time set in the app, and when the app asks, with the mower idle in the dock: the app's image as
# the channel picked (beta = :latest from main, stable = the newest release without a dash), pulled and started
# through the stack's own compose file, so dockge shows the same. it only counts when the app answers afterwards,
# otherwise it goes back to the image before and leaves that version out from then on. after that the leftovers go:
# older rollback tags (two are kept), images nothing uses, the build cache. OpenMower's image is only checked
#
# files in the app's data volume: update.conf (the app writes it), update.request (the app: now), update.status
# and update.log (written here). the app: http://mowbite:8080 on the stack's network
APP=${MOWBITE_SERVICE:-mowbite}
D=/data
CONF=$D/update.conf
STATUS=$D/update.status
LOG=$D/update.log
REQ=$D/update.request
KEEP=2

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

# the stack the app runs in, from its container: compose project, folder and file
label() { docker inspect -f "{{index .Config.Labels \"com.docker.compose.$1\"}}" "$APP" 2>/dev/null; }
service() { label service; }
compose() {
  docker compose -p "$(label project)" --project-directory "$(label project.working_dir)" -f "$(label project.config_files | cut -d, -f1)" "$@"
}

# a registry's digest of image:tag (ghcr.io and docker hub, anonymously), empty when it can't be had
remote_digest() {
  ref=$1
  repo=${ref%:*}
  tag=${ref##*:}
  case $repo in
  ghcr.io/*) host=ghcr.io; name=${repo#ghcr.io/}; token_url="https://ghcr.io/token?scope=repository:$name:pull" ;;
  */*/*) return ;;
  *) host=registry-1.docker.io; name=$repo; case $name in */*) ;; *) name=library/$name ;; esac
    token_url="https://auth.docker.io/token?service=registry.docker.io&scope=repository:$name:pull" ;;
  esac
  token=$(wget -q -T 15 -O - "$token_url" | sed -n 's/.*"token": *"\([^"]*\)".*/\1/p')
  wget -S -q -T 15 -O /dev/null --header "Authorization: Bearer $token" \
    --header 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' \
    "https://$host/v2/$name/manifests/$tag" 2>&1 | sed -n 's/^ *[Dd]ocker-[Cc]ontent-[Dd]igest: *\([^ \r]*\).*/\1/p' | head -n1
}

# the stable channel: the newest github release that isn't a pre-release, as the image's version tag
stable_tag() {
  case $1 in ghcr.io/mkaaaaaay/mowbite) ;; *) return ;; esac
  wget -q -T 15 -O - https://api.github.com/repos/mkaaaaaay/mowbite/releases/latest |
    sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1
}

# the image line of the app's service in the compose file, changed to another image
set_image() {
  file=$(label project.config_files | cut -d, -f1)
  old=$1
  new=$2
  [ "$old" = "$new" ] && return 0
  cp "$file" "$file.before-update" &&
    sed -i "s|^\( *image: *\)$old *\$|\1$new|" "$file" &&
    grep -q "image: *$new *\$" "$file"
}

# the app answers again within two minutes
healthy() {
  n=0
  while [ $n -lt 24 ]; do
    sleep 5
    status alive "$(now)"
    app version | grep -q '"version"' && return 0
    n=$((n + 1))
  done
  return 1
}

# older rollback tags of the app's image (two stay), then what nothing uses and the build cache
tidy() {
  repo=$1
  docker images --format '{{.CreatedAt}}|{{.Repository}}:{{.Tag}}' "$repo" | grep '|.*:prev-' | sort -r | tail -n +$((KEEP + 1)) |
    cut -d'|' -f2 | while read -r t; do docker rmi "$t" > /dev/null 2>&1 && log "removed $t"; done
  freed=$(docker image prune -f 2>/dev/null | sed -n 's/^Total reclaimed space: //p')
  # (a test on a pc that builds other things too: PRUNE_BUILD_CACHE=0)
  [ "${PRUNE_BUILD_CACHE:-1}" = 0 ] || cache=$(docker builder prune -f 2>/dev/null | sed -n 's/^Total: *//p')
  log "tidied up: images ${freed:-0B}, build cache ${cache:-0B}"
}

update_app() {
  why=$1
  channel=$(conf mowbite off)
  current=$(docker inspect -f '{{.Config.Image}}' "$APP" 2>/dev/null)
  [ -n "$current" ] || { log "no container $APP"; status result error no_app; return 1; }
  repo=${current%:*}
  # after a rollback the compose file holds a prev- tag, the channel still says where it belongs
  case $channel in
  beta) target=$repo:latest ;;
  stable)
    v=$(stable_tag "$repo")
    [ -n "$v" ] || { log "no stable release found for $repo"; status result error no_stable; return 1; }
    target=$repo:$v ;;
  *) [ "$why" = request ] || return 0; target=$current ;;
  esac
  case $(app "update?docked") in
  1*) ;;
  *) log "skipped ($why): the mower isn't idle in the dock"; status result waiting not_docked; return 2 ;;
  esac
  before=$(docker inspect -f '{{.Image}}' "$APP")
  status checked "$(now)"
  if ! docker pull -q "$target" > /dev/null 2>&1; then
    log "pull of $target failed"
    status result error pull
    return 1
  fi
  pulled=$(docker image inspect -f '{{.Id}}' "$target")
  if [ "$pulled" = "$before" ] && [ "$target" = "$current" ]; then
    log "up to date: $target"
    status result current
    tidy "$repo"
    return 0
  fi
  if [ "$pulled" = "$(get failed)" ]; then
    log "not again: $target ($pulled) didn't start before"
    status result skipped_failed
    return 0
  fi
  back=$repo:prev-$(echo "$before" | sed 's/^sha256://' | cut -c1-8)
  docker tag "$before" "$back" && log "kept the version before as $back"
  set_image "$current" "$target" || { log "the compose file can't be changed"; status result error compose; return 1; }
  log "updating ($why): $current -> $target"
  compose up -d --no-deps "$(service)" >> "$LOG" 2>&1
  if healthy; then
    log "updated, $(app version)"
    status result updated
    status updated "$(now)"
    status version "$(app version | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
    tidy "$repo"
    return 0
  fi
  # back to what ran before, and that version left out from now on
  log "the app didn't answer after the update, back to $back"
  status failed "$pulled"
  set_image "$target" "$back"
  compose up -d --no-deps "$(service)" >> "$LOG" 2>&1
  if healthy; then status result rolled_back; else status result error rollback; fi
  return 1
}

# OpenMower's image: only whether there's a newer one, nothing is changed
check_openmower() {
  [ "$(conf openmower check)" = off ] && return
  ref=$(docker inspect -f '{{.Config.Image}}' open_mower_ros 2>/dev/null)
  [ -n "$ref" ] || return
  have=$(docker image inspect -f '{{join .RepoDigests " "}}' "$ref" 2>/dev/null)
  remote=$(remote_digest "$ref")
  [ -n "$remote" ] || return
  case " $have " in
  *"@$remote "*) status openmower "$ref current" ;;
  *) status openmower "$ref newer" ;;
  esac
}

# itself, last: its new container ends this one
update_self() {
  me=$(docker inspect -f '{{.Config.Image}}' "$(hostname)" 2>/dev/null)
  [ -n "$me" ] || return
  old=$(docker inspect -f '{{.Image}}' "$(hostname)")
  docker pull -q "$me" > /dev/null 2>&1 || return
  [ "$(docker image inspect -f '{{.Id}}' "$me")" = "$old" ] && return
  log "updating the updater"
  compose up -d --no-deps "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$(hostname)")" >> "$LOG" 2>&1
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
    update_app request
    check_openmower
  fi
  at=$(conf at 03:00)
  day=$(date +%F)
  hm=$(date +%H:%M)
  if [ "$tried" != "$day" ] && [ "$hm" = "$at" ]; then
    tried=$day
    retry=0
    update_app night
    [ $? -eq 2 ] && retry=1
    check_openmower
    [ "$(conf mowbite off)" = off ] || update_self
  elif [ "$retry" -ge 1 ] && [ "$retry" -le 18 ] && [ $(( $(date +%s) / 60 % 10 )) -eq 0 ]; then
    retry=$((retry + 1))
    update_app night
    [ $? -eq 2 ] || retry=0
  fi
  sleep 60
done
