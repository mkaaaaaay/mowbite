import {fmt} from './i18n';
import de from './i18n/de';

// The texts of the mower's events and their reasons as data, english with german from de.ts: the app says them from
// here (lib/events.ts) and MowBite for Home Assistant gets the same as src/lib/reasons.json (masterplan 3.1a, "Texte der
// OS-Events für HA"). A list of variants each, the first that fits is taken: when and unless compare the event's fields
// (all of them, exactly, {present: true} for one that's there). {field} is put in as it is, {field:n} with n decimals,
// "?" when it's missing. {X_clock} is a field X in unix s as the reader's own clock time (HH:MM), put in by the reader
// itself: a variant with it has when X_clock and one without the time after it, for a reader that doesn't. no_fix is
// put in the same way, true for an accuracy of 999 m and more (no position at all, not 999 m off). The severity is for
// events that don't bring their own (OpenMower, MowBite OS before E6).

export type Severity = 'error' | 'warning' | 'info';
type Value = string | number | boolean;
export type Cond = Record<string, Value | {present: boolean}>;
export interface Variant {
  when?: Cond;
  unless?: Cond;
  en: string;
  severity?: Severity;
  // false: the head alone, without the reason after it
  with_reason?: boolean;
  // the reason is the emergency's bits
  reason_is?: 'emergency_bits';
}
export interface EventText {
  severity: Severity;
  variants: Variant[];
  // how the head and the reason go together, else fallback.join
  join?: string;
  // worked out by whoever reads it, the variants are only its words: DOCKING (OpenMower's free text), GPS (lost only
  // counts while mowing), NAVIGATION_ERROR (the app sees whether it was sent home), AREA_RECORDED (its parts)
  reader_logic?: boolean;
  state_dependent?: boolean;
}

export const SCHEMA = 1;

const STATE_NAMES: [string, string][] = [
  ['IDLE', 'Idle'],
  ['MOWING', 'Mowing'],
  ['DOCKING', 'Heading home'],
  ['UNDOCKING', 'Leaving the dock'],
  ['PAUSED', 'Paused'],
  ['AREA_RECORDING', 'Recording an area'],
];

// a step of recording an area the mower turned down (RECORDING_REFUSED, MowBite OS only), the recording stays open
export const REFUSED_STEPS: Record<string, string> = {
  start_area_recording: "Recording mode didn't start",
  start_recording: 'Line not started',
  stop_recording: 'Line not closed',
  finish_mowing_area: 'Mowing area not saved',
  finish_navigation_area: 'Navigation area not saved',
  record_dock: 'Docking station not recorded',
  collect_point: 'Point not set',
  // the position got too inaccurate while recording, sent once until it's good again
  point: 'No points recorded',
};

// the phases of the calibration drive (CALIBRATION, MowBite OS only)
const CALIBRATION_PHASES: Record<string, string> = {
  start: 'Calibration drive started',
  align: 'Calibration: lining up',
  stand: 'Calibration: standing still',
  line: 'Calibration: driving straight',
  spin_left: 'Calibration: turning left',
  spin_right: 'Calibration: turning right',
  evaluate: 'Calibration: evaluating',
  end: 'Calibration drive ended',
};

const one = (en: string, severity?: Severity): EventText => ({severity: severity ?? 'info', variants: [{en}]});
const alone = (v: Variant): Variant => ({...v, with_reason: false});

export const EVENTS: Record<string, EventText> = {
  STATE: {
    severity: 'info',
    variants: [
      // MowBite OS says why it paused
      alone({when: {state: 'PAUSED', reason: 'MANUAL'}, en: 'Paused'}),
      {when: {state: 'PAUSED', reason: {present: true}}, en: 'Paused', severity: 'warning'},
      ...STATE_NAMES.map(([state, en]) => alone({when: {state}, en})),
      alone({when: {state: {present: true}}, en: '{state}'}),
      {en: 'State changed'},
    ],
  },
  GPS: {
    severity: 'info',
    reader_logic: true,
    state_dependent: true,
    variants: [{when: {available: true}, en: 'GPS fix'}, {en: 'GPS lost', severity: 'warning'}, {en: 'GPS off'}],
  },
  BLADES: {severity: 'info', variants: [{when: {enabled: true}, en: 'Blades on'}, {en: 'Blades off'}]},
  AREA: {severity: 'info', variants: [{when: {area_name: {present: true}}, en: 'Mowing "{area_name}"'}, {en: 'Mowing "unnamed"'}]},
  // only happens when someone presses skip
  AREA_SKIPPED: {severity: 'info', variants: [alone({en: 'Area skipped'})]},
  UNDOCKED: one('Left the dock'),
  UNDOCKING_FAILED: {severity: 'error', join: '{head} ({reason})', variants: [{en: 'Leaving the dock failed'}]},
  // OpenMower's free text is the reader's, MowBite OS's names are here
  DOCKING: {
    severity: 'info',
    reader_logic: true,
    variants: [
      alone({when: {reason: 'MANUAL'}, en: 'Sent home'}),
      {when: {reason: 'BATTERY_LOW'}, en: 'Heading home to charge'},
      {when: {reason: 'BATTERY_CRITICAL'}, en: 'Heading home to charge', severity: 'warning'},
      {when: {reason: 'BATTERY_HOT'}, en: 'Heading home', severity: 'warning'},
      {when: {reason: 'MOTOR_HOT'}, en: 'Heading home', severity: 'warning'},
      {en: 'Heading home'},
    ],
  },
  DOCKING_RETRY: {
    severity: 'warning',
    join: '{head} ({reason})',
    variants: [{when: {attempts: {present: true}}, en: 'Docking retry {attempts}'}, {en: 'Docking retry'}],
  },
  // MowBite OS: without attempts when it couldn't set off for the dock (no position, no heading)
  DOCKING_FAILED: {
    severity: 'error',
    join: '{head} ({reason})',
    variants: [{when: {attempts: {present: true}}, en: 'Docking failed after {attempts} tries'}, {en: 'Docking failed'}],
  },
  DOCKED: one('Docked'),
  JOB_COMPLETE: one('All areas done'),
  JOB_RESET: one('Interrupted job dropped, the next start mows from the beginning'),
  EMERGENCY: {
    severity: 'error',
    variants: [alone({when: {emergency: false}, en: 'Emergency cleared', severity: 'info'}), {en: 'Emergency stop', reason_is: 'emergency_bits'}],
  },
  NAVIGATION_ERROR: {
    severity: 'error',
    reader_logic: true,
    variants: [{when: {sentHome: true}, en: 'Path stopped, sent home', severity: 'info'}, {en: 'Navigation error'}],
  },
  MOW_MOTOR_SPINUP_FAILED: one("Mow motor didn't start", 'error'),
  FULLY_CHARGED: {
    severity: 'info',
    variants: [{when: {battery_voltage: {present: true}}, en: 'Fully charged ({battery_voltage:1} V)'}, {en: 'Fully charged'}],
  },
  // ros on the mower started or ended (also a restart or an update), not the mower switched on or off
  BOOTED: one('Mower software started'),
  SHUTDOWN: one('Mower software stopped'),
  // from here on MowBite OS only
  MOWING_REFUSED: one('Mowing not started', 'warning'),
  DRIVE_REFUSED: one('Drive not started', 'warning'),
  // a command the mower turned down without an event of its own, only in the answer to its call
  COMMAND_REFUSED: one('Not done'),
  // a request over MQTT 5 it couldn't answer (its response topic or correlation data), only in the answer
  REQUEST_REFUSED: one('Request refused', 'error'),
  CALIBRATION_REFUSED: one('Calibration not started', 'warning'),
  CALIBRATION: {
    severity: 'info',
    variants: [...Object.entries(CALIBRATION_PHASES).map(([phase, en]) => alone({when: {phase}, en})), alone({en: 'Calibration drive'})],
  },
  CALIBRATED: {
    severity: 'info',
    variants: [
      {when: {status: 'done'}, en: 'Calibration done'},
      {when: {status: 'not_evaluated'}, en: 'Calibration drive done, not evaluated', severity: 'warning'},
      {en: 'Calibration drive done, the evaluation failed', severity: 'warning'},
    ],
  },
  CALIBRATION_FAILED: {
    severity: 'error',
    variants: [alone({when: {reason: 'STOPPED'}, en: 'Calibration stopped', severity: 'info'}), {en: 'Calibration failed'}],
  },
  // the RTK corrections from the NTRIP caster: gone, back, turned down or from another source than before
  CORRECTIONS: {
    severity: 'warning',
    variants: [
      {when: {reason: 'RESTORED'}, en: 'RTK corrections', severity: 'info'},
      {when: {reason: 'REJECTED'}, en: 'RTK corrections', severity: 'error'},
      {en: 'RTK corrections'},
    ],
  },
  // reset_emergency didn't let go, the emergency stop stays. one that does sends nothing of its own, the EMERGENCY with
  // emergency false says it's over
  EMERGENCY_RESET_REFUSED: {
    severity: 'error',
    variants: [{when: {reason: 'STILL_TILTED'}, en: 'Emergency stop not reset', severity: 'warning'}, {en: 'Emergency stop not reset'}],
  },
  // MowBite OS started again without its own stop; hold: it waits for reset_emergency, otherwise it goes on by itself
  UNEXPECTED_RESTART: {
    severity: 'error',
    variants: [{when: {hold: false}, en: 'Restarted unexpectedly', severity: 'warning'}, {en: 'Held after an unexpected restart'}],
  },
  DRIVE: {
    severity: 'warning',
    variants: [
      alone({unless: {phase: 'end'}, en: 'Driving to a point', severity: 'info'}),
      alone({when: {reason: 'ALREADY_THERE'}, en: 'Already there', severity: 'info'}),
      alone({when: {arrived: true}, en: 'Arrived', severity: 'info'}),
      alone({when: {reason: 'DONE'}, en: 'Arrived', severity: 'info'}),
      {when: {reason: 'CANCELED'}, en: 'Drive ended', severity: 'info'},
      {when: {reason: 'STOPPED'}, en: 'Drive ended', severity: 'info'},
      {en: 'Drive ended'},
    ],
  },
  POSITION_JUMP: {severity: 'warning', variants: [{when: {distance: {present: true}}, en: 'Position jumped {distance:2} m'}, {en: 'Position jumped'}]},
  // only when it can't go home (no docking station, no contacts at the back), else it's a DOCKING
  BATTERY_LOW: {
    severity: 'warning',
    variants: [
      alone({when: {battery_voltage: {present: true}}, en: "Battery low ({battery_voltage:1} V), it can't go home and stays where it is"}),
      alone({en: "Battery low, it can't go home and stays where it is"}),
    ],
  },
  // charging stopped while it stood in the dock, it stays there
  CHARGING_LOST: {
    severity: 'warning',
    variants: [{when: {battery_percentage: {present: true}}, en: 'Not charging ({battery_percentage} %)'}, {en: 'Not charging'}],
  },
  MAP_DATUM: one('No mowing', 'error'),
  RECORDING_REFUSED: {
    severity: 'warning',
    variants: [...Object.entries(REFUSED_STEPS).map(([action, en]) => ({when: {action}, en})), {en: 'Recording step refused'}],
  },
  AREA_RECORDED: {
    severity: 'info',
    reader_logic: true,
    variants: [{when: {area_type: 'nav'}, en: 'Navigation area recorded'}, {en: 'Mowing area recorded'}],
  },
  DOCK_RECORDED: one('Docking station recorded'),
  // after robot.geometry.set, the sizes it's about the app names itself (changed, below_default)
  GEOMETRY_CHANGED: {severity: 'info', variants: [{when: {reason: 'BELOW_DEFAULT'}, en: 'Sizes changed', severity: 'warning'}, {en: 'Sizes changed'}]},
  // the planner has the leftovers of a finished mow ready, whether they're mowed the schedule decides (leftovers_skip)
  LEFTOVERS_ARMED: {
    severity: 'info',
    variants: [{when: {area_m2: {present: true}}, en: 'Leftovers ready to mow ({area_m2:0} m²)'}, {en: 'Leftovers ready to mow'}],
  },
};

const r = (en: string, extra: Omit<Variant, 'en'> = {}): Variant => ({en, ...extra});

// MowBite OS's fixed names (mowbite_logic/src/reasons.cpp) and OpenMower's own (lower case, for undocking and docking)
export const REASONS: Record<string, Variant[]> = {
  path_failed: [r("couldn't follow the path")],
  approach_failed: [r('approach failed')],
  dock_failed: [r('no contact with the charger')],
  no_gps: [r('no GPS fix')],
  BUSY: [
    r('busy: Idle', {when: {state: 'IDLE'}}),
    r('busy: Mowing', {when: {state: 'MOWING'}}),
    r('busy: Recording an area', {when: {state: 'AREA_RECORDING'}}),
    r('busy: driving', {when: {state: 'driving'}}),
    r('busy: {state}', {when: {state: {present: true}}}),
    r('busy with something else'),
  ],
  STILL_STOPPING: [r('the last job is still stopping, try again in a moment')],
  // COMMAND_REFUSED: the command doesn't fit the state (its action wouldn't be offered), no job to drop, the mower
  // already on another area or path than the one seen when it was tapped
  WRONG_STATE: [r("doesn't fit what the mower is doing now")],
  NO_JOB: [r('there is no interrupted job')],
  CHANGED: [
    r('the mower was already on the next part, nothing was skipped', {when: {path: {present: true}}}),
    r('the mower was already on the next area, nothing was skipped'),
  ],
  STILL_SAVING: [r('the last change of the map is still being saved')],
  // the MowBite Updater updates MowBite OS (system.hold), a start or a change of its data waits: in a *_REFUSED and in
  // the data of an error -32004, with until (unix s)
  HOLD: [r('update running until {until_clock}', {when: {until_clock: {present: true}}}), r('update running')],
  EMERGENCY: [r('emergency stop, reset it first')],
  NO_SAFETY_MEASUREMENT: [r('safety not yet verified on this platform, mowing and driving are blocked')],
  ON_DOCK: [r('on the docking station, drive it off by remote control first')],
  RAIN: [r('rain')],
  DARK: [r('the sun has set')],
  BATTERY_LOW: [
    r('battery low ({battery_voltage:1} V)', {when: {type: 'DOCKING', battery_voltage: {present: true}}}),
    r('battery low ({battery_voltage:1} V, at least {limit:1} V needed)', {when: {battery_voltage: {present: true}, limit: {present: true}}}),
    r('battery low ({battery_voltage:1} V)', {when: {battery_voltage: {present: true}}}),
    r('battery low'),
  ],
  BATTERY_CRITICAL: [
    r('battery critically low ({battery_voltage:1} V)', {when: {battery_voltage: {present: true}}}),
    r('battery critically low'),
  ],
  BATTERY_HOT: [
    r('battery too hot ({temperature:0} °C, the limit is {limit:0} °C)', {when: {temperature: {present: true}, limit: {present: true}}}),
    r('battery too hot ({temperature:0} °C)', {when: {temperature: {present: true}}}),
    r('battery too hot'),
  ],
  // a start turned down: limit is motor_cold_temperature there
  MOTOR_HOT: [
    r('mow motor still too hot ({temperature:0} °C, it has to cool down to {limit:0} °C)', {
      when: {type: 'MOWING_REFUSED', temperature: {present: true}, limit: {present: true}},
    }),
    r('mow motor too hot ({temperature:0} °C, the limit is {limit:0} °C)', {when: {temperature: {present: true}, limit: {present: true}}}),
    r('mow motor too hot ({temperature:0} °C)', {when: {temperature: {present: true}}}),
    r('mow motor too hot'),
  ],
  // in the dock: the contacts left for 10 s without a drive of its own, or no current coming. current and limit in A
  NO_CHARGE_CURRENT: [
    r('in the dock, but no charge current ({current:2} A, at least {limit:2} A expected)', {
      when: {type: 'CHARGING_LOST', current: {present: true}, limit: {present: true}},
    }),
    r('in the dock, but no charge current', {when: {type: 'CHARGING_LOST'}}),
    r('on the contacts but not charging'),
  ],
  NO_DOCK: [r('no docking station on the map')],
  DOCK_UNREACHABLE: [r('the docking station is outside the areas it may drive in')],
  REFERENCE_MISMATCH: [
    r('the docking station is {distance:2} m from where the map has it, at most {limit:2} m allowed', {
      when: {distance: {present: true}, limit: {present: true}},
    }),
    r('the docking station is not where the map has it'),
  ],
  NO_DOCK_CONTACT: [r('off the charging contacts', {when: {type: 'CHARGING_LOST'}}), r('no contact with the docking station')],
  NO_POSITION: [r('no position')],
  POSE_LOST: [r('position lost')],
  POSITION_ACCURACY: [
    r('no position', {when: {no_fix: true}}),
    r('position accurate to {accuracy:2} m, points need {limit:2} m or better', {when: {action: 'point'}}),
    r('position accurate to {accuracy:2} m, points need {limit:2} m or better', {when: {action: 'collect_point'}}),
    r('position accurate to {accuracy:2} m, the docking station needs {limit:2} m or better', {when: {action: 'record_dock'}}),
    r('position not accurate enough', {unless: {accuracy: {present: true}}}),
    r('position accurate to {accuracy:2} m, {limit:2} m or better needed', {when: {limit: {present: true}}}),
    r('position accurate to {accuracy:2} m'),
  ],
  NO_HEADING: [r('heading not known yet')],
  HEADING: [r('heading not good enough')],
  MAP_MISMATCH: [
    r('the map has no reference point recorded', {when: {datum_state: 'unbound'}}),
    r("the map doesn't fit the reference point in use"),
  ],
  MAP_UNREADABLE: [r("the map can't be read")],
  MAP_UNKNOWN: [r("the GPS reference point isn't known yet")],
  NO_MOWING_AREA: [r('no active mowing area on the map')],
  PLANNER_MISSING: [r('the planner is not running')],
  FOLLOWER_MISSING: [r('the path follower is not running')],
  MANUAL: [r('by hand')],
  CROSS_TRACK: [r('too far off its path')],
  OUTSIDE: [r('outside the area it may drive in')],
  TIMEOUT: [r('took too long', {when: {type: 'CALIBRATION_FAILED'}}), r('not making progress, maybe stuck')],
  INVALID: [r('the path is not valid')],
  NOT_ALLOWED: [r('driving not allowed')],
  PLANNING_FAILED: [r("the planner couldn't make the plan")],
  APPROACH_FAILED: [r("couldn't get to the start of the lane")],
  BLADE_REFUSED: [r("the blade didn't switch on")],
  BLADE_SPINUP_FAILED: [r("the blade didn't reach its speed")],
  DONE: [r('arrived')],
  CANCELED: [r('canceled')],
  STOPPED: [r('stopped')],
  TRANSIT_FAILED: [r('no way there could be planned')],
  FOLLOWER_REFUSED: [r("the path follower didn't take the path")],
  ALREADY_THERE: [r('already there')],
  PLANNER_TIMEOUT: [r('no answer from the planner')],
  RING_FEW_POINTS: [r('a line needs at least {limit} points, it has {points}')],
  RING_CROSSES_ITSELF: [r('the line crosses itself')],
  RING_TOO_SMALL: [r('it encloses only {area:2} m², at least {limit:2} m² needed')],
  NO_OUTLINE: [r('no outline recorded yet')],
  TOO_MANY_POINTS: [r('the line has {limit} points, the maximum: close it')],
  POINT_TOO_CLOSE: [r('only {distance:2} m from the last point, more than {limit:2} m needed')],
  DOCK_TOO_CLOSE: [r('only {distance:2} m from the first point, the direction needs at least {limit:2} m')],
  // one with a code not known here says the mower's text (fallback)
  SAVE_FAILED: [
    r('saving failed: the change is not a valid map', {when: {code: 'INVALID'}}),
    r("saving failed: the map doesn't fit the reference point in use", {when: {code: 'DATUM'}}),
    r('saving failed: the map got too large', {when: {code: 'TOO_LARGE'}}),
    r("saving failed: the map couldn't be written", {when: {code: 'STORAGE'}}),
    r('saving failed: no answer from the map service', {when: {code: 'NO_ANSWER'}}),
    r('saving failed', {unless: {message: {present: true}}}),
  ],
  BELOW_DEFAULT: [r("smaller than from the factory, the planner's body check works with the smaller outline")],
  OUTLIERS: [r('back on GPS after outliers')],
  GAP: [r('back on GPS after a gap')],
  // why reset_emergency didn't let go (EMERGENCY_RESET_REFUSED): angle and limit in degrees, seconds since the IMU's last
  // data, when the driver knows them
  STILL_TILTED: [
    r('still tilted ({angle:0}°, less than {limit:0}° needed)', {when: {angle: {present: true}, limit: {present: true}}}),
    r('still tilted'),
  ],
  TILT_UNKNOWN: [
    r('tilt unknown, no data from the IMU for {seconds:1} s', {when: {seconds: {present: true}}}),
    r('tilt unknown, no data from the IMU'),
  ],
  FOREIGN_HOST: [r('another computer is talking to the board')],
  DRIVER_MISSING: [r('the hardware driver is not running')],
  SAFETY_MISSING: [r('the safety filter is not running')],
  NO_ANSWER: [r('no answer in time')],
  RESTART_HOLD_STAYS: [r("the hold after the unexpected restart couldn't be removed")],
  // UNEXPECTED_RESTART: what ended MowBite OS before
  KERNEL_CRASH: [r('the kernel crashed')],
  OS_CRASH: [r('MowBite OS crashed')],
  POWER_LOSS: [r('interrupted while working', {when: {hold: true}}), r('power cut or reset')],
  // the calibration drive (CALIBRATION_REFUSED, CALIBRATION_FAILED): rate and limit in reports a second
  NO_RTK: [r('no RTK fix')],
  NO_ROOM: [
    r('not enough room here, the drive needs {length:1} m and has {free_length:1} m', {
      when: {length: {present: true}, free_length: {present: true}},
    }),
    r('not enough room here for the calibration drive'),
  ],
  SLOPE: [
    r('the ground is too steep ({slope:0}°, at most {limit:0}°)', {when: {slope: {present: true}, limit: {present: true}}}),
    r('the ground is too steep'),
  ],
  GNSS_RATE: [
    r('the GPS reports {rate:1} times a second, {limit:1} needed', {when: {rate: {present: true}, limit: {present: true}}}),
    r('the GPS reports too seldom'),
  ],
  SENSOR_MISSING: [
    r('a sensor it needs reports {rate:1} times a second, {limit:1} needed', {when: {rate: {present: true}, limit: {present: true}}}),
    r("a sensor it needs doesn't report"),
  ],
  CALIBRATION_MISSING: [
    r('no sign from the calibration program for {seconds:0} s', {when: {seconds: {present: true}}}),
    r('the calibration program is not running'),
  ],
  IMU_GRAVITY: [
    r("the IMU measures {gravity:1} m/s² of gravity, that's not right", {when: {gravity: {present: true}}}),
    r("the IMU doesn't measure gravity as it should"),
  ],
  GYRO_SIGN: [r('the gyro measures turning the other way than the wheels')],
  NOT_MOVING: [r("doesn't move")],
  NOT_TURNING: [r("doesn't turn")],
  OVERSPEED: [r('drove faster than it should')],
  LEFT_LANE: [r('left its lane')],
  // CORRECTIONS: limit in s, code the caster's HTTP status
  LOST: [r('none from the NTRIP caster for {limit:0} s', {when: {limit: {present: true}}}), r('none from the NTRIP caster')],
  RESTORED: [r('coming again')],
  REJECTED: [
    r('the NTRIP caster turned the login down (HTTP {code})', {when: {code: {present: true}}}),
    r('the NTRIP caster turned the login down'),
  ],
  SOURCE_CHANGED: [r('from another caster or mountpoint than before')],
  // REQUEST_REFUSED: limit in bytes
  CORRELATION_DATA: [
    r('its correlation data is longer than {limit} bytes', {when: {limit: {present: true}}}),
    r('its correlation data is too long'),
  ],
  RESPONSE_TOPIC: [r('its response topic is not rpc/response/ and a token')],
};

// put round the finished reason, by the start of its name (the longest that fits, at most one)
export const WRAPPERS: Record<string, {unless?: Cond; when?: Cond; en: string}> = {
};

// the emergency stop's reasons, one bit each of 32 (EmergencyReason in open_mower_ros services/emergency_service.json),
// MowBite OS's own from bit 13 on (HardwareStatus.msg). one gets its name here once a node sets it, a bit without one is
// said as "bit N" next to the others, never left out (fallback.emergency_bit)
export const EMERGENCY_BITS: (string | null)[] = [
  'LATCH',
  'TIMEOUT_INPUTS',
  'STOP',
  'LIFT',
  'LIFT_MULTIPLE',
  'COLLISION',
  'TIMEOUT_HIGH_LEVEL',
  'HIGH_LEVEL',
  'SERVICE_NOT_READY',
  'COLLISION_MULTIPLE',
  'MOWER_RPM_TIMEOUT',
  'MOWER_RPM_LIMIT',
  'FIRMWARE_INCOMPATIBLE',
  'TILT',
  'FENCE',
  'STUCK',
  'IMU_TIMEOUT',
  'MOWER_NOT_STOPPED',
  'WHEEL_RUNAWAY',
  'FOREIGN_HOST',
  'DRIVER_STALL',
  'UNEXPECTED_RESTART',
];

// what the firmware means by them (fw-openmower-v2): a single lift sensor or bumper, or two and more at once. one not
// here comes readable
export const EMERGENCY_TEXT: Record<string, string> = {
  STOP: 'stop button',
  LIFT: 'lifted',
  LIFT_MULTIPLE: 'lifted (several sensors)',
  COLLISION: 'bumper',
  COLLISION_MULTIPLE: 'bumper (several at once)',
  TIMEOUT_INPUTS: 'sensors not answering',
  TIMEOUT_HIGH_LEVEL: "no contact with the mower's software",
  HIGH_LEVEL: "stopped by the mower's software",
  SERVICE_NOT_READY: 'firmware still starting',
  MOWER_RPM_TIMEOUT: "mow motor didn't reach its speed",
  MOWER_RPM_LIMIT: 'mow motor outside its speed limits',
  FIRMWARE_INCOMPATIBLE: "firmware doesn't fit the mower's software",
  // MowBite OS's own bits. UNKNOWN is what its log line says for a bit it has no name for
  TILT: 'tilted too far',
  FENCE: 'outside the area it may drive in',
  STUCK: "wheels turning, but it doesn't move",
  IMU_TIMEOUT: 'no data from the IMU',
  MOWER_NOT_STOPPED: "blade didn't stop",
  WHEEL_RUNAWAY: 'wheel turning against the command',
  FOREIGN_HOST: 'another computer is talking to the board',
  DRIVER_STALL: 'hardware driver hung',
  UNEXPECTED_RESTART: 'unexpected restart',
  UNKNOWN: 'unknown reason',
};
// LATCH only holds it until it's reset, and of two that say the same the more telling one
export const EMERGENCY_HIDE = ['LATCH'];
export const EMERGENCY_HIDE_WITH: Record<string, string> = {LIFT: 'LIFT_MULTIPLE', COLLISION: 'COLLISION_MULTIPLE', HIGH_LEVEL: 'MOWER_RPM_TIMEOUT'};

export const FALLBACK = {
  // a name not in the list: the mower's english text, else the name itself readable (lower case, spaces)
  unknown: 'message',
  else: 'name_readable',
  join: '{head}: {reason}',
  emergency_code: 'Emergency stop (code {n})',
  // a bit set without a name in emergency_bits, said with the others: "bumper, bit 21"
  emergency_bit: 'bit {n}',
} as const;

// an event, read field by field
type Fields = object;
const at = (e: Fields, k: string) => (e as Record<string, unknown>)[k];
const present = (v: unknown) => v !== undefined && v !== null && v !== '';
function holds(c: Cond, e: Fields): boolean {
  return Object.entries(c).every(([k, want]) =>
    typeof want === 'object' && want !== null ? present(at(e, k)) === want.present : at(e, k) === want,
  );
}
export const fits = (v: {when?: Cond; unless?: Cond}, e: Fields) => (!v.when || holds(v.when, e)) && (!v.unless || !holds(v.unless, e));
export const pick = <T extends {when?: Cond; unless?: Cond}>(list: readonly T[] | undefined, e: Fields): T | undefined =>
  list?.find((v) => fits(v, e));

// the fields put in: {field} as it is, {field:n} with n decimals the way the language writes them, ? when it's missing
export function fill(text: string, e: Fields): string {
  return text.replace(/\{(\w+)(?::(\d))?\}/g, (_, k: string, n?: string) => {
    const v = at(e, k);
    if (n !== undefined) return typeof v === 'number' && Number.isFinite(v) ? fmt(v, Number(n)) : '?';
    return v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v)) ? '?' : String(v);
  });
}

// src/lib/reasons.json: the same as data for MowBite for Home Assistant, german where de.ts has it
export function reasonsFile() {
  const both = <T extends {en: string}>(v: T) => (de[v.en] ? {...v, de: de[v.en]} : v);
  const texts = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, en]) => [k, both({en})]));
  return {
    schema: SCHEMA,
    // who makes this file and from what
    owner: 'mowbite-app',
    source: 'src/lib/reasonTexts.ts',
    langs: ['en', 'de'],
    events: Object.fromEntries(
      Object.entries(EVENTS).map(([k, t]) => [k, {...t, ...(t.join ? {join: both({en: t.join})} : {}), variants: t.variants.map(both)}]),
    ),
    reasons: Object.fromEntries(Object.entries(REASONS).map(([k, list]) => [k, list.map(both)])),
    wrappers: Object.fromEntries(Object.entries(WRAPPERS).map(([k, w]) => [k, both(w)])),
    emergency_bits: Object.fromEntries(EMERGENCY_BITS.flatMap((b, i) => (b ? [[String(i), b]] : []))),
    emergency_text: texts(EMERGENCY_TEXT),
    emergency_hide: EMERGENCY_HIDE,
    emergency_hide_with: EMERGENCY_HIDE_WITH,
    fallback: {
      unknown: FALLBACK.unknown,
      else: FALLBACK.else,
      join: both({en: FALLBACK.join}),
      emergency_code: both({en: FALLBACK.emergency_code}),
      emergency_bit: both({en: FALLBACK.emergency_bit}),
    },
  };
}
