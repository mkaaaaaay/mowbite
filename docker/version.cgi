#!/bin/sh
# version.json for the android app: it runs on another origin and only reads answers that allow it
. /origin.sh
cors
printf 'Content-Type: application/json\r\nCache-Control: no-store\r\n\r\n'
cat /www/version.json
