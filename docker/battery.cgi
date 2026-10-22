#!/bin/sh
# the charge and discharge cycles battery.sh kept, for the sensors page. ?health: the lines the battery's capacity is
# read from (battery.awk). ?level: "<now> <time> <percent> <charging|full|dock|out>", how full it is (only the time now
# while battery.awk doesn't know). an older container answers with the cycles
printf 'Access-Control-Allow-Origin: *\r\n'
printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'
if [ "$QUERY_STRING" = health ]; then
  cat /data/battery-health.log 2>/dev/null
elif [ "$QUERY_STRING" = level ]; then
  echo "$(date +%s) $(cat /dev/shm/battery.level 2>/dev/null)"
else
  cat /data/battery.log 2>/dev/null
fi
