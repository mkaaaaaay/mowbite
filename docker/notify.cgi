#!/bin/sh
# the push messages (notify.sh): their settings, a test message, snoozing the reminders and what was sent.
# the token is never handed out, a save without a token line keeps the one there is ("token -" drops it).
# phones with MowBite's app sign up with their UnifiedPush address (push-add, push-remove, push-test with the address
# as the body), a save of the settings keeps them
# the app on another mower may ask too (several mowers in one app)
# after a Status line, busybox httpd only reads that when it comes first
. /origin.sh
text() { printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'; }
C=/data/notify.conf
S=/data/notify.snooze
conf() { sed -n "s/^$1 //p" "$C" 2>/dev/null | head -n1; }
# the body, one line
body() {
  len=${CONTENT_LENGTH:-0}
  [ "$len" -gt 0 ] && [ "$len" -le 600 ] && head -c "$len" | tr -d '\r\n'
}
# a phone's address as the distributor gave it, e.g. https://ntfy.sh/upAbC1?up=1
address() { printf '%s' "$1" | grep -E '^https?://[A-Za-z0-9._~:/?=&%+-]{1,250}$'; }
done_() {
  cors
  text
  echo "$1"
  exit 0
}
# the test in the messages' language: title and text
test_text() {
  if [ "$(conf lang)" = de ]; then
    title="Test von MowBite"
    msg="${name:-Der Mäher} meldet sich hier, wenn er Hilfe braucht."
  else
    title="Test from MowBite"
    msg="${name:-The mower} will tell you here when it needs help."
  fi
}
# what MowBite's app gets: see notify.awk push()
push_json() {
  printf '{"title":"%s","message":"%s","kind":"test","phase":"new","problem":false,"prio":3,"t":%s,"lang":"%s","path":"/settings/"%s}' \
    "$title" "$msg" "$(date +%s)" "$(conf lang)" "${url:+,\"api\":\"$url\"}"
}

case "$REQUEST_METHOD $QUERY_STRING" in
"POST test")
  topic=$(conf topic)
  name=$(conf name)
  url=$(conf url)
  cors
  text
  [ -n "$topic" ] || grep -q '^push ' "$C" 2>/dev/null || { echo "no topic"; exit 0; }
  test_text
  ok=1
  # topic, name and url can't hold quotes or backslashes (see the save below)
  if [ -n "$topic" ]; then
    json=$(printf '{"topic":"%s","title":"%s","message":"%s","priority":3,"tags":["seedling"]%s}' \
      "$topic" "$title" "$msg" "${url:+,\"click\":\"$url/\"}")
    /notify.sh test "ntfy $json" && ok=0
  fi
  if grep -q '^push ' "$C" 2>/dev/null; then
    /notify.sh test "push $(push_json)" && ok=0
  fi
  [ $ok = 0 ] && echo sent || echo failed
  exit 0
  ;;
"POST push-add")
  a=$(address "$(body)")
  [ -n "$a" ] || done_ "bad address"
  grep -qxF "push $a" "$C" 2>/dev/null && done_ ok
  # a few phones per mower, the oldest goes
  [ "$(grep -c '^push ' "$C" 2>/dev/null)" -ge 10 ] && { awk 'f || !/^push / { print; next } { f = 1 }' "$C" > "$C.tmp" && mv "$C.tmp" "$C"; }
  echo "push $a" >> "$C"
  done_ ok
  ;;
"POST push-remove")
  a=$(address "$(body)")
  [ -n "$a" ] && grep -vxF "push $a" "$C" > "$C.tmp" && mv "$C.tmp" "$C"
  done_ ok
  ;;
"POST push-test")
  a=$(address "$(body)")
  # only to a phone signed up here: no way to send anything elsewhere
  { [ -n "$a" ] && grep -qxF "push $a" "$C" 2>/dev/null; } || done_ "not signed up"
  name=$(conf name)
  url=$(conf url)
  test_text
  /notify.sh test-push "$a" "$(push_json)" >/dev/null && done_ sent || done_ failed
  ;;
"POST snooze="*)
  n=${QUERY_STRING#snooze=}
  case "$n" in '' | *[!0-9]*) n=0 ;; esac
  [ "$n" -gt 86400 ] && n=86400
  if [ "$n" -gt 0 ]; then echo $(($(date +%s) + n)) > "$S"; else rm -f "$S"; fi
  cors
  text
  echo ok
  exit 0
  ;;
POST*)
  len=${CONTENT_LENGTH:-0}
  if [ "$len" -le 0 ] || [ "$len" -gt 4000 ]; then
    printf 'Status: 413 Too Large\r\n'
    cors
    printf 'Content-Type: text/plain\r\n\r\ntoo large\n'
    exit 0
  fi
  old=$(conf token)
  body=$(head -c "$len" | tr -d '\r' | grep -E '^(server https?://[A-Za-z0-9.:/_-]{1,200}|topic [A-Za-z0-9_-]{1,64}|token [A-Za-z0-9_-]{1,200}|lang (de|en)|name [^"\\]{1,160}|url https?://[A-Za-z0-9.:/_-]{1,200}|events (-|[a-z_]{1,20}(,[a-z_]{1,20}){0,15})|remind [0-9]{1,3}|emergency_wait [0-9]{1,3}|enabled [01])$')
  new=$(printf '%s\n' "$body" | sed -n 's/^token //p' | head -n1)
  {
    printf '%s\n' "$body" | grep -v '^token '
    # the phones signed up stay, the page doesn't send them
    grep '^push ' "$C" 2>/dev/null
    if [ -n "$new" ] && [ "$new" != - ]; then
      echo "token $new"
    elif [ -z "$new" ] && [ -n "$old" ]; then
      echo "token $old"
    fi
  } > "$C.tmp" && mv "$C.tmp" "$C"
  ;;
esac

cors
text
if [ "$QUERY_STRING" = log ]; then
  cat /data/notify.log 2>/dev/null
  exit 0
fi
grep -v '^token ' "$C" 2>/dev/null
[ -n "$(conf token)" ] && echo "token set"
until=$(cat "$S" 2>/dev/null)
[ -n "$until" ] && [ "$until" -gt "$(date +%s)" ] && echo "snooze $until"
exit 0
