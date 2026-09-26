#!/bin/sh
# last 24 h of sensor values written by recorder.sh
printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'
cat /data/sensors.tsv 2>/dev/null
