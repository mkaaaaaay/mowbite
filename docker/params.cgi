#!/bin/sh
# the settings of the mower changed in the app with params.set (read by params.sh, which sets them again after the
# mower restarts): "enabled 0|1" and "<full name> <value>" a line. only lines of these shapes are kept
# the app on another mower may ask too (several mowers in one app)
. /origin.sh
F=/data/params.txt
if [ "$REQUEST_METHOD" = "POST" ]; then
  save_lines "$F" 10000 '^(enabled [01]|/mower_logic/[a-z0-9_]{1,60} (-?[0-9]{1,6}(\.[0-9]{1,6})?|true|false))$'
fi
cors
printf 'Content-Type: text/plain\r\nCache-Control: no-store\r\n\r\n'
cat "$F" 2>/dev/null
