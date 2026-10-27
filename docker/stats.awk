# input: "<unix time> <topic> <json or value>" from mosquitto_sub (robot_state/json and the mow motor's rpm).
# blade time (the mow motor turning, like battery.awk), the distance driven with and without the blade (not while
# idle) and the runs (leaving the dock or idle, like the activity page), summed per hour. HOURS gets a line
# "<hour start> <blade s> <m with blade> <m without> <runs>" once an hour is over and had something in it. STATE keeps
# the totals since counting started and the hour going on, so a restart of the container loses nothing:
#   "<since> <blade s> <m with blade> <m without> <runs> <hour start> <blade s> <m with blade> <m without> <runs>"
function save() {
  printf "%d %.1f %.1f %.1f %d %d %.1f %.1f %.1f %d\n", since, tb, tm, td, tn, ht, hb, hm, hd, hn > (STATE ".tmp")
  close(STATE ".tmp")
  system("mv " STATE ".tmp " STATE)
  saved = t
}
function flush() {
  if (hb > 0 || hm > 0 || hd > 0 || hn > 0) {
    printf "%d %.1f %.1f %.1f %d\n", ht, hb, hm, hd, hn >> HOURS
    close(HOURS)
  }
  hb = 0; hm = 0; hd = 0; hn = 0
}
function num(key,    s) {
  if (!match($0, "\"" key "\":-?[0-9.eE+-]+")) return "-"
  s = substr($0, RSTART, RLENGTH); sub(/^[^:]*:/, "", s); return s + 0
}
BEGIN {
  HOURS = ENVIRON["HOURS"]
  STATE = ENVIRON["STATE"]
  ht = -1
  if ((getline line < STATE) > 0) {
    split(line, s, " ")
    since = s[1] + 0; tb = s[2] + 0; tm = s[3] + 0; td = s[4] + 0; tn = s[5] + 0
    ht = s[6] + 0; hb = s[7] + 0; hm = s[8] + 0; hd = s[9] + 0; hn = s[10] + 0
  }
  close(STATE)
}

{
  t = $1 + 0
  if (!since) since = int(t)
  # a new hour: the one before is done (also one kept from before a restart)
  h = int(t)
  h -= h % 3600
  if (h != ht) {
    if (ht >= 0) flush()
    ht = h
    # the hour gone into hours goes out of state right away: else it's counted twice, or once more after a restart
    save()
  }
  if ($2 ~ /om_mow_motor_rpm\/data$/) {
    # blade time between two readings, gaps of the stream don't count. backwards (randomize_mow_motor_direction) too
    if (blade && t - rpm_t < 15) { tb += t - rpm_t; hb += t - rpm_t }
    blade = $3 + 0 > 500 || $3 + 0 < -500
    rpm_t = t
  } else {
    st = ""
    if (match($0, /"current_state":"[A-Z_]*"/)) st = substr($0, RSTART + 17, RLENGTH - 18)
    if (st != "" && last_st == "IDLE" && (st == "UNDOCKING" || st == "MOWING")) { tn++; hn++ }
    x = num("x"); y = num("y")
    if (x != "-" && y != "-") {
      # driven since the last position, a jump of it isn't
      if (pose_t && st != "IDLE" && t - pose_t < 10) {
        d = sqrt((x - px) * (x - px) + (y - py) * (y - py))
        if (d < 5) {
          if (blade) { tm += d; hm += d } else { td += d; hd += d }
        }
      }
      px = x; py = y; pose_t = t
    }
    if (st != "") last_st = st
  }
  if (t - saved >= 60) save()
}

END { if (t) save() }
