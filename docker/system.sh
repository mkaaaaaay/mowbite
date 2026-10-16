#!/bin/sh
# memory, storage, load, temperature and uptime of the machine this container runs on, as "key value"
# lines. that's the mower when MowBite runs on it, "remote 1" says it runs elsewhere (a NAS or pc).
# for system.cgi and the 24 h history in recorder.sh
case "${MOWER_MQTT_HOST:-localhost}" in
  localhost | 127.0.0.1 | host.docker.internal) echo "remote 0" ;;
  *) echo "remote 1" ;;
esac
awk '/^MemTotal:/ { print "mem_total", $2 * 1024 } /^MemAvailable:/ { print "mem_available", $2 * 1024 }' /proc/meminfo
# the system disk (where docker keeps the images) and the data volume, in bytes
df -k / | awk 'NR == 2 { print "disk_total", $2 * 1024; print "disk_free", $4 * 1024 }'
df -k /data | awk 'NR == 2 { print "data_total", $2 * 1024; print "data_free", $4 * 1024 }'
awk '{ print "load", $1, $2, $3 }' /proc/loadavg
awk '{ print "uptime", int($1) }' /proc/uptime
grep -c ^processor /proc/cpuinfo | awk '{ print "cpus", $1 }'
# the cpu's zone (cpu-thermal on a raspberry), else the first one, in millidegrees
t=""
for z in /sys/class/thermal/thermal_zone*; do
  [ -r "$z/temp" ] || continue
  [ -n "$t" ] || t=$z/temp
  case "$(cat "$z/type" 2>/dev/null)" in *cpu* | *soc* | *CPU*) t=$z/temp; break ;; esac
done
[ -n "$t" ] && awk '{ print "cpu_temp", $1 / 1000 }' "$t"
# the mower's own network, from its /proc/net (/proc/1/net mounted at /host-net, compose.yaml): the signal of the first
# wifi interface in dBm (some drivers count it from 0), the interface the default route goes out on and its address
N=/host-net
[ -r "$N/wireless" ] && awk 'NR > 2 && $1 ~ /:$/ {
  sub(/:$/, "", $1); w = $4 + 0; if (w > 0) w -= 256
  print "wifi_iface", $1; print "wifi_signal", w; exit
}' "$N/wireless"
[ -r "$N/route" ] && [ -r "$N/fib_trie" ] && awk '
  function hex(s,    i, n) { for (i = 1; i <= length(s); i++) n = n * 16 + index("0123456789ABCDEF", toupper(substr(s, i, 1))) - 1; return n }
  # the routing table keeps addresses as little endian hex
  function le(s) { return hex(substr(s, 7, 2) substr(s, 5, 2) substr(s, 3, 2) substr(s, 1, 2)) }
  function ip(s,    a) { split(s, a, "."); return ((a[1] * 256 + a[2]) * 256 + a[3]) * 256 + a[4] }
  FILENAME ~ /route$/ {
    if (FNR == 1) next
    if ($2 == "00000000") { if (dev == "" || $7 + 0 < metric) { dev = $1; metric = $7 + 0 } }
    else { n++; net[n] = $1; dest[n] = le($2); mask[n] = le($8) }
    next
  }
  # an address line, then what it is: "/32 host LOCAL" is an address of this machine
  $1 == "|--" { addr = $2; next }
  /\/32 host LOCAL/ && addr != "" { own[addr] = 1 }
  END {
    if (dev == "") exit
    print "net_iface", dev
    for (a in own) for (i = 1; i <= n; i++)
      if (net[i] == dev && and(ip(a), mask[i]) == dest[i]) { print "net_ip", a; exit }
  }' "$N/route" "$N/fib_trie"
