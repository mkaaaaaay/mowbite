#!/bin/sh
# MowBite's updater, a container of its own next to the app (compose.yaml, service updater): the only one with docker.
# three parts, each on its channel and each automatic or not (set in the app, Settings, Updates):
#   MowBite    beta (:latest from main) or stable (the newest release without a dash)
#   OpenMower  edge, latest (its release) or what its .env has. latest has no OM_PLANNER=external, the MowBite Planner
#              doesn't work with it, the app says so
#   planner    where its stack builds from (github), built again on the mower when that moved or OpenMower changed
#              under it, never a local copy
# it looks every 6 hours whether there's something new for each, updates a part when the app asks, and the automatic
# ones at the time and on the days set. never while the mower works: only with it idle in the dock, asked again right
# before anything restarts, a download or build stopped when it leaves. all through the stacks' own compose files, so
# dockge shows the same, and the files it changes keep their owner and rights. a part counts as updated when it runs on
# its new image and answers, otherwise it goes back to what ran before and leaves that version out; restarted again only
# while OpenMower doesn't drive the mower. only with room to spare, OpenMower with room for its old and its new image at
# once. stopped halfway (power gone, the container restarted), it puts back what it changed and looks again at what it
# had restarted, at its next start. images built here (not from a registry) aren't replaced by itself and never deleted
# by itself. last the leftovers go: its older rollback tags, images nothing uses, the build cache. making more room is
# the app's to ask. what it does right now goes to the status as progress, for the app's bar
. /updater-lib.sh
# rollback tags (rb-<time>-<image>) kept once all runs again: the app's are small, OpenMower's and the planner's are GBs
KEEP=2
KEEP_BIG=0
CHECK_EVERY=21600
# the night's window: from the time set, retried every 10 minutes for 3 hours while the mower isn't in the dock
WINDOW=180
# MB free a part needs before it starts (OpenMower: its download x5 and 1 GB more)
ROOM_APP=300
ROOM_PLANNER=800
# seconds anything over the network or with docker may take, so nothing hangs for good
T_REGISTRY=60
T_PULL=1800
T_UP=300
T_BUILD=900

alive() { status alive "$(now)"; }
# (APP_URL: a test with the updater elsewhere)
app() { wget -q -T 10 -O - "${APP_URL:-http://$APP:8080}/cgi-bin/$1" 2>/dev/null; }
# the mower as the app sees it: "1" idle in the dock, else "0 <state>" (MOWING, IDLE out of the dock or with the
# dock's power gone, unknown while OpenMower doesn't answer), nothing while MowBite doesn't answer
mower() { app "update?docked" | head -n1; }
docked() { [ "$(mower)" = 1 ]; }
# OpenMower doesn't drive the mower: idle, in the dock or not, or no answer from it at all. no answer from MowBite: no
# telling, so not
quiet() { case $(mower) in 1 | "0 IDLE" | "0 unknown") return 0 ;; *) return 1 ;; esac; }
image_of() { docker inspect -f '{{.Image}}' "$1" 2>/dev/null; }
ref_of() { docker inspect -f '{{.Config.Image}}' "$1" 2>/dev/null; }
id_of() { docker image inspect -f '{{.Id}}' "$1" 2>/dev/null; }
running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
day_of() { docker image inspect -f '{{.Created}}' "$1" 2>/dev/null | cut -c1-10; }
digests() { docker image inspect -f '{{join .RepoDigests " "}}' "$1" 2>/dev/null; }
# the digests the registry knows the image of a container by: its repo digests, and its id (with containerd's image
# store that is the registry's digest itself, and an image replaced under its tag has no repo digests any more)
known_as() { printf '%s @%s' "$(digests "$1")" "$1"; }
# an image built here: there, but never pulled or pushed. it can't be downloaded again
built_here() { docker image inspect "$1" > /dev/null 2>&1 && [ -z "$(digests "$1")" ]; }
# a registry's digest of image:tag, empty when it can't be had
remote_digest() { timeout $T_REGISTRY docker buildx imagetools inspect "$1" --format '{{.Manifest.Digest}}' 2>/dev/null; }
# a text as a sed pattern
re() { printf '%s' "$1" | sed 's/[][\.*^$/|]/\\&/g'; }
# MB free where docker keeps its images (the stacks are on the same disk on OpenMowerOS)
free_mb() { df -Pm "$(label "$APP" project.working_dir)" 2>/dev/null | awk 'NR == 2 {print $4}'; }
room_for() {
  f=$(free_mb)
  [ -n "$f" ] && [ "$f" -ge "$1" ]
}
# the container of a part
box() { case $1 in openmower) echo "$OM" ;; planner) echo "$PLANNER" ;; *) echo "$APP" ;; esac; }
# the file of a container's stack that names its image
stackfile() {
  for f in $(label "$1" project.config_files | tr ',' ' '); do
    grep -q "^[[:space:]]*image:[[:space:]]*$(re "$2")[[:space:]]*\$" "$f" 2>/dev/null && echo "$f" && return
  done
}

# --- files of the stacks ---

# a file of a part's stack changed by a sed expression: kept once as it was (.before-update), written whole and moved in
# place, with the owner and the rights it had, never through a link. what it wrote is noted (changed_<part> <file>
# <md5>), so only that change is ever put back. 1: nothing changed
change_file() {
  local tmp
  [ -f "$2" ] && [ ! -L "$2" ] || return 1
  tmp=$(mktemp "$2.XXXXXX") || return 1
  if cp -p "$2" "$tmp" && mv "$tmp" "$2.before-update" && tmp=$(mktemp "$2.XXXXXX") && sed "$3" "$2" > "$tmp" &&
    chown "$(stat -c %u:%g "$2")" "$tmp" && chmod "$(stat -c %a "$2")" "$tmp" && mv "$tmp" "$2"; then
    status "changed_$1" "$2" "$(md5sum < "$2" | cut -d' ' -f1)"
    return 0
  fi
  rm -f "$tmp"
  return 1
}
# a part's change put back (the file as it was, moved in place whole), or kept for good. either way the copy goes
undo_change() {
  local tmp
  # shellcheck disable=SC2046
  set -- "$1" $(get "changed_$1")
  [ -n "$2" ] && [ -f "$2.before-update" ] && [ ! -L "$2" ] || return 0
  tmp=$(mktemp "$2.XXXXXX") || return 1
  if cp -p "$2.before-update" "$tmp" && mv "$tmp" "$2"; then
    log "$1: $2 back as it was"
    keep_change "$1"
    return 0
  fi
  rm -f "$tmp"
  return 1
}
keep_change() {
  # shellcheck disable=SC2046
  set -- "$1" $(get "changed_$1")
  [ -n "$2" ] && rm -f "$2.before-update"
  status "changed_$1"
}

# --- images ---

# the image a part ran before, kept under a tag of its own to go back to
keep_back() {
  t=$1:rb-$(now)-$(echo "$2" | sed 's/^sha256://' | cut -c1-8)
  docker tag "$2" "$t" && echo "$t"
}
# nothing changed after all: the tag back on the image kept, the rollback tag made for it gone
undo_back() {
  docker tag "$1" "$2" 2> /dev/null
  docker rmi "$1" > /dev/null 2>&1
}

# --- the progress, for the app's bar ---

# what it does right now: "<part> <step> <percent or -> <since> [<done> <of>]", the step's start kept while it lasts.
# steps: prepare, download, extract, build, restart, wait, back
progress() {
  local p since
  p=$(get progress)
  case $p in "$1 $2 "*) since=$(echo "$p" | cut -d' ' -f4) ;; *) since=$(now) ;; esac
  # shellcheck disable=SC2086
  status progress "$1" "$2" "${3:--}" "$since" $4 $5
  alive
}
# compose's progress as json (docker pull shows none off a terminal), a step and its percent a line when they change:
# a pull's bytes of the layers it fetches (their sizes from the file "sizes" when known), then the layers unpacked, a
# build's steps. what compose says besides goes to the log, of a failed build the end of its output too. last
# "@exit <compose's exit code>"
progress_awk='
BEGIN { while ((getline l < sizes) > 0) { split(l, f, " "); size[f[1]] = f[2] + 0 } close(sizes) }
function val(k) { if (!match($0, "\"" k "\":\"[^\"]*\"")) return ""; return substr($0, RSTART + length(k) + 4, RLENGTH - length(k) - 5) }
function num(k) { if (!match($0, "\"" k "\":[0-9]+")) return 0; return substr($0, RSTART + length(k) + 3, RLENGTH - length(k) - 3) + 0 }
function say(line) { if (line != last) { print line; fflush(); last = line } }
/^@exit / { rc = $2; next }
!/^\{/ { if ($0 != "") print >> logf; next }
/"error":true/ { m = $0; sub(/.*"message":"/, "", m); sub(/"\}[[:space:]]*$/, "", m); gsub(/\\n/, "\n", m); gsub(/\\"/, "\"", m); gsub(/\\u0026/, "\\&", m); gsub(/\\u003c/, "<", m); gsub(/\\u003e/, ">", m); print m >> logf; next }
/"status":"Error"/ { print val("id") ": " val("text") " " val("details") >> logf; next }
/"parent_id":"/ {
  id = val("id"); t = val("text"); seen[id] = 1
  if (t == "Already exists") had[id] = 1
  else if (t == "Downloading") { got[id] = num("current"); if (!size[id]) size[id] = num("total") }
  else if (t == "Download complete" || t == "Verifying Checksum" || t == "Extracting") fetched[id] = 1
  else if (t == "Pull complete") { fetched[id] = 1; unpacked[id] = 1 }
  n = 0; f = 0; u = 0; all = 0; have = 0; ub = 0
  for (l in seen) {
    if (had[l]) continue
    n++; all += size[l]
    if (fetched[l]) { f++; have += size[l] } else have += got[l] < size[l] ? got[l] : size[l]
    if (unpacked[l]) { u++; ub += size[l] }
  }
  if (!n) next
  if (f < n) say("download " (all ? int(100 * have / all) : "-"))
  else say("extract " (all ? int(100 * ub / all) : int(100 * u / n)) " " u " " n)
  next
}
/"vertexes"/ {
  k = split($0, v, /\{"digest":"/)
  for (i = 2; i <= k; i++) {
    d = substr(v[i], 1, index(v[i], "\"") - 1)
    if (v[i] ~ /"name":"\[[^]]* [0-9]+\/[0-9]+\]/) step[d] = 1
    if (v[i] ~ /"completed":"/ || v[i] ~ /"cached":true/) done[d] = 1
  }
  s = 0; c = 0
  for (d in step) { s++; if (done[d]) c++ }
  if (s) say("build " int(100 * c / s) " " c " " s)
  next
}
/"logs"/ { k = split($0, v, /"data":"/); for (i = 2; i <= k; i++) { out++; tail[out % 40] = substr(v[i], 1, index(v[i], "\"") - 1) } next }
END {
  if (rc != 0) for (i = (out > 40 ? out - 39 : 1); i <= out; i++) { cmd = "base64 -d >> \"" logf "\" 2>/dev/null"; print tail[i % 40] | cmd; close(cmd) }
  print "@exit " (rc + 0)
}'
# a compose pull or build ($2...) with the progress of part $1: compose's exit code, 2 when the mower left the dock
# meanwhile (compose is stopped then: a build takes the mower's cpu, it isn't for while it works)
with_progress() {
  local part="$1" watch rc
  shift
  rm -f "$STATE/left"
  (while sleep 30; do docked || { : > "$STATE/left"; pkill -f -- '--progress json'; exit 0; }; done) &
  watch=$!
  { "$@" 2>&1; echo "@exit $?"; } | awk -v sizes="$STATE/layers" -v logf="$LOG" "$progress_awk" | (
    rc=1
    while read -r w a b c; do
      if [ "$w" = @exit ]; then rc=$a; else progress "$part" "$w" "$a" "$b" "$c"; fi
    done
    exit "$rc"
  )
  rc=$?
  kill "$watch" 2> /dev/null
  if [ -f "$STATE/left" ]; then
    rm -f "$STATE/left"
    log "$part: stopped, the mower left the dock"
    return 2
  fi
  return $rc
}
# an image pulled through compose, for its progress: a project of its own that only names it, nothing is created
pull_image() {
  printf 'services:\n  pull:\n    image: "%s"\n' "$1" | timeout $T_PULL docker compose -p mowbite-updater-pull --project-directory "$STATE" -f - --progress json pull
}

arch() { case $(uname -m) in aarch64 | arm64) echo arm64 ;; *) echo amd64 ;; esac; }
# the layers of the newest image of ref for this machine, as compose's progress names them: "<first 12 of the digest>
# <packed bytes>" a line, in the image's order. nothing when it can't be had
layers() {
  dg=$(timeout $T_REGISTRY docker buildx imagetools inspect "$1" --format "{{range .Manifest.Manifests}}{{if and (eq .Platform.Architecture \"$(arch)\") (eq .Platform.OS \"linux\")}}{{.Digest}}{{end}}{{end}}" 2>/dev/null)
  # (an image for one platform only has no list to pick from: its own manifest)
  timeout $T_REGISTRY docker buildx imagetools inspect --raw "${1%:*}@${dg:-$(remote_digest "$1")}" 2>/dev/null | awk '
    BEGIN { RS = "{" }
    /"mediaType" *: *"[^"]*(layer|rootfs)/ && match($0, /"digest" *: *"sha256:[0-9a-f]+"/) {
      d = substr($0, RSTART, RLENGTH); sub(/.*sha256:/, "", d)
      if (match($0, /"size" *: *[0-9]+/)) { s = substr($0, RSTART, RLENGTH); gsub(/[^0-9]/, "", s); print substr(d, 1, 12), s }
    }'
}

# the MB the newest image of ref needs that the local image doesn't have yet: its missing layers, packed size x5.
# nothing when any of it can't be had: then there's no telling, and that's no room
need_mb() {
  have=$(docker image inspect -f '{{range .RootFS.Layers}}{{.}} {{end}}' "$2" 2>/dev/null)
  ids=$(mktemp)
  sizes=$(mktemp)
  # (an image for one platform only has no list of platforms to pick from)
  { timeout $T_REGISTRY docker buildx imagetools inspect "$1" --format "{{json (index .Image \"linux/$(arch)\").RootFS.DiffIDs}}" 2>/dev/null ||
    timeout $T_REGISTRY docker buildx imagetools inspect "$1" --format '{{json .Image.RootFS.DiffIDs}}' 2>/dev/null; } | tr -d '[]" ' | tr ',' '\n' | grep . > "$ids"
  layers "$1" | cut -d' ' -f2 > "$sizes"
  if [ -s "$ids" ] && [ "$(wc -l < "$ids")" -eq "$(wc -l < "$sizes")" ]; then
    paste -d' ' "$ids" "$sizes" | awk -v have=" $have " '{ if (index(have, " " $1 " ") == 0) s += $2 } END { printf "%d\n", s * 5 / 1048576 }'
  fi
  rm -f "$ids" "$sizes"
}

# whether there's something new for a container: no, yes, switch (another channel picked), failed (the new one didn't
# start before, left out), local (an image built here, not from the registry: only updated when asked) or unknown
available() {
  cur=$(ref_of "$2")
  img=$(image_of "$2")
  remote=$(remote_digest "$3")
  if built_here "$img"; then
    s=local
  elif [ -z "$remote" ]; then
    s=unknown
  elif known_as "$img" | grep -q "@$remote"; then
    s=no
  elif [ "$remote" = "$(get "$1_failed")" ]; then
    s=failed
  elif [ "$cur" != "$3" ]; then
    s=switch
  else
    s=yes
  fi
  status "$1_available" "$s" "$3"
}

# --- starting a part and seeing it run ---

# a part started on what its tag says now, then seen running on the image $2 and answering: the app within two minutes
# (also the question the updater itself needs, whether the mower is in the dock), OpenMower within six (a fresh state
# from it twice, whatever it does), the planner within three. 1 when compose can't start it or it doesn't answer
restart() {
  progress "$1" restart
  compose $T_UP "$(box "$1")" up -d --no-deps "$(service "$(box "$1")")" >> "$LOG" 2>&1 || { log "$1: compose couldn't start it"; return 1; }
  seen "$1" "$2"
}
seen() {
  local c end ok
  c=$(box "$1")
  case $1 in mowbite) end=120 ;; planner) end=180 ;; *) end=360 ;; esac
  end=$(($(now) + end))
  ok=0
  while [ "$(now)" -lt "$end" ]; do
    sleep 10
    progress "$1" wait
    if [ "$(image_of "$c")" = "$2" ] && running "$c"; then
      case $1 in
      mowbite) app version | grep -q '"version"' && mower | grep -Eqx '1|0 [A-Za-z_]+' && return 0 ;;
      openmower) case $(mower) in 1 | "0 "[A-Z]*) ok=$((ok + 1)) ;; *) ok=0 ;; esac ;;
      planner) docker logs --since "$(docker inspect -f '{{.State.StartedAt}}' "$c")" "$c" 2>&1 | grep -q 'MowBite Planner answers' && return 0 ;;
      esac
      [ $ok -ge 2 ] && return 0
    else
      ok=0
    fi
  done
  return 1
}

# the new version of a part didn't run: back to the one before ($2, a rollback tag) under its tag ($3), the file it
# changed put back, started again. only while OpenMower doesn't drive the mower (the app always: it doesn't), else left
# for the next run to look at (1). the version left out from now on ($4)
go_back() {
  if [ "$1" != mowbite ] && ! quiet; then
    log "$1: didn't run as it should, but the mower isn't idle (or MowBite doesn't answer): nothing restarted, looked at again next time"
    status "$1" unconfirmed
    return 1
  fi
  log "$1: didn't run as it should, back to $2"
  progress "$1" back
  [ -n "$4" ] && status "$1_failed" "$4"
  docker tag "$2" "$3"
  undo_change "$1"
  if restart "$1" "$(id_of "$2")"; then status "$1" rolled_back; else status "$1" error rollback; fi
  status "pending_$1"
  return 0
}

# the parts restarted on a new version and not seen running yet (a run stopped right then, or the mower wasn't idle):
# started if a restart was cut off, then seen running, or back to the one before
settle() {
  for p in mowbite openmower planner; do
    # shellcheck disable=SC2046
    set -- $(get "pending_$p")
    [ -n "$1" ] || continue
    log "$p: was restarted on a new version and not seen running, looking now"
    if restart "$p" "$(id_of "$2")"; then
      log "$p: runs"
      keep_change "$p"
      status "pending_$p"
      status "$p" updated "$(now)"
    else
      go_back "$p" "$1" "$2" "$(id_of "$2")"
    fi
  done
  status progress
}

# --- MowBite ---

# the stable channel: the newest github release that isn't a pre-release, as the image's version tag (only MowBite's
# own image has them)
stable_tag() {
  case $1 in ghcr.io/mkaaaaaay/mowbite) ;; *) return ;; esac
  v=$(wget -q -T 15 -O - https://api.github.com/repos/mkaaaaaay/mowbite/releases/latest | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1)
  valid "$v" "$TAG" && echo "$v"
}
app_target() {
  if [ "$(app_channel)" = stable ]; then
    v=$(stable_tag "$1")
    [ -n "$v" ] && echo "$1:$v"
  else
    echo "$1:latest"
  fi
}
app_version() { app version | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'; }
# the app's newest rollback tag on another image than the one that runs ($2), to go back to by hand
newest_back() {
  docker images --no-trunc --format '{{.Tag}} {{.ID}}' "$1" | grep '^rb-[0-9]*-' | sort -t- -k2,2nr | while read -r t id; do
    [ "$id" = "$2" ] || { echo "$t"; break; }
  done
}

check_app() {
  exists "$APP" || return
  repo=$(ref_of "$APP")
  repo=${repo%:*}
  status mowbite_running "$(app_version)" "$(day_of "$(image_of "$APP")")"
  if [ -n "$(stable_tag "$repo")" ]; then status mowbite_stable yes; else status mowbite_stable no; fi
  # a version to go back to by hand
  if [ -n "$(newest_back "$repo" "$(image_of "$APP")")" ]; then status mowbite_back yes; else status mowbite_back no; fi
  target=$(app_target "$repo")
  if [ -n "$target" ]; then available mowbite "$APP" "$target"; else status mowbite_available unknown none; fi
}

update_app() {
  progress mowbite prepare
  current=$(ref_of "$APP")
  [ -n "$current" ] && in_compose "$APP" || { log "mowbite: no container $APP from a compose file"; status mowbite error no_app; return 1; }
  repo=${current%:*}
  before=$(image_of "$APP")
  if built_here "$before" && [ -z "$MANUAL" ]; then
    log "mowbite: runs an image built here, left as it is (only updated when asked)"
    status mowbite local
    return 0
  fi
  room_for $ROOM_APP || { log "mowbite: less than $ROOM_APP MB free, nothing changed"; status mowbite nospace $ROOM_APP "$(free_mb)"; return 1; }
  target=$(app_target "$repo")
  [ -n "$target" ] || { log "mowbite: no stable release for $repo"; status mowbite error no_stable; return 1; }
  # kept before anything moves its tag (an image only built here is gone once its tag is on another one)
  back=$(keep_back "$repo" "$before")
  [ -n "$back" ] || { log "mowbite: the version before can't be kept, nothing changed"; status mowbite error keep; return 1; }
  layers "$target" > "$STATE/layers"
  with_progress mowbite pull_image "$target"
  case $? in
  0) ;;
  2) undo_back "$back" "$current"; return 2 ;;
  *) log "mowbite: pull of $target failed"; undo_back "$back" "$current"; status mowbite error pull; return 1 ;;
  esac
  pulled=$(id_of "$target")
  if [ "$pulled" = "$before" ] && [ "$target" = "$current" ]; then
    undo_back "$back" "$current"
    status mowbite current
    return 0
  fi
  if [ "$pulled" = "$(get mowbite_failed)" ]; then
    log "mowbite: not again, $target didn't start before"
    undo_back "$back" "$current"
    status mowbite skipped_failed
    return 0
  fi
  log "mowbite: kept the version before as $back"
  if [ "$target" != "$current" ]; then
    file=$(stackfile "$APP" "$current")
    if [ -z "$file" ] || ! change_file mowbite "$file" "s|^\([[:space:]]*image:[[:space:]]*\)$(re "$current")[[:space:]]*\$|\1$target|"; then
      log "mowbite: the compose file can't be changed, nothing changed"
      undo_back "$back" "$current"
      status mowbite error compose
      return 1
    fi
    if ! grep -q "^[[:space:]]*image:[[:space:]]*$(re "$target")[[:space:]]*\$" "$file"; then
      log "mowbite: the compose file didn't take the new image, nothing changed"
      undo_change mowbite
      undo_back "$back" "$current"
      status mowbite error compose
      return 1
    fi
  fi
  # the last word before it restarts
  if ! docked; then
    log "mowbite: the mower left the dock, nothing changed"
    undo_change mowbite
    undo_back "$back" "$current"
    return 2
  fi
  log "mowbite: $current -> $target"
  status pending_mowbite "$back" "$current"
  if restart mowbite "$pulled"; then
    v=$(app_version)
    log "mowbite: updated to $v"
    keep_change mowbite
    status pending_mowbite
    status mowbite updated "$(now)" "$v"
    return 0
  fi
  go_back mowbite "$back" "$current" "$pulled"
  # a version picked that didn't start: its image isn't kept for nothing
  [ "$target" = "$current" ] || docker rmi "$target" > /dev/null 2>&1
  return 1
}

# back to the version before, by hand (from the app): the newest rollback tag on another image, under the tag that
# runs now. what ran is kept the same way and left out of the automatic updates. it comes back when the one before
# doesn't answer
back_app() {
  current=$(ref_of "$APP")
  repo=${current%:*}
  before=$(image_of "$APP")
  to=$(newest_back "$repo" "$before")
  [ -n "$to" ] || { log "mowbite: no version before to go back to"; status mowbite error no_back; return 1; }
  progress mowbite back
  now_back=$(keep_back "$repo" "$before")
  [ -n "$now_back" ] || { status mowbite error keep; return 1; }
  log "mowbite: kept the version that ran as $now_back, back to $to"
  docker tag "$repo:$to" "$current"
  if restart mowbite "$(id_of "$repo:$to")"; then
    docker rmi "$repo:$to" > /dev/null 2>&1
    status mowbite_failed "$before"
    status mowbite back "$(now)" "$(app_version)"
    return 0
  fi
  log "mowbite: the version before didn't answer, again the one that ran"
  docker tag "$now_back" "$current"
  if restart mowbite "$before"; then
    docker rmi "$now_back" > /dev/null 2>&1
    status mowbite error back
  else
    status mowbite error rollback
  fi
  return 1
}

# --- OpenMower ---

# VERSION in its .env set to a tag, checked afterwards (and put back when it didn't take)
set_om_version() {
  change_file openmower "$(om_env)" "s/^\([[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}VERSION=\).*/\1\"$1\"/" || return 1
  [ "$(om_version)" = "$1" ] && return 0
  undo_change openmower
  return 1
}

check_openmower() {
  exists "$OM" || { status openmower_running none; return; }
  cur=$(ref_of "$OM")
  status openmower_running "${cur##*:}" "$(day_of "$(image_of "$OM")")"
  status openmower_env "$(om_version)"
  available openmower "$OM" "${cur%:*}:$(om_channel)"
}

update_openmower() {
  exists "$OM" || return 0
  progress openmower prepare
  in_compose "$OM" || { log "openmower: not run from a compose file, left as it is"; status openmower error not_compose; return 1; }
  ref=$(ref_of "$OM")
  repo=${ref%:*}
  before=$(image_of "$OM")
  # a build of its own can't be downloaded again: never replaced by itself
  if built_here "$before" && [ -z "$MANUAL" ]; then
    log "openmower: runs an image built here, left as it is (only updated when asked)"
    status openmower local
    return 0
  fi
  old_version=$(om_version)
  [ -n "$old_version" ] || { log "openmower: VERSION in $(om_env) can't be read, nothing changed"; status openmower error env; return 1; }
  want=$(om_channel)
  target=$repo:$want
  remote=$(remote_digest "$target")
  [ -n "$remote" ] || { log "openmower: can't reach the registry for $target"; status openmower error registry; return 1; }
  if [ "$target" = "$ref" ] && known_as "$before" | grep -q "@$remote"; then
    status openmower current
    return 0
  fi
  [ "$remote" = "$(get openmower_failed)" ] && { log "openmower: not again, $target didn't come up before"; status openmower skipped_failed; return 0; }
  [ "$want" != edge ] && exists "$PLANNER" && log "openmower: $want has no OM_PLANNER=external, the MowBite Planner won't work with it"
  need=$(need_mb "$target" "$before")
  free=$(free_mb)
  if [ -z "$need" ] || [ -z "$free" ] || [ $((need + 1024)) -gt "$free" ]; then
    log "openmower: not enough room for $target (needs ${need:-?} MB and 1 GB to spare, ${free:-?} MB free), it stays as it is"
    status openmower nospace "${need:-?}" "${free:-?}"
    return 1
  fi
  back=$(keep_back "$repo" "$before")
  [ -n "$back" ] || { log "openmower: the version before can't be kept, nothing changed"; status openmower error keep; return 1; }
  log "openmower: kept the version before as $back"
  if [ "$want" != "$old_version" ] && ! set_om_version "$want"; then
    log "openmower: VERSION in $(om_env) can't be changed, nothing changed"
    undo_back "$back" "$ref"
    status openmower error env
    return 1
  fi
  log "openmower: $ref -> $target (needs $need MB, $free MB free)"
  # only OpenMower itself: the stack's other containers (its app, the broker) stay as they are
  layers "$target" > "$STATE/layers"
  with_progress openmower compose $T_PULL "$OM" --progress json pull "$(service "$OM")"
  rc=$?
  # the last word before it restarts
  if [ $rc -eq 0 ] && ! docked; then
    log "openmower: the mower left the dock, it stays as it is"
    rc=2
  fi
  if [ $rc -ne 0 ]; then
    [ $rc -eq 2 ] || log "openmower: pull failed, it stays as it is"
    undo_change openmower
    undo_back "$back" "$ref"
    # a version picked that didn't come: its image isn't kept for nothing
    [ "$target" = "$ref" ] || docker rmi "$target" > /dev/null 2>&1
    [ $rc -eq 2 ] && return 2
    status openmower error pull
    return 1
  fi
  status pending_openmower "$back" "$ref"
  if restart openmower "$(id_of "$target")"; then
    log "openmower: updated to $target"
    keep_change openmower
    status pending_openmower
    status openmower updated "$(now)" "$want"
    # the planner is built on OpenMower's image: again on the new one, when that's what it's built on
    if exists "$PLANNER"; then
      base=$(planner_base)
      if [ "$base" = "$target" ]; then build_planner after_openmower; else log "planner: built on ${base:-?}, not on $target, left as it is"; fi
    fi
    return 0
  fi
  go_back openmower "$back" "$ref" "$remote" || return 1
  [ "$target" = "$ref" ] || docker rmi "$target" > /dev/null 2>&1
  return 1
}

# --- the planner ---

# where it's built from (a github url with #branch, or a local copy) and on which OpenMower image
planner_context() { compose $T_REGISTRY "$PLANNER" config 2>/dev/null | sed -n 's/^ *context: *//p' | head -n1; }
planner_base() { compose $T_REGISTRY "$PLANNER" config 2>/dev/null | sed -n 's/^ *OPENMOWER_IMAGE: *//p' | tr -d '"' | head -n1; }
# owner/repo and the branch of a github context, empty for anything else
planner_source() {
  printf '%s' "$(planner_context)" | sed -n 's|^https://github\.com/\([A-Za-z0-9_.-]*/[A-Za-z0-9_.-]*\)\.git\(#\([A-Za-z0-9_./-]*\)\)\{0,1\}$|\1 \3|p'
}
planner_commit() {
  src=$(planner_source)
  [ -n "$src" ] || return
  # shellcheck disable=SC2086
  set -- $src
  v=$(wget -q -T 15 -O - "https://api.github.com/repos/$1/commits/${2:-main}" | sed -n 's/^  "sha": *"\([0-9a-f]*\)".*/\1/p' | head -n1)
  valid "$v" '[0-9a-f]{40}' && echo "$v"
}
# the commit it was last built from here, while it still runs that image
planner_built() { [ "$(get planner_image)" = "$(image_of "$PLANNER")" ] && get planner_built; }
# the OpenMower image it was built on is still the one its base tag names
planner_base_same() {
  base=$(planner_base)
  [ -z "$base" ] || [ "$(get planner_base_id)" = "$(id_of "$base")" ]
}

# build it again from its own context and start it. never --pull, and only when the OpenMower image it's built on
# is here: it has to be built on the OpenMower that runs, and a missing one would come down whole
build_planner() {
  progress planner prepare
  in_compose "$PLANNER" || { status planner error not_compose; return 1; }
  base=$(planner_base)
  if [ -n "$base" ] && ! docker image inspect "$base" > /dev/null 2>&1; then
    log "planner: its base $base isn't on the mower, not built (it would download all of OpenMower)"
    status planner error base_missing
    return 1
  fi
  room_for $ROOM_PLANNER || { log "planner: less than $ROOM_PLANNER MB free, not built"; status planner nospace $ROOM_PLANNER "$(free_mb)"; return 1; }
  commit=$(planner_commit)
  img=$(ref_of "$PLANNER")
  before=$(image_of "$PLANNER")
  back=$(keep_back "${img%:*}" "$before")
  [ -n "$back" ] || { log "planner: the version before can't be kept, not built"; status planner error keep; return 1; }
  log "planner: building ($1)"
  : > "$STATE/layers"
  with_progress planner compose $T_BUILD "$PLANNER" --progress json build "$(service "$PLANNER")"
  rc=$?
  [ $rc -eq 0 ] || [ $rc -eq 2 ] || log "planner: the build failed, the one before keeps running"
  if [ $rc -eq 0 ] && ! docked; then
    log "planner: the mower left the dock, the one before keeps running"
    rc=2
  fi
  if [ $rc -ne 0 ]; then
    undo_back "$back" "$img"
    [ $rc -eq 2 ] && return 2
    status planner error build
    return 1
  fi
  built=$(id_of "$img")
  if [ "$built" = "$before" ]; then
    # the same image again: nothing to restart
    log "planner: the same image as before, it keeps running"
    docker rmi "$back" > /dev/null 2>&1
  else
    status pending_planner "$back" "$img"
    restart planner "$built" || { go_back planner "$back" "$img" "$commit"; return 1; }
    status pending_planner
    log "planner: running again"
  fi
  status planner_image "$(image_of "$PLANNER")"
  status planner_built "$commit"
  [ -n "$base" ] && status planner_base_id "$(id_of "$base")"
  status planner updated "$(now)" "$(echo "$commit" | cut -c1-7)"
  return 0
}

check_planner() {
  exists "$PLANNER" || { status planner_source none; return; }
  img=$(image_of "$PLANNER")
  built=$(planner_built)
  status planner_running "${built:-?}" "$(day_of "$img")"
  if [ -z "$(planner_source)" ]; then
    status planner_source local
    status planner_available no local
    return
  fi
  status planner_source github
  want=$(planner_commit)
  if [ -z "$want" ] || [ -z "$built" ]; then
    status planner_available unknown main
  elif [ "$want" = "$built" ] && planner_base_same; then
    status planner_available no main
  elif [ "$want" = "$(get planner_failed)" ]; then
    status planner_available failed main
  else
    status planner_available yes main
  fi
}

update_planner() {
  exists "$PLANNER" || return 0
  progress planner prepare
  [ -n "$(planner_source)" ] || { status planner local; return 0; }
  want=$(planner_commit)
  [ -n "$want" ] || { status planner error github; return 1; }
  if [ "$want" = "$(planner_built)" ] && planner_base_same; then
    status planner current
    return 0
  fi
  if [ "$want" = "$(get planner_failed)" ] && planner_base_same; then
    log "planner: not again, $(echo "$want" | cut -c1-7) didn't start before"
    status planner skipped_failed
    return 0
  fi
  build_planner "$(echo "$want" | cut -c1-7)"
}

# --- stopped halfway ---

# a run that didn't end (the power gone, the container stopped): a file it changed for a part it hadn't restarted yet
# goes back, if nobody changed it since; a tag moved to an image that never started goes back on the one that runs; a
# part it had restarted is looked at again (settle). nothing starts later on something nobody saw come up
recover() {
  [ "$(get result)" = running ] || return 0
  log "the last run was stopped halfway, putting back what didn't run yet"
  for p in mowbite openmower planner; do
    # shellcheck disable=SC2046
    set -- $(get "changed_$p")
    [ -n "$1" ] || continue
    if [ -n "$(get "pending_$p")" ]; then
      :
    elif [ "$(md5sum < "$1" 2>/dev/null | cut -d' ' -f1)" = "$2" ]; then
      undo_change "$p"
    else
      log "$p: $1 was changed since, left as it is"
      keep_change "$p"
    fi
  done
  for p in mowbite openmower planner; do
    c=$(box "$p")
    exists "$c" || continue
    [ -n "$(get "pending_$p")" ] && continue
    ref=$(ref_of "$c")
    img=$(image_of "$c")
    tagged=$(id_of "$ref")
    if [ -n "$tagged" ] && [ "$tagged" != "$img" ] && docker image inspect "$img" > /dev/null 2>&1; then
      docker tag "$img" "$ref" && log "$ref back on the image that runs"
    fi
  done
  status run_parts
  settle
  status result interrupted
}

# --- room ---

# what's on the disk that nothing needs: images no container uses (not even a stopped one) and no compose file names
# with its tag or builds on, with the room each frees for real (its own layers), and the build cache. only listed here,
# deleted only when the app asks (room_free), never on its own
stacks_root() { dirname "$(label "$APP" project.working_dir)"; }
# the images the stacks' compose files name or build on, their .env filled in (${VERSION:-edge} and the like)
compose_refs() {
  for f in "$(stacks_root)"/*/compose.yaml "$(stacks_root)"/*/compose.yml "$(stacks_root)"/*/docker-compose.yaml "$(stacks_root)"/*/docker-compose.yml; do
    [ -f "$f" ] || continue
    {
      tr -d '\r' < "$(dirname "$f")/.env" 2>/dev/null
      echo '@@images'
      # the images, and the ones a build starts from (OPENMOWER_IMAGE: ... for the planner)
      sed -n 's/^[[:space:]]*image:[[:space:]]*//p; s/^[[:space:]]*[A-Za-z_]*IMAGE[A-Za-z_]*:[[:space:]]*//p' "$f"
    } | awk '
      $0 == "@@images" { images = 1; next }
      !images {
        line = $0
        sub(/^[[:space:]]*export[[:space:]]+/, "", line)
        if (match(line, /^[A-Za-z_][A-Za-z0-9_]*=/)) {
          k = substr(line, 1, RLENGTH - 1); v = substr(line, RLENGTH + 1)
          sub(/[[:space:]]+#.*$/, "", v); gsub(/^["\047]|["\047][[:space:]]*$/, "", v); env[k] = v
        }
        next
      }
      {
        ref = $0; sub(/[[:space:]]+#.*$/, "", ref); gsub(/["\047[:space:]]/, "", ref)
        while (match(ref, /\$\{[^}]*\}/)) {
          s = RSTART; l = RLENGTH; inner = substr(ref, s + 2, l - 3); name = inner; def = ""
          p = index(inner, ":-")
          if (p) { name = substr(inner, 1, p - 1); def = substr(inner, p + 2) }
          else if ((p = index(inner, "-"))) { name = substr(inner, 1, p - 1); def = substr(inner, p + 1) }
          ref = substr(ref, 1, s - 1) ((name in env && env[name] != "") ? env[name] : def) substr(ref, s + l)
        }
        sub(/^docker\.io\/library\//, "", ref); sub(/^docker\.io\//, "", ref)
        n = split(ref, part, "/"); if (!index(part[n], ":")) ref = ref ":latest"
        print ref
      }'
  done
}
# bytes from docker's sizes: 512B, 4.1kB, 12.3MB, 1.2GB
bytes_awk='function bytes(s, n, u) { n = s + 0; u = s; sub(/^[0-9.]+/, "", u); if (u == "kB") n *= 1e3; else if (u == "MB") n *= 1e6; else if (u == "GB") n *= 1e9; else if (u == "TB") n *= 1e12; return int(n) }'
# one line per image: img <id> <bytes> <its tags, comma separated, or -> <kind>, then: cache <bytes>
check_room() {
  used=" $(docker ps -aq | xargs -r docker inspect -f '{{.Image}}' 2>/dev/null | tr '\n' ' ') "
  named=" $(compose_refs | tr '\n' ' ') "
  out=$(mktemp)
  timeout $T_UP docker system df -v --format '{{json .Images}}' 2>/dev/null | sed 's/^\[//; s/\]$//; s/},{/}\n{/g' | awk -v used="$used" -v named="$named" "$bytes_awk"'
    function field(k) { return match($0, "\"" k "\":\"[^\"]*\"") ? substr($0, RSTART + length(k) + 4, RLENGTH - length(k) - 5) : "" }
    {
      id = field("ID"); repo = field("Repository"); tag = field("Tag"); ref = repo ":" tag
      if (id == "") next
      if (field("Containers") != "0" || index(used, " " id " ") || (repo != "<none>" && index(named, " " ref " "))) { keep[id] = 1; next }
      size[id] = bytes(field("UniqueSize"))
      if (repo != "<none>") refs[id] = refs[id] (refs[id] == "" ? "" : ",") ref
      k = repo == "<none>" ? "dangling" : tag ~ /^rb-|^previous$/ ? "rollback" : tag ~ /^before-/ ? "planner" : tag ~ /^prev-/ ? "old" : "unused"
      if (kind[id] == "" || kind[id] == "unused") kind[id] = k
    }
    END { for (id in size) if (!keep[id]) print "img", substr(id, 8, 12), size[id], (refs[id] == "" ? "-" : refs[id]), kind[id] }' > "$out"
  echo "cache $(timeout $T_UP docker system df --format '{{.Type}}|{{.Size}}' 2>/dev/null | sed -n 's/^Build Cache|//p' | awk "$bytes_awk"'{ print bytes($0) }')" >> "$out"
  mv "$out" "$STATE/room"
}

# what the app asked to delete: one image from the list (all its tags, never forced), all of them, or the build cache.
# the list is made again first: only what still nothing needs goes
room_free() {
  before=$(free_mb)
  check_room
  case $1 in
  cache)
    timeout $T_UP docker builder prune -af > /dev/null 2>&1
    log "room: build cache cleared"
    ;;
  img | all)
    grep '^img ' "$STATE/room" 2>/dev/null | while read -r _ id _ refs _; do
      [ "$1" = all ] || [ "$id" = "$2" ] || continue
      if [ "$refs" = - ]; then
        docker rmi "$id" > /dev/null 2>&1 && log "room: removed image $id"
      else
        for r in $(echo "$refs" | tr ',' ' '); do docker rmi "$r" > /dev/null 2>&1 && log "room: removed $r"; done
      fi
    done
    ;;
  esac
  check_room
  status disk_free "$(free_mb)"
  log "room: $(($(free_mb) - before)) MB more free, $(free_mb) MB free"
}

# --- leftovers ---

# its own older rollback tags: of each part the newest few on other images than the one that runs (the app's: two, the
# big ones: none), newest first by the time in the tag. not while a part waits to be seen running, and never one on an
# image built here that can't be had again (the planner's can: it's built from its source). tags it didn't make stay.
# then what nothing uses and the build cache nothing points to
tidy() {
  for c in "mowbite:$KEEP" "openmower:$KEEP_BIG" "planner:$KEEP_BIG"; do
    p=${c%:*}
    keep=${c##*:}
    name=$(box "$p")
    exists "$name" || continue
    [ -n "$(get "pending_$p")" ] && continue
    repo=$(ref_of "$name")
    repo=${repo%:*}
    run=$(image_of "$name")
    docker images --no-trunc --format '{{.Tag}} {{.ID}}' "$repo" | grep '^rb-[0-9]*-' | sort -t- -k2,2nr | {
      kept=" "
      n=0
      while read -r t id; do
        case $kept in *" $id "*) seen_before=1 ;; *) seen_before= ;; esac
        if [ "$id" != "$run" ] && [ -z "$seen_before" ] && [ $n -lt "$keep" ]; then
          kept="$kept$id "
          n=$((n + 1))
        elif [ "$p" != planner ] && [ "$id" != "$run" ] && [ -z "$seen_before" ] && built_here "$id"; then
          kept="$kept$id "
        else
          docker rmi "$repo:$t" > /dev/null 2>&1 && log "removed $repo:$t"
        fi
      done
    }
  done
  # (a test on a pc with images and builds of its own: PRUNE=0)
  if [ "${PRUNE:-1}" != 0 ]; then
    freed=$(timeout $T_UP docker image prune -f 2>/dev/null | sed -n 's/^Total reclaimed space: //p')
    cache=$(timeout $T_UP docker builder prune -f 2>/dev/null | sed -n 's/^Total: *//p')
  fi
  log "tidied up: images ${freed:-0B}, build cache ${cache:-0B}, $(free_mb) MB free"
}

# itself: a helper container on the image that runs now (updater-self.sh) recreates it on the new one, from inside
# compose would stop this container before the new one starts. the helper sees it come up, else puts this one back
update_self() {
  in_compose "$ME" || return
  me=$(ref_of "$ME")
  # the image it runs now, kept first under a tag of its own: the helper runs on it, and it's the way back
  prev=${me%:*}:previous
  docker tag "$(image_of "$ME")" "$prev" 2>/dev/null || { log "the updater's own image can't be kept, it doesn't update itself"; return; }
  timeout $T_PULL docker pull -q "$me" > /dev/null 2>&1 || return
  new=$(id_of "$me")
  [ "$new" = "$(id_of "$prev")" ] && return
  if [ "$new" = "$(get updater_failed)" ]; then
    docker tag "$prev" "$me"
    return
  fi
  # (all stacks: dockge may give each one a global.env next to them)
  root=$(dirname "$(label "$ME" project.working_dir)")
  log "updating the updater"
  docker run -d --rm --name mowbite-updater-self -v /var/run/docker.sock:/var/run/docker.sock -v "$root:$root" -v /etc/localtime:/etc/localtime:ro \
    -e "STATE_DIR=$STATE" -e "UPDATER_CONTAINER=$ME" --entrypoint sh "$prev" /updater-self.sh "$me" "$prev" > /dev/null 2>&1 ||
    { log "the updater's helper didn't start, it stays as it is"; docker tag "$prev" "$me"; }
}

check_all() {
  check_app
  check_openmower
  check_planner
  check_room
  status disk_free "$(free_mb)"
  status checked "$(now)"
}

# the parts asked for, OpenMower first (the planner is built on it), then the planner, then the app. only with the
# mower idle in the dock, before each part again. 2 when it has to wait for that
run() {
  why=$1
  shift
  if ! docked; then
    log "waiting ($why): the mower isn't idle in the dock"
    status result waiting
    return 2
  fi
  parts=""
  for p in openmower planner mowbite; do
    case " $* " in *" $p "* | *" all "*) ;; *) continue ;; esac
    exists "$(box "$p")" && parts="$parts $p"
  done
  # shellcheck disable=SC2086
  status run_parts $parts
  status result running
  # (one restarted before and not seen running yet comes first)
  settle
  MANUAL=
  [ "$why" = request ] && MANUAL=1
  waited=
  for p in $parts; do
    docked || { waited=1; break; }
    case $p in openmower) update_openmower ;; planner) update_planner ;; mowbite) update_app ;; esac
    [ $? -eq 2 ] && { waited=1; break; }
  done
  status progress
  tidy
  check_all
  status run_parts
  if [ -n "$waited" ]; then
    log "waiting ($why): the mower left the dock, the rest another time"
    status result waiting
    return 2
  fi
  status result "done"
}

# the parts set to update by themselves
auto_parts() {
  for p in mowbite openmower planner; do auto "$p" && printf '%s ' "$p"; done
}
# the days it may run: daily or the weekdays 1-7 (monday 1), the day its window started ($1, unix time)
day_ok() {
  days=$(conf days daily)
  [ "$days" = daily ] && return 0
  case ",$days," in *",$(date -d "@$1" +%u),"*) return 0 ;; esac
  return 1
}
# minutes since midnight of now, and of the time set (without a leading 0, sh would read 08 as octal)
num() { echo "$1" | sed 's/^0//'; }
minute() { echo $(($(num "$(date +%H)") * 60 + $(num "$(date +%M)"))); }
at_minute() {
  at=$(conf at 03:00)
  valid "$at" '([01][0-9]|2[0-3]):[0-5][0-9]' || at=03:00
  echo $(($(num "${at%:*}") * 60 + $(num "${at#*:}")))
}
# the http interface for the app, on the stack's network only
serve() { pidof httpd > /dev/null || httpd -p "${UPDATER_PORT:-8081}" -h /www; }

# (sourced by a test for its functions)
[ -n "$UPDATER_NO_LOOP" ] && return 0
trap 'exit 0' TERM INT
mkdir -p "$STATE"
chmod 700 "$STATE"
serve
log "started"
status started "$(now)" "$(image_of "$ME")"
alive
recover
check_all
done_day=""
next=0
while :; do
  serve
  alive
  if [ -s "$REQ" ]; then
    # taken away first: what comes in meanwhile waits for the next round
    mv "$REQ" "$REQ.$$"
    parts=""
    check=""
    while read -r w a b; do
      case $w in
      check) check=1 ;;
      all | mowbite | openmower | planner) parts="$parts $w" ;;
      back)
        if [ "$a" != mowbite ]; then
          :
        elif docked; then
          status run_parts mowbite
          status result running
          back_app
          status progress
          status run_parts
          check_all
          status result "done"
        else
          log "mowbite: not back to the version before, the mower isn't idle in the dock"
          status mowbite error not_docked
        fi
        ;;
      room) check_room ;;
      free) room_free "$a" "$b" ;;
      esac
    done < "$REQ.$$"
    rm -f "$REQ.$$"
    if [ -n "$parts" ]; then
      # shellcheck disable=SC2086
      run request $parts
    elif [ -n "$check" ]; then
      check_all
    fi
  fi
  # the night's run: once in its window (also past midnight, it counts as the night it started), again every 10 minutes
  # while the mower isn't in the dock
  parts=$(auto_parts)
  since=$((($(minute) - $(at_minute) + 1440) % 1440))
  start=$(($(now) - since * 60))
  if [ -n "$parts" ] && [ $since -lt $WINDOW ] && [ "$done_day" != "$(date -d "@$start" +%F)" ] && day_ok "$start" && [ "$(now)" -ge "$next" ]; then
    # shellcheck disable=SC2086
    run night $parts
    if [ $? -eq 2 ]; then
      next=$(($(now) + 600))
    else
      done_day=$(date -d "@$start" +%F)
      update_self
    fi
  elif [ $(($(now) - $(get checked | grep -x '[0-9]*' || echo 0))) -ge $CHECK_EVERY ]; then
    check_all
  fi
  sleep 60 &
  wait $!
done
