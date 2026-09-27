#!/bin/sh
# Runs on the mower itself (not in the container), every minute from cron. Copies what ROS logged as
# a warning, error or fatal error from the system journal into files MowBite can show next to the
# problems on its activity page. The journal is gone after a reboot, these files stay 14 days.
#
# Only those log lines are kept. ROS also prints all its parameters when it starts, logins and
# passwords included, those lines never get through. On top, anything that looks like a password,
# token or login is blanked before it's written.
set -u
dir=${MOWBITE_ROSLOG_DIR:-$HOME/ros/mowbite-roslog}
mkdir -p "$dir" || exit 1

journalctl CONTAINER_NAME="${MOWBITE_ROS_CONTAINER:-open_mower_ros}" --cursor-file="$dir/cursor" -o cat -q --no-pager 2>/dev/null |
  sed 's/\x1b\[[0-9;]*m//g' |
  grep -E '^\[(WARN|ERROR|FATAL)\] \[[0-9.]+\]: ' |
  sed -E 's#([a-zA-Z][a-zA-Z0-9+.-]*://)[^/@ ]+@#\1***@#g; s#((pass(word)?|passwd|pwd|user(name)?|login|token|secret|api[_-]?key|auth[a-z]*|credentials?)[^:=]{0,20}[:=][[:space:]]*)[^[:space:],;]+#\1***#gI' \
  >> "$dir/$(date +%F).log"

# empty days aren't worth a file
find "$dir" -name '*.log' -size 0 -delete
find "$dir" -name '*.log' -mtime +14 -delete
# tells mowbite the helper is alive, even when nothing was logged
touch "$dir/alive"
