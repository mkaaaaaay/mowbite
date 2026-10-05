# input: "<unix time> <topic> <json>" from mosquitto_sub (robot_state/json and events/json). output: one ntfy message as
# json a line, notify.sh sends it. what's sent comes from CONF (notify.cgi writes it), read again every half minute:
#   topic, lang (de/en), name (of the mower), url (where MowBite is, for its button and a tap on the message),
#   events (which of: emergency, dock_failed, undock_failed, nav_error, spinup, done, rain, battery),
#   remind (minutes between reminders while the mower can't get on by itself, 0: none),
#   emergency_wait (seconds an emergency stop has to last before it's told, 10 unless set), enabled (0: switched off)
# and SNOOZE: until when (unix time) there are no reminders.
# the emergency stop comes from robot_state, a stop button, lifting or a bumper don't come as events. it only counts once
# it lasted emergency_wait seconds: a bumper touched while docking clears itself.
# sent home in the middle of a path OpenMower also reports a navigation error, so one only counts when no docking
# follows within a few seconds

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
  topic = ""; lang = "en"; name = ""; url = ""; events = ""; remind = 0; emergency_wait = 10; enabled = 1
  while ((getline line < CONF) > 0) {
    k = line
    sub(/ .*/, "", k)
    sub(/^[^ ]* /, "", line)
    if (k == "topic") topic = line
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
  # no topic or switched off: nothing to send, notify.sh starts again once there is
  if (!topic || !enabled) exit
}

function on(kind) { return index(events, "," kind ",") > 0 }

function tx(en, de) { return lang == "de" ? de : en }

function who() { return name ? name : tx("The mower", "Der Mäher") }

function minutes(s) { return int(s / 60 + 0.5) }

# kind: problem or info, phase: new, again or clear. prio: ntfy priority, tags: ntfy emoji tags
function send(kind, phase, title, msg, prio, tags,   json, acts) {
  json = "{\"topic\":\"" jesc(topic) "\",\"title\":\"" jesc(title) "\",\"message\":\"" jesc(msg) "\",\"priority\":" prio
  json = json ",\"tags\":[\"" tags "\"]"
  if (url) {
    json = json ",\"click\":\"" jesc(url) "/activity/\""
    acts = "{\"action\":\"view\",\"label\":\"" jesc(tx("Open MowBite", "MowBite öffnen")) "\",\"url\":\"" jesc(url) "/\"}"
    # only reaches the mower from the home network
    if (phase != "clear" && remind)
      acts = acts ",{\"action\":\"http\",\"label\":\"" jesc(tx("Snooze 1 h", "1 h schlummern")) "\",\"url\":\"" jesc(url) \
        "/cgi-bin/notify?snooze=3600\",\"method\":\"POST\",\"clear\":true}"
    json = json ",\"actions\":[" acts "]"
  }
  print json "}"
  fflush()
}

# the problems the mower can't get out of by itself: one at a time, the first one stays until it's over
function open(kind, why, from) {
  if (problem) return
  problem = kind; since = from ? from : t; told = 0
  if (on(kind)) { tell("new", why); told = t }
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
    if (phase == "clear") send(problem, phase, tx("Back in the dock", "Wieder in der Ladestation"), tx(who() " is charging again.", who() " lädt wieder."), 2, "white_check_mark")
    else send(problem, phase, tx("Docking failed", "Andocken gescheitert"), phase == "new" ? tx(who() " gave up docking after several tries and is standing outside the dock.", who() " hat das Andocken nach mehreren Versuchen aufgegeben und steht außerhalb der Ladestation.") : tx(who() " is still outside the dock (for " minutes(t - since) " min).", who() " steht immer noch außerhalb der Ladestation (seit " minutes(t - since) " min)."), 4, "warning")
  } else if (problem == "undock_failed") {
    if (phase == "clear") send(problem, phase, tx("On its way again", "Wieder unterwegs"), tx(who() " got out of the dock.", who() " ist aus der Ladestation gekommen."), 2, "white_check_mark")
    else send(problem, phase, tx("Undocking failed", "Abdocken gescheitert"), phase == "new" ? tx(who() " didn't get out of the dock and stopped.", who() " ist nicht aus der Ladestation gekommen und hat angehalten.") : tx(who() " still hasn't got out of the dock (for " minutes(t - since) " min).", who() " ist immer noch nicht aus der Ladestation gekommen (seit " minutes(t - since) " min)."), 4, "warning")
  }
}

function info(kind, title, msg, tags) {
  if (on(kind)) send(kind, "new", title, msg, 3, tags)
}

BEGIN {
  CONF = ENVIRON["CONF"]
  SNOOZE = ENVIRON["SNOOZE"]
  # how long a docking may take to follow a navigation error that only came because it was sent home
  NAV_WAIT = 3
  # the emergency stop a failed mow motor start puts it in
  SPINUP_WAIT = 15
}

{
  t = $1 + 0
  topic_in = $2
  json = $0
  sub(/^[^ ]+ [^ ]+ /, "", json)
  if (!conf_t || t - conf_t >= 30) readconf()

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
      close_problem(0)
      open("emergency", em_t - spinup_t <= SPINUP_WAIT ? tx("The mow motor didn't start.", "Der Mähmotor lief nicht an.") : "", em_t)
      em_t = 0
    }
    charging = field(json, "is_charging")
    if (problem == "dock_failed" && (charging == "1" || charging == "true")) close_problem(1)
  } else if (topic_in ~ /events\/json$/) {
    type = field(json, "type")
    if (type == "DOCKING_FAILED") open("dock_failed")
    else if (type == "UNDOCKING_FAILED") open("undock_failed")
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
  if (problem && told && remind && t - told >= remind && t >= snooze) {
    tell("again")
    told = t
  }
}
