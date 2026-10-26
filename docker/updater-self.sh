#!/bin/sh
# the updater's own update (updater.sh, update_self): a container of its own on the image the updater ran so far, so it
# stays while the updater is replaced. $1 the updater's image tag, now on the new image, $2 the tag of the one it ran
# so far. starts it on the new one and sees it come up (it says so in its status within two minutes), else starts it
# on the one before again and leaves the new one out
. /updater-lib.sh
ref=$1
old=$2
new=$(docker image inspect -f '{{.Id}}' "$ref" 2>/dev/null)
[ -n "$new" ] && docker image inspect "$old" > /dev/null 2>&1 || exit 1
svc=$(label "$ME" service)
t0=$(now)

log "updater: starting its new version"
compose 300 "$ME" up -d --no-deps "$svc" > /dev/null 2>&1
n=0
while [ $n -lt 24 ]; do
  sleep 5
  # (started: its time and its image, written as it starts. then still the same start half a minute later: no crash loop)
  # shellcheck disable=SC2046
  set -- $(get started)
  if [ "${1:-0}" -ge "$t0" ] && [ "$2" = "$new" ] && [ "$(docker inspect -f '{{.State.Running}}' "$ME" 2>/dev/null)" = true ]; then
    began=$(docker inspect -f '{{.State.StartedAt}}' "$ME")
    sleep 30
    if [ "$(docker inspect -f '{{.State.Running}} {{.State.StartedAt}}' "$ME" 2>/dev/null)" = "true $began" ]; then
      log "updater: its new version runs"
      exit 0
    fi
  fi
  n=$((n + 1))
done

log "updater: its new version didn't come up, back to the one before"
status updater_failed "$new"
docker tag "$old" "$ref"
compose 300 "$ME" up -d --no-deps "$svc" > /dev/null 2>&1
