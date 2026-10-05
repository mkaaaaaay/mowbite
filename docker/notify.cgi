#!/bin/sh
# the push messages (notify.sh): their settings, a test message, snoozing the reminders and what was sent.
# the token is never handed out, a save without a token line keeps the one there is ("token -" drops it).
# the app on another mower may ask too (several mowers in one app)
# after a Status line, busybox httpd only reads that when it comes first
cors() { printf 'Access-Control-Allow-Origin: *\r\n'; }
text() { printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'; }
C=/data/notify.conf
S=/data/notify.snooze
conf() { sed -n "s/^$1 //p" "$C" 2>/dev/null | head -n1; }

case "$REQUEST_METHOD $QUERY_STRING" in
"POST test")
  topic=$(conf topic)
  name=$(conf name)
  url=$(conf url)
  cors
  text
  [ -n "$topic" ] || { echo "no topic"; exit 0; }
  if [ "$(conf lang)" = de ]; then
    title="Test von MowBite"
    msg="${name:-Der Mäher} meldet sich hier, wenn er Hilfe braucht."
  else
    title="Test from MowBite"
    msg="${name:-The mower} will tell you here when it needs help."
  fi
  # topic, name and url can't hold quotes or backslashes (see the save below)
  json=$(printf '{"topic":"%s","title":"%s","message":"%s","priority":3,"tags":["seedling"]%s}' \
    "$topic" "$title" "$msg" "${url:+,\"click\":\"$url/\"}")
  /notify.sh test "$json" && echo sent || echo failed
  exit 0
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
  body=$(head -c "$len" | tr -d '\r' | grep -E '^(server https?://[A-Za-z0-9.:/_-]{1,200}|topic [A-Za-z0-9_-]{1,64}|token [A-Za-z0-9_-]{1,200}|lang (de|en)|name [^"\\]{1,40}|url https?://[A-Za-z0-9.:/_-]{1,200}|events [a-z_]{1,20}(,[a-z_]{1,20}){0,15}|remind [0-9]{1,3}|emergency_wait [0-9]{1,3}|enabled [01])$')
  new=$(printf '%s\n' "$body" | sed -n 's/^token //p' | head -n1)
  {
    printf '%s\n' "$body" | grep -v '^token '
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
