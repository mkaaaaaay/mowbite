#!/bin/sh
# OpenMower keeps the last ros warnings and errors in memory only (logs.recent), a restart wipes them.
# every minute the new ones are fetched and kept in /data/roslog, one file per day (utc), 14 days, so the
# activity page has them for older problems too. lines: "<unix time> <LEVEL> <node>: <message>"
# the same for the MowBite Planner's own lines (planner.log, also only since its start) in /data/plannerlog, 14 days and
# 5 MB: "<unix time> <LEVEL> <message as in json, \n for a line break>"
. /broker.sh
. /openmower.sh
D=/data/roslog
P=/data/plannerlog
mkdir -p "$D" "$P"

while :; do
  host=$(find_broker)
  if [ -n "$host" ]; then
    last=$(cat "$D/.last" 2>/dev/null)
    new=$(mower_rpc "$host" "$RPC_LOGS" "{\"since\":${last:-0},\"limit\":1000}" | DIR=$D ROS=1 awk -f /logkeeper.awk)
    [ -n "$new" ] && echo "$new" > "$D/.last"
    # the planner's lines since the last one kept
    plast=$(cat "$P/.last" 2>/dev/null)
    pnew=$(mower_rpc "$host" "$RPC_PLANNER_LOG" "{\"since\":${plast:-0}}" 15 | DIR=$P awk -f /logkeeper.awk)
    [ -n "$pnew" ] && echo "$pnew" > "$P/.last"
    ls -1 "$P"/*.log 2>/dev/null | sort -r | tail -n +15 | while read -r f; do rm -f "$f"; done
    while [ "$(du -sk "$P" | cut -f1)" -gt 5120 ] && [ "$(ls -1 "$P"/*.log 2>/dev/null | wc -l)" -gt 1 ]; do
      rm -f "$(ls -1 "$P"/*.log | sort | head -n1)"
    done
    f=$(ls -1 "$P"/*.log 2>/dev/null | tail -n1)
    if [ -n "$f" ] && [ "$(du -sk "$f" | cut -f1)" -gt 5120 ]; then
      tail -c 2500000 "$f" | sed 1d > "$f.tmp" && mv "$f.tmp" "$f"
    fi
    # 14 days and at most 10 MB, a node that keeps warning mustn't fill the mower. the oldest days go first
    ls -1 "$D"/*.log 2>/dev/null | sort -r | tail -n +15 | while read -r f; do rm -f "$f"; done
    while [ "$(du -sk "$D" | cut -f1)" -gt 10240 ] && [ "$(ls -1 "$D"/*.log 2>/dev/null | wc -l)" -gt 1 ]; do
      rm -f "$(ls -1 "$D"/*.log | sort | head -n1)"
    done
    # today's alone that big: only its newest half stays
    f=$(ls -1 "$D"/*.log 2>/dev/null | tail -n1)
    if [ -n "$f" ] && [ "$(du -sk "$f" | cut -f1)" -gt 10240 ]; then
      tail -c 5000000 "$f" | sed 1d > "$f.tmp" && mv "$f.tmp" "$f"
    fi
  fi
  sleep 60
done
