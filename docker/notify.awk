# input: "<unix time> <topic> <json>" from mosquitto_sub (robot_state/json, events/json, actions/json and
# sensors/om_v_charge/data). output, a line each, for notify.sh: "ntfy <json>" for the topic and "push <json>" for the
# phones signed up in MowBite's app (UnifiedPush, the app shows those itself). what's sent comes from CONF (notify.cgi
# writes it), read again every half minute:
#   topic, push (a phone's address, a line each), lang (de/en), name (of the mower), url (where MowBite is, for its
#   button and a tap on the message),
#   events (which of: emergency, dock_failed, undock_failed, nav_error, spinup, standstill, done, rain, battery,
#   maintenance),
#   remind (minutes between reminders while the mower can't get on by itself, 0: none),
#   emergency_wait (seconds an emergency stop has to last before it's told, 10 unless set), enabled (0: switched off)
# and SNOOZE: until when (unix time) there are no reminders. STATS: where stats.sh counts the blade hours, a part
# whose maintenance is due is told once, until it's done again (STATS/reminded keeps which were told).
# the emergency stop comes from robot_state, a stop button, lifting or a bumper don't come as events. it only counts once
# it lasted emergency_wait seconds: a bumper touched while docking clears itself.
# sent home in the middle of a path OpenMower also reports a navigation error, so one only counts when no docking
# follows within a few seconds.
# standing still: not half a meter on in ten minutes and not charging (is_charging, or the charge voltage when the
# battery is full), outside recording, an emergency stop and a pause by hand (actions/json). waiting for gps, stuck,
# left waiting on the lawn, or in a dock without power. told once, a dock without power stays so all night

function field(s, k,   v) {
  if (!match(s, "\"" k "\" *: *(\"[^\"]*\"|[^,}]*)")) return ""
  v = substr(s, RSTART, RLENGTH)
  sub(/^[^:]*: */, "", v)
  gsub(/"/, "", v)
  return v
}

function jesc(s) {
  gsub(/\\/, "\\\\", s)
  gsub(/"/, "\\\"", s)
  return s
}

function readconf(   line, k) {
  topic = ""; npush = 0; lang = "en"; name = ""; url = ""; events = ""; remind = 0; emergency_wait = 10; enabled = 1
  while ((getline line < CONF) > 0) {
    k = line
    sub(/ .*/, "", k)
    sub(/^[^ ]* /, "", line)
    if (k == "topic") topic = line
    else if (k == "push") npush++
    else if (k == "lang") lang = line
    else if (k == "name") name = line
    else if (k == "url") url = line
    else if (k == "events") events = "," line ","
    else if (k == "remind") remind = line * 60
    else if (k == "emergency_wait") emergency_wait = line + 0
    else if (k == "enabled") enabled = line + 0
  }
  close(CONF)
  snooze = 0
  if (SNOOZE && (getline line < SNOOZE) > 0) snooze = line + 0
  if (SNOOZE) close(SNOOZE)
  conf_t = t
  # nowhere to send or switched off: nothing to do, notify.sh starts again once there is
  if ((!topic && !npush) || !enabled) exit
}

function on(kind) { return index(events, "," kind ",") > 0 }

# standing still is told once, the other problems are reminded of while they last
function reminds(kind) { return remind && kind != "standstill" }

function tx(en, de) { return lang == "de" ? de : en }

function who() { return name ? name : tx("The mower", "Der Mäher") }

function minutes(s) { return int(s / 60 + 0.5) }

# kind: emergency, done, ... (the events), phase: new, again or clear. prio: ntfy priority, tags: ntfy emoji tags
function send(kind, phase, title, msg, prio, tags,   json, acts) {
  if (npush) push(kind, phase, title, msg, prio)
  if (!topic) return
  json = "{\"topic\":\"" jesc(topic) "\",\"title\":\"" jesc(title) "\",\"message\":\"" jesc(msg) "\",\"priority\":" prio
  json = json ",\"tags\":[\"" tags "\"]"
  if (url) {
    json = json ",\"click\":\"" jesc(url) "/activity/\""
    acts = "{\"action\":\"view\",\"label\":\"" jesc(tx("Open MowBite", "MowBite öffnen")) "\",\"url\":\"" jesc(url) "/\"}"
    # only reaches the mower from the home network. only on a problem it reminds of, like push below
    if (phase != "clear" && reminds(kind) && kind ~ /^(emergency|dock_failed|undock_failed|nav_error|spinup|standstill)$/)
      acts = acts ",{\"action\":\"http\",\"label\":\"" jesc(tx("Snooze 1 h", "1 h schlummern")) "\",\"url\":\"" jesc(url) \
        "/cgi-bin/notify?snooze=3600\",\"method\":\"POST\",\"clear\":true}"
    json = json ",\"actions\":[" acts "]"
  }
  print "ntfy " json "}"
  fflush()
}

# the same for MowBite's app: it sorts it into its channels (problems, reminders, info), a reminder and the all clear
# take the place of the message about the problem, a tap opens the page, snooze has a button (from the home network)
function push(kind, phase, title, msg, prio,   json, problem) {
  problem = kind ~ /^(emergency|dock_failed|undock_failed|nav_error|spinup|standstill)$/
  json = "{\"title\":\"" jesc(title) "\",\"message\":\"" jesc(msg) "\",\"kind\":\"" kind "\",\"phase\":\"" phase "\""
  json = json ",\"problem\":" (problem ? "true" : "false")
  json = json ",\"prio\":" prio ",\"t\":" int(t) ",\"lang\":\"" lang "\",\"path\":\"/activity/\""
  if (url) {
    json = json ",\"api\":\"" jesc(url) "\""
    if (problem && phase != "clear" && reminds(kind)) json = json ",\"snooze\":\"" jesc(tx("Snooze 1 h", "1 h schlummern")) "\""
  }
  print "push " json "}"
  fflush()
}

# the problems the mower can't get out of by itself: one at a time, the first one stays until it's over. standing still
# makes way for one that says why. one that isn't picked is left out and doesn't hold back the others
function open(kind, why, from) {
  if (!on(kind)) return
  if (problem == "standstill" && kind != "standstill") close_problem(0)
  if (problem) return
  problem = kind; since = from ? from : t
  tell("new", why); told = t
}

function close_problem(fixed) {
  if (problem && told && fixed) tell("clear")
  problem = ""
}

function tell(phase, why,   m) {
  if (problem == "emergency") {
    if (phase == "clear") send(problem, phase, tx("Emergency stop cleared", "Notaus aufgehoben"), tx(who() " is ready again.", who() " ist wieder bereit."), 2, "white_check_mark")
    else {
      m = phase == "new" ? tx(who() " is in emergency stop.", who() " steht im Notaus.") : tx(who() " is still in emergency stop (for " minutes(t - since) " min).", who() " steht immer noch im Notaus (seit " minutes(t - since) " min).")
      if (why) m = m " " why
      send(problem, phase, tx("Emergency stop", "Notaus"), m, phase == "new" ? 5 : 4, "rotating_light")
    }
  } else if (problem == "dock_failed") {
    if (phase == "clear") send(problem, phase, tx("Back in the dock", "Wieder im Dock"), tx(who() " is charging again.", who() " lädt wieder."), 2, "white_check_mark")
    else send(problem, phase, tx("Docking failed", "Andocken fehlgeschlagen"), phase == "new" ? tx(who() " gave up docking after several tries and is standing outside the dock.", who() " hat das Andocken nach mehreren Versuchen aufgegeben und steht außerhalb des Docks.") : tx(who() " is still outside the dock (for " minutes(t - since) " min).", who() " steht immer noch außerhalb des Docks (seit " minutes(t - since) " min)."), 4, "warning")
  } else if (problem == "standstill") {
    if (phase == "clear") {
      if (still_home) send(problem, phase, tx("Charging again", "Lädt wieder"), tx(who() " is charging again.", who() " lädt wieder."), 2, "white_check_mark")
      else send(problem, phase, tx("On its way again", "Wieder unterwegs"), tx(who() " is moving again.", who() " bewegt sich wieder."), 2, "white_check_mark")
    } else {
      m = tx(who() " has been standing still for " minutes(t - since) " min and isn't charging.", who() " steht seit " minutes(t - since) " min still und lädt nicht.")
      if (still_why == "PAUSED") m = m " " tx("Paused, waiting for GPS.", "Pausiert, weil GPS fehlt.")
      else if (still_why == "IDLE") m = m " " tx("Waiting on the lawn, or in the dock and that has no power.", "Wartet auf dem Rasen, oder steht in der Station und die hat keinen Strom.")
      else m = m " " tx("Not getting on, maybe stuck.", "Kommt nicht weiter, steckt vielleicht fest.")
      send(problem, phase, tx("Standing still", "Steht still"), m, 4, "warning")
    }
  } else if (problem == "undock_failed") {
    if (phase == "clear") send(problem, phase, tx("On its way again", "Wieder unterwegs"), tx(who() " got out of the dock.", who() " ist aus dem Dock gekommen."), 2, "white_check_mark")
    # out of the dock already, it got no gps there
    else if (undock_why == "no_gps") send(problem, phase, tx("No GPS after undocking", "Kein GPS nach dem Abdocken"), phase == "new" ? tx(who() " got out of the dock but has no GPS, it stands in front of the dock.", who() " ist aus dem Dock gekommen, hat aber kein GPS und steht vor dem Dock.") : tx(who() " still stands in front of the dock without GPS (for " minutes(t - since) " min).", who() " steht immer noch ohne GPS vor dem Dock (seit " minutes(t - since) " min)."), 4, "warning")
    else send(problem, phase, tx("Undocking failed", "Abdocken fehlgeschlagen"), phase == "new" ? tx(who() " didn't get out of the dock and stopped.", who() " ist nicht aus dem Dock gekommen und hat angehalten.") : tx(who() " still hasn't got out of the dock (for " minutes(t - since) " min).", who() " ist immer noch nicht aus dem Dock gekommen (seit " minutes(t - since) " min)."), 4, "warning")
  }
}

# st: robot_state's current_state, x and y its position, home: charging or on the contacts. without a charge voltage
# idle isn't watched, a full battery in the dock wouldn't look any different. paused by hand it waits on purpose
function standstill(st, x, y, home,   dx, dy) {
  if (home || emergency || st == "" || st == "AREA_RECORDING" || (st == "IDLE" && !have_v) || (st == "PAUSED" && manual)) {
    still_t = 0
    still_home = home
    if (problem == "standstill") close_problem(home)
    return
  }
  dx = x - still_x
  dy = y - still_y
  if (!still_t || dx * dx + dy * dy > STILL_M * STILL_M) {
    still_home = 0
    if (still_t && problem == "standstill") close_problem(1)
    still_t = t; still_x = x; still_y = y
    return
  }
  if (t - still_t >= STILL_WAIT && !problem && on("standstill")) {
    still_why = st
    open("standstill", "", still_t)
  }
}

function info(kind, title, msg, tags) {
  if (on(kind)) send(kind, "new", title, msg, 3, tags)
}

# the parts due for maintenance by the blade hours, each once until it's seen to again
function maintenance(   line, p, total, h, k) {
  maint_t = t
  if (!STATS || !on("maintenance")) return
  if ((getline line < (STATS "/state")) <= 0) { close(STATS "/state"); return }
  close(STATS "/state")
  split(line, p, " ")
  total = p[2] + 0
  while ((getline line < (STATS "/maint")) > 0) {
    split(line, p, " ")
    if (p[2] + 0 <= 0 || total - p[3] < p[2] * 3600 || (p[1] in reminded && reminded[p[1]] == p[4])) continue
    h = int((total - p[3]) / 3600)
    if (p[1] == "blade") send("maintenance_blade", "new", tx("Change the blades", "Messer wechseln"), tx(who() " has mowed " h " h since the blades were last changed.", who() " hat seit dem letzten Messerwechsel " h " h gemäht."), 3, "wrench")
    else if (p[1] == "clean") send("maintenance_clean", "new", tx("Time for a clean", "Zeit zum Reinigen"), tx(who() " has mowed " h " h since it was last cleaned: underside, wheels and charging contacts.", who() " hat seit der letzten Reinigung " h " h gemäht: Unterseite, Räder und Ladekontakte."), 3, "broom")
    else continue
    reminded[p[1]] = p[4]
    printf "" > (STATS "/reminded")
    for (k in reminded) print k, reminded[k] >> (STATS "/reminded")
    close(STATS "/reminded")
  }
  close(STATS "/maint")
}

BEGIN {
  CONF = ENVIRON["CONF"]
  SNOOZE = ENVIRON["SNOOZE"]
  # how long a docking may take to follow a navigation error that only came because it was sent home
  NAV_WAIT = 3
  # the emergency stop a failed mow motor start puts it in
  SPINUP_WAIT = 15
  # standing still: not this far on in this many seconds
  STILL_M = 0.5
  STILL_WAIT = 600
  STATS = ENVIRON["STATS"]
  if (STATS) {
    while ((getline line < (STATS "/reminded")) > 0) {
      split(line, p, " ")
      reminded[p[1]] = p[2]
    }
    close(STATS "/reminded")
  }
}

{
  t = $1 + 0
  topic_in = $2
  json = $0
  sub(/^[^ ]+ [^ ]+ /, "", json)
  if (!conf_t || t - conf_t >= 30) readconf()
  if (t - maint_t >= 300) maintenance()

  if (topic_in ~ /robot_state\/json$/) {
    e = field(json, "emergency")
    e = e == "1" || e == "true"
    if (e && !emergency) em_t = t
    else if (!e && emergency) {
      em_t = 0
      if (problem == "emergency") close_problem(1)
    }
    emergency = e
    if (em_t && emergency && t - em_t >= emergency_wait) {
      # takes the place of what was before, unless it isn't picked
      if (on("emergency")) close_problem(0)
      open("emergency", em_t - spinup_t <= SPINUP_WAIT ? tx("The mow motor didn't start.", "Der Mähmotor lief nicht an.") : "", em_t)
      em_t = 0
    }
    charging = field(json, "is_charging")
    if (problem == "dock_failed" && (charging == "1" || charging == "true")) close_problem(1)
    # not out of the dock and charging there: told once, no reminders all night
    if (problem == "undock_failed" && undock_why != "no_gps" && (charging == "1" || charging == "true")) close_problem(0)
    standstill(field(json, "current_state"), field(json, "x") + 0, field(json, "y") + 0, charging == "1" || charging == "true" || v_charge > 20)
  } else if (topic_in ~ /sensors\/om_v_charge\/data$/) {
    v_charge = json + 0
    have_v = 1
  } else if (topic_in ~ /actions\/json$/) {
    # mowing's continue is offered only while it's paused by hand, waiting for gps it isn't. v1's start button continues
    # without new actions, a pause ended by it while gps is missing isn't told as standing still
    manual = 0
    if (match(json, /[{][^{}]*"mower_logic:mowing\/continue"[^{}]*[}]/)) {
      a = field(substr(json, RSTART, RLENGTH), "enabled")
      manual = a == "1" || a == "true"
    }
  } else if (topic_in ~ /events\/json$/) {
    type = field(json, "type")
    if (type == "DOCKING_FAILED") open("dock_failed")
    else if (type == "UNDOCKING_FAILED") {
      undock_why = field(json, "reason")
      open("undock_failed")
    }
    else if (type == "DOCKED" && problem == "dock_failed") close_problem(1)
    else if (type == "UNDOCKED" && problem == "undock_failed") close_problem(1)
    else if (type == "NAVIGATION_ERROR") nav_t = t
    else if (type == "MOW_MOTOR_SPINUP_FAILED") {
      spinup_t = t
      # with the emergency stop it's in that message
      if (!on("emergency")) info("spinup", tx("Mow motor didn't start", "Mähmotor lief nicht an"), tx(who() " couldn't start the blade and stopped.", who() " konnte das Messer nicht starten und hat angehalten."), "warning")
    } else if (type == "JOB_COMPLETE") info("done", tx("Done mowing", "Fertig gemäht"), tx(who() " has finished the job.", who() " hat den Mähauftrag abgeschlossen."), "seedling")
    else if (type == "DOCKING") {
      why = field(json, "reason")
      if (why ~ /[Rr]ain/) info("rain", tx("Rain", "Regen"), tx(who() " is going home, it's raining.", who() " fährt wegen Regen nach Hause."), "cloud_with_rain")
      else if (why ~ /[Bb]attery/) info("battery", tx("Battery low", "Akku leer"), tx(who() " is going home to charge.", who() " fährt zum Laden nach Hause."), "battery")
    } else if (type == "STATE") {
      st = field(json, "state")
      if (st == "DOCKING" && nav_t && t - nav_t <= NAV_WAIT) nav_t = 0
      # started again, also by hand: what was before is over
      if ((st == "UNDOCKING" || st == "MOWING") && (problem == "dock_failed")) close_problem(0)
      if (st == "MOWING" && problem == "undock_failed") close_problem(1)
    }
  }

  if (nav_t && t - nav_t > NAV_WAIT) {
    nav_t = 0
    info("nav_error", tx("Navigation error", "Navigationsfehler"), tx(who() " couldn't follow its path and is waiting. Often something is in the way.", who() " kam auf der Bahn nicht weiter und wartet. Oft ist etwas im Weg."), "warning")
  }
  if (problem && told && reminds(problem) && t - told >= remind && t >= snooze) {
    tell("again")
    told = t
  }
}
