#!/bin/sh
# the format of what MowBite keeps in /data, as a number in /data/schema: the updater puts /data back as it was before
# an update when the new version raised it and doesn't run. raise it with every change of a file's format in /data that
# an older version can't read. written when there's none or a lower one, never lowered (an older version on newer data)
SCHEMA=1
D=${DATA:-/data}
v=$(head -c 20 "$D/schema" 2> /dev/null | tr -d ' \n')
case $v in '' | *[!0-9]*) v=0 ;; esac
[ "$v" -lt "$SCHEMA" ] || exit 0
echo "$SCHEMA" > "$D/schema.new" && mv "$D/schema.new" "$D/schema"
