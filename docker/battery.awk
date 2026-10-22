# input: "<unix time> <topic> <value>" from mosquitto_sub. output, appended to OUT:
#   charge <start> <end> <minutes> <volts at start> <volts at the end>   from charging on until the charger says Done
#   run <start> <end> <blade minutes> <volts after charging> <volts when charging starts again>   between two charges
# the state in between (a run since the last charge, a charge going on) is kept in STATE, so a restart of the container
# doesn't lose the run it was in
#
# what the battery's capacity is read from, appended to HEALTH. only the current into the battery while charging is
# measured, nothing measures what it gives out, so the charge is counted and the voltages it passes:
#   chg <start> <end> <key=value ...>   a charge of 5 minutes or more, or one the charger started by itself after Done
#   dis <start> <end> why=charge|power|drive|blade|gap d=<V>:<s>,...   standing without power at the dock, the blade off:
#     when the voltage passed each half volt, seconds from the start (the first is where it started)
# chg: end=done|lost, prev=the charger's state before (done, notcharging, fault ...), rst=1 when the container restarted
# during it or came up while it was going on, idle=h since Done, off=s without power at the dock since Done, blade=min
# since the blade last turned (-1 not seen), v0=V before the charger switched on, j1=V it jumped by then, j30=V it rose
# from 2-5 s to 25-35 s, tm=mow motor °C then, cpu=°C of the mower's cpu then (- when MowBite runs elsewhere),
# ah/cc/cv=Ah in all, at constant current and at constant voltage, ccmin/cvmin=their minutes, icc=mean A at constant
# current, vcv=mean V at constant voltage, idone=A when it said Done, gsum/gmax=s the stream was missing (or the charger
# couldn't be read) in all and at most, sag/sagmin=s and lowest margin (V, 30 s median) the dock's voltage had above the
# battery's (below 0.1 the dock may not carry the electronics alone, part of the current counted then goes into them),
# q=Ah since the start when the voltage first reached each quarter volt at constant current, from 10 minutes on (the
# first is where it started; after a gap, a pause or the charger off constant current it starts again 10 minutes later
# from where it is then, marked x. x on a quarter: the quarter before it had a swing of the current or a sag)
# the charger's voltage isn't the battery's: while charging it reads about 0.35 V + 0.49 V per A above it
# TRACES: a file per charge with a line a second "<time> <A> <V> <dock V> <charger state>", from a minute before it to
# half an hour after (12 h at most), then handed to TIDY
function save(    k, line) {
  if (!STATE) return
  line = sprintf("%d %.2f %.1f %d %d %.2f", run_t, run_v, blade_s, charging, charge_t, charge_v)
  for (k in h) if (h[k] != "") line = line " " k "=" h[k]
  for (k in c) if (c[k] != "") line = line " c." k "=" c[k]
  print line > STATE
  close(STATE)
  saved = t
  dirty = 0
}

function start_charge(    x) {
  split("", c)
  split("", sw); split("", so); swn = 0
  if (h["dt"] != "") end_dis("charge")
  c["prev"] = h["pst"] != "" ? h["pst"] : "unknown"
  c["idle"] = c["prev"] == "done" && h["done_t"] ? sprintf("%.2f", (t - h["done_t"]) / 3600) : -1
  c["off"] = c["prev"] == "done" ? int(h["off"]) : -1
  c["blade"] = h["blade_t"] ? int((t - h["blade_t"]) / 60) : -1
  c["v0"] = v_before ? v_before : "-"
  c["tm"] = tm != "" ? tm : "-"
  c["cpu"] = "-"
  if (CPUT) { if ((getline x < CPUT) > 0 && x ~ /^-?[0-9]+$/) c["cpu"] = x / 1000; close(CPUT) }
  # came up while it was going on: its start is missing, the jump with it
  c["rst"] = up ? 0 : 1
  if (!up) c["nj"] = 1
  c["ah"] = 0; c["cc"] = 0; c["cv"] = 0; c["ccs"] = 0; c["cvs"] = 0; c["gsum"] = 0; c["gmax"] = 0; c["sag"] = 0
  c["sagmin"] = 99
  c["it"] = t; c["ip"] = cur
  if (TRACES) start_trace()
}

# the charge counted from one current reading to the next. when the charger can't be read it sends its last current
# again, that counts as missing
function count(    dt, q) {
  dt = t - c["it"]
  if (dt > 0 && dt <= 5 && st !~ /^(Comms Error|Charger Not Found)/) {
    q = c["ip"] * dt / 3600
    c["ah"] += q
    if (st ~ /^Fast Charge/) { c["cc"] += q; c["ccs"] += dt }
    else if (st ~ /^Taper/) { c["cv"] += q; c["cvs"] += dt }
  } else if (dt > 0) {
    c["gsum"] += dt
    if (dt > c["gmax"]) c["gmax"] = dt
  }
  # the quarters start again 10 minutes after a gap, a pause or the charger off constant current
  if (dt > 5 || st !~ /^Fast Charge/ || i <= 0.1) { c["mk"] = 0; c["rs"] = t }
  # at constant current the charger holds it, a swing means the dock or the contacts held it back
  if (st ~ /^Fast Charge/ && i > 0.1) {
    c["im"] = c["im"] ? c["im"] + (i - c["im"]) * (dt > 0 && dt < 5 ? dt : 5) / 300 : i
    if (i < c["im"] * 0.96 || i > c["im"] * 1.04) c["bad"] = 1
  }
  if (i > 0.05) c["il"] = i
  c["it"] = t; c["ip"] = i
}

function charge_volts(    s) {
  s = t - charge_t
  if (c["j1"] == "" && c["v0"] != "-") c["j1"] = sprintf("%.3f", volts - c["v0"])
  if (!c["nj"]) {
    if (s >= 2 && s <= 5) { c["ja"] += volts; c["jan"]++ }
    else if (s >= 25 && s <= 35) { c["jb"] += volts; c["jbn"]++ }
  }
  if (st ~ /^Taper/) { c["vcv"] += volts; c["vcvn"]++ }
  # a gap here starts the quarters again too, after a restart the voltage may come before the current
  if ((c["vt"] && t - c["vt"] > 5) || st !~ /^Fast Charge/) { c["mk"] = 0; c["rs"] = t }
  c["vt"] = t
  if (s < 600 || t - c["rs"] < 600) return
  if (!c["mk"]) {
    c["mk"] = int(volts / 0.25 + 1) * 0.25
    c["q"] = c["q"] (c["q"] != "" ? "," : "") sprintf("%.3f:%.4f%s", volts, c["ah"], c["q"] != "" ? "x" : "")
    c["bad"] = 0
  }
  while (volts >= c["mk"]) {
    c["q"] = c["q"] sprintf(",%.2f:%.4f%s", c["mk"], c["ah"], c["bad"] ? "x" : "")
    c["bad"] = 0
    c["mk"] += 0.25
  }
}

# the dock's voltage against the battery's while charging, the middle of the last 30 readings
function dock(    d, k, j, n, m) {
  d = vc - volts + 0.35 + 0.49 * c["ip"]
  k = swn % 30
  n = swn + 0
  # so: the same sorted, the oldest out and the new one in
  if (swn >= 30) {
    for (j = 0; j < 29 && so[j] != sw[k]; j++);
    for (; j < 29; j++) so[j] = so[j + 1]
    n = 29
  }
  sw[k] = d
  swn++
  for (j = n; j > 0 && so[j - 1] > d; j--) so[j] = so[j - 1]
  so[j] = d
  if (swn < 30) return
  m = (so[14] + so[15]) / 2
  if (m < c["sagmin"]) c["sagmin"] = m
  if (m < 0.1) { c["sag"]++; c["bad"] = 1 }
}

function finish(how, te,    line) {
  if (TRACES && h["tr"] != "") h["tr_end"] = int(t) + 1800
  if (HEALTH && (te - charge_t >= 300 || c["prev"] == "done")) {
    line = sprintf("chg %d %d end=%s prev=%s rst=%d idle=%s off=%s blade=%s v0=%s j1=%s j30=%s tm=%s cpu=%s", charge_t,
      te, how, c["prev"], c["rst"], c["idle"], c["off"], c["blade"], c["v0"] == "-" ? "-" : sprintf("%.3f", c["v0"]),
      c["j1"] == "" ? "-" : c["j1"], c["jan"] && c["jbn"] ? sprintf("%.3f", c["jb"] / c["jbn"] - c["ja"] / c["jan"]) : "-",
      c["tm"] == "-" ? "-" : sprintf("%.1f", c["tm"]), c["cpu"] == "-" || c["cpu"] == "" ? "-" : sprintf("%.1f", c["cpu"]))
    line = line sprintf(" ah=%.4f cc=%.4f cv=%.4f ccmin=%.1f cvmin=%.1f icc=%s vcv=%s idone=%s", c["ah"], c["cc"], c["cv"],
      c["ccs"] / 60, c["cvs"] / 60, c["ccs"] ? sprintf("%.3f", c["cc"] * 3600 / c["ccs"]) : "-",
      c["vcvn"] ? sprintf("%.3f", c["vcv"] / c["vcvn"]) : "-", how == "done" && c["il"] ? sprintf("%.3f", c["il"]) : "-")
    line = line sprintf(" gsum=%d gmax=%d sag=%d sagmin=%s q=%s", c["gsum"], c["gmax"], c["sag"],
      c["sagmin"] < 99 ? sprintf("%.2f", c["sagmin"]) : "-", c["q"] != "" ? c["q"] : "-")
    print line >> HEALTH
    close(HEALTH)
  }
  split("", c)
}

# standing without power at the dock with the blade off for 10 minutes: how long the battery takes from one half volt to
# the next shows what it holds, the electronics drawing about the same all the time
function idle_volts() {
  # after a start the dock's voltage and the robot's state come a moment later
  if (!vct || rstate == "") return
  # a gap of the stream or a restart up to two minutes goes on with the same (it's saved once a minute)
  if (h["dt"] != "" && t - h["dl"] > 125) end_dis("gap")
  if (t - vct >= 10) return
  if (vc < 20 && rstate == "IDLE" && (!h["blade_t"] || t - h["blade_t"] >= 600)) {
    if (h["dt"] == "") {
      h["dt"] = int(t)
      h["dq"] = sprintf("%.3f:0", volts)
      h["dm"] = int(volts * 2) / 2
      if (h["dm"] >= volts) h["dm"] -= 0.5
    }
    while (volts <= h["dm"]) {
      h["dq"] = h["dq"] sprintf(",%.1f:%d", h["dm"], t - h["dt"])
      h["dm"] -= 0.5
      dirty = 1
    }
    h["dl"] = int(t)
  } else if (h["dt"] != "") end_dis(vc >= 20 ? "power" : rstate != "IDLE" ? "drive" : "blade")
}

function end_dis(why,    x) {
  if (HEALTH && split(h["dq"], x, ",") >= 3) {
    print "dis " h["dt"] " " h["dl"] " why=" why " d=" h["dq"] >> HEALTH
    close(HEALTH)
  }
  delete h["dt"]; delete h["dq"]; delete h["dm"]; delete h["dl"]
  dirty = 1
}

function trace(    line, f) {
  line = sprintf("%.1f %.3f %.3f %.3f %s", t, cur, volts, vc, sst != "" ? sst : "-")
  # the last minute, for the start of the next charge
  if (h["tr"] == "") { ring[rn++ % 60] = line; return }
  f = h["tr"]
  print line >> f
  close(f)
  # half an hour after, or 12 hours into a charge that doesn't end (a charger that hangs)
  if (charging ? t - charge_t > 43200 : !h["tr_end"] || t > h["tr_end"]) end_trace()
}

function start_trace(    k, f) {
  if (h["tr"] != "") end_trace()
  f = TRACES "/" int(t) ".tsv"
  for (k = rn > 60 ? rn - 60 : 0; k < rn; k++) print ring[k % 60] >> f
  close(f)
  rn = 0
  h["tr"] = f
}

function end_trace(    f) {
  f = h["tr"]
  delete h["tr"]; delete h["tr_end"]
  # saved before it's packed, a restart doesn't write to it again
  save()
  if (TIDY) system(TIDY " " f " &")
}

BEGIN {
  # times kept in STATE with their fraction
  CONVFMT = "%.12g"
  OUT = ENVIRON["OUT"]
  STATE = ENVIRON["STATE"]
  HEALTH = ENVIRON["HEALTH"]
  TRACES = ENVIRON["TRACES"]
  TIDY = ENVIRON["TIDY"]
  CPUT = ENVIRON["CPUT"]
  if (STATE && (getline line < STATE) > 0) {
    close(STATE)
    n = split(line, s, " ")
    run_t = s[1] + 0; run_v = s[2] + 0; blade_s = s[3] + 0; charging = s[4] + 0; charge_t = s[5] + 0; charge_v = s[6] + 0
    for (k = 7; k <= n; k++) {
      e = index(s[k], "=")
      if (e < 2) continue
      key = substr(s[k], 1, e - 1)
      v = substr(s[k], e + 1)
      if (v ~ /^-?[0-9.]+(e[-+]?[0-9]+)?$/) v += 0
      if (key ~ /^c\./) c[substr(key, 3)] = v
      else h[key] = v
    }
    if (charging) {
      # kept by an older version without it: counted from its start, all of that missing
      if (c["it"] == "") { t = charge_t; start_charge() }
      # a charge going on lost what came while the container was down
      c["rst"] = 1
    }
  } else if (STATE) close(STATE)
}

{
  t = $1 + 0
  if ($2 ~ /robot_state\/json$/) {
    if (match($0, /"current_state":"[A-Z_]*"/)) rstate = substr($0, RSTART + 17, RLENGTH - 18)
    next
  }
  id = $2
  sub(/.*sensors\//, "", id)
  sub(/\/data$/, "", id)
  # the rest after time and topic. index($0, $3) found a "0" in the time already, a 0 read as a big number
  val = $0
  sub(/^[^ ]+ [^ ]+ /, "", val)

  if (id == "om_v_battery") {
    volts = val + 0
    if (charging) charge_volts()
    else idle_volts()
    if (TRACES) trace()
    if (dirty || t - saved > 60) save()
  } else if (id == "om_mow_motor_rpm") {
    # blade time between two readings, gaps of the stream don't count
    if (blade && t - rpm_t < 15) blade_s += t - rpm_t
    # a motor turning the other way round reports negative rpm (randomize_mow_motor_direction)
    blade = val + 0 > 500 || val + 0 < -500
    if (blade) h["blade_t"] = int(t)
    rpm_t = t
  } else if (id == "om_charge_current") {
    i = val + 0
    if (charging) count()
    # the battery's voltage before the charger switches on (the current comes before the voltage of the same second)
    else if (i < 0.05) v_before = volts
    # seen without charging: the next charge is seen from its start
    if (i <= 0.1) up = 1
    cur = i
    if (i > 0.1) {
      no_current_t = 0
      if (!charging && volts) {
        if (run_t) printf "run %d %d %.1f %.2f %.2f\n", run_t, t, blade_s / 60, run_v, volts >> OUT
        close(OUT)
        run_t = 0
        charging = 1; charge_t = t; charge_v = volts
        start_charge()
        save()
      }
    } else if (charging) {
      # off the charger before it said Done, e.g. a minute in the dock and off mowing again: after two minutes without
      # current the charge ends and the run starts from when the current stopped. it waited for a Done before and lost
      # the run
      if (!no_current_t) no_current_t = t
      else if (t - no_current_t > 120) {
        printf "charge %d %d %.1f %.2f %.2f\n", charge_t, no_current_t, (no_current_t - charge_t) / 60, charge_v, volts >> OUT
        close(OUT)
        charging = 0
        finish("lost", no_current_t)
        run_t = no_current_t; run_v = volts; blade_s = 0
        save()
      }
    }
  } else if (id == "om_charge_state") {
    st = val
    if (st ~ /^Fast Charge/) sst = "cc"
    else if (st ~ /^Taper/) sst = "cv"
    else { sst = tolower(st); gsub(/[^a-z]/, "", sst) }
    # since when it says Done, the end of a charge too, and its last state when not charging. a reading it couldn't take
    # doesn't change them
    if (st !~ /^(Comms Error|Unknown)/) {
      if (sst == "done" && h["lst"] != "done") { h["done_t"] = int(t); h["off"] = 0 }
      h["lst"] = sst
      if (st !~ /^(Trickle Charge|Pre Charge|Fast Charge|Taper Charge|Top Off)/) h["pst"] = sst
    }
    if (val == "Done" && charging) {
      printf "charge %d %d %.1f %.2f %.2f\n", charge_t, t, (t - charge_t) / 60, charge_v, volts >> OUT
      close(OUT)
      charging = 0
      finish("done", t)
      run_t = t; run_v = volts; blade_s = 0
      save()
    }
  } else if (id == "om_v_charge") {
    vc = val + 0
    # only while it charges from the dock, off it the margin says nothing
    if (charging && cur > 0.1 && vc >= 20) dock()
    else if (vc < 20 && vct && t - vct < 10) h["off"] += t - vct
    vct = t
  } else if (id == "om_mow_motor_temp") tm = val + 0
}
