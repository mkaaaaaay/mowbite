#!/bin/sh
# the mowing schedule (read by scheduler.sh), its log and when the run going on goes home. only lines of the known
# shapes are kept, a known one that doesn't fit turns the save down (400), as does a time without the zone (tz, in
# POSIX form: the container has no zone files)
# the app on another mower may ask too (several mowers in one app)
. /origin.sh
F=/data/schedule.txt
if [ "$REQUEST_METHOD" = "POST" ]; then
  read_body 20000
  grep -qE '^(plan|pause|handstop) ' "$T" && ! grep -qE '^tz ' "$T" && { rm -f "$T"; fail 400 'no tz'; }
  keep_lines "$F" '^(enabled [01]|skiprain [01]|skipforecast [01]|forecasthours [1-3]|skipcold [01]|mintemp [0-9]{1,2}|minbattery [0-9]{1,3}|tz (<[A-Za-z0-9+-]{1,10}>|[A-Za-z]{3,10})[+-]?[0-9]{1,2}(:[0-5][0-9]){0,2}((<[A-Za-z0-9+-]{1,10}>|[A-Za-z]{3,10})([+-]?[0-9]{1,2}(:[0-5][0-9]){0,2})?(,(M[0-9]{1,2}\.[1-5]\.[0-6]|J?[0-9]{1,3})(/-?[0-9]{1,3}(:[0-5][0-9]){0,2})?){2})?|pos -?[0-9]{1,3}\.[0-9]{1,2} -?[0-9]{1,3}\.[0-9]{1,2}|plan [1-7](,[1-7]){0,6} ([01][0-9]|2[0-3]):[0-5][0-9]( [A-Za-z0-9_-]{1,40}(,[A-Za-z0-9_-]{1,40}){0,49})?( end=([01][0-9]|2[0-3]):[0-5][0-9])?( dark=1)?( sunset=1)?( fresh=1)?( angle=-?[0-9]{1,3})?|pause [0-9]{4}-[0-9]{2}-[0-9]{2} (all|[A-Za-z0-9_-]{1,40}(,[A-Za-z0-9_-]{1,40}){0,49})|handstop ([01][0-9]|2[0-3]):[0-5][0-9])$' \
    'enabled|skiprain|skipforecast|forecasthours|skipcold|mintemp|minbattery|tz|pos|plan|pause|handstop'
fi
cors
printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'
if [ "$QUERY_STRING" = "log" ]; then
  cat /data/schedule.log 2>/dev/null
elif [ "$QUERY_STRING" = "run" ]; then
  # when the run going on goes home, while that's still to come: "<unix time> end|dark|hand"
  read -r at stop why _ 2>/dev/null < /data/run.state && [ -f "/data/run.due.$at" ] && echo "$stop $why"
else
  cat "$F" 2>/dev/null
fi
