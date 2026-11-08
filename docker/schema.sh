#!/bin/sh
# the format of /data for the updater: it puts /data back on its way back when the new version raised the number.
# raise it with every change of a file's format in /data that an older version can't read. never lowered
SCHEMA=1
D=${DATA:-/data}
v=$(head -c 20 "$D/schema" 2> /dev/null | tr -d ' \n')
case $v in '' | *[!0-9]*) v=0 ;; esac
[ "$v" -lt "$SCHEMA" ] || exit 0
echo "$SCHEMA" > "$D/schema.tmp" && mv "$D/schema.tmp" "$D/schema"
