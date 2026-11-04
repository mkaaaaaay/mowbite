import {clock} from './dates';
import {fmt, tr} from './i18n';
import {LOGIC_SOURCE} from './openmower';
import {
  EMERGENCY_BITS,
  EMERGENCY_HIDE,
  EMERGENCY_HIDE_WITH,
  EMERGENCY_TEXT,
  EVENTS,
  FALLBACK,
  REASONS,
  WRAPPERS,
  fill,
  fits,
  pick,
  type Severity,
} from './reasonTexts';

// events from the mower's event history (events.history rpc), grouped into runs for the activity page

export interface MowerEvent {
  id: string;
  type: string;
  t: number; // unix seconds
  job_id?: string;
  session_id?: string;
  x?: number;
  y?: number;
  state?: string;
  available?: boolean;
  enabled?: boolean;
  area_id?: string;
  area_name?: string;
  reason?: string;
  attempts?: number;
  emergency?: boolean;
  battery_voltage?: number;
  // recording an area, MowBite OS only (OpenMower doesn't send these): the step refused, what was saved
  action?: string;
  area_type?: string;
  obstacles?: number;
  points?: number;
  area_m2?: number;
  dock_id?: string;
  heading?: number;
  // MowBite OS: a reason with a fixed name carries an english text, how bad it is and whether it goes on by itself
  // (masterplan 3.1a), and the numbers it's about. limit is in the unit of the value it goes with
  message?: string;
  severity?: string;
  resume?: string;
  limit?: number;
  accuracy?: number | null;
  distance?: number;
  area?: number;
  code?: string;
  datum_state?: string;
  phase?: string;
  arrived?: boolean;
  // GEOMETRY_CHANGED: the sizes set, those set smaller than from the factory
  changed?: string[];
  below_default?: string[];
  // HOLD: until when the MowBite Updater holds it (unix s)
  until?: number;
  // EMERGENCY_RESET_REFUSED: the tilt and the limit for letting go in degrees, how old the IMU's last data is
  angle?: number;
  seconds?: number;
  // worked out here, not from OpenMower: a navigation error that only came because it was sent home (see markSentHome)
  sentHome?: boolean;
}

export type {Severity};

const readable = (r: string) => r.replace(/_/g, ' ').toLowerCase();

// why it heads home, from the reason mower_logic gives (mower_logic.cpp): "Manual pause", "Battery voltage critical:
// 23.1 V", "Battery average voltage low: 24.2 V", "Mow motor over temp: 71 °C", "Rain detected"
export type HomeReason = 'paused' | 'battery' | 'hot' | 'rain';
export function homeReason(r?: string): HomeReason | null {
  if (!r) return null;
  if (r === 'Manual pause') return 'paused';
  if (r.startsWith('Battery')) return 'battery';
  if (r.startsWith('Mow motor over temp')) return 'hot';
  if (r.startsWith('Rain')) return 'rain';
  return null;
}
const number = (r: string) => r.match(/-?\d+(\.\d+)?/)?.[0];
function homeText(r?: string): string {
  const n = r ? number(r) : undefined;
  switch (homeReason(r)) {
    // "Manual pause" is what OpenMower says to home while mowing, from the app or the schedule's stop alike
    case 'paused':
      return tr('Sent home');
    case 'battery':
      return n ? tr('Heading home to charge: battery low ({v} V)', {v: fmt(Number(n), 1)}) : tr('Heading home to charge: battery low');
    case 'hot':
      return n ? tr('Heading home: mow motor too hot ({t} °C)', {t: Math.round(Number(n))}) : tr('Heading home: mow motor too hot');
    case 'rain':
      return tr('Heading home: rain');
    default:
      return r ? tr('Heading home: {reason}', {reason: readable(r)}) : tr('Heading home');
  }
}

// worth showing in a run's summary and the day's list though it isn't a problem: why it went home (not a pause)
export function noteworthy(e: MowerEvent, state?: string, os = false): boolean {
  if (describe(e, state, os).severity !== 'info') return true;
  const why = e.type === 'DOCKING' ? homeReason(e.reason) : null;
  return why !== null && why !== 'paused';
}

// the reasons in an EMERGENCY event, mower_logic sends them as the number of bits (32 on MowBite OS). a bit without a
// name comes as BIT_<n>, none is left out
export function emergencyFlags(code: unknown): string[] {
  const n = Number(code);
  if (!Number.isInteger(n) || n <= 0) return [];
  const flags: string[] = [];
  for (let i = 0; 2 ** i <= n; i++) if (Math.floor(n / 2 ** i) % 2) flags.push(EMERGENCY_BITS[i] ?? `BIT_${i}`);
  return flags;
}
const BIT = /^BIT_(\d+)$/;

// the reasons in words, the more telling one where two say the same (reasonTexts.ts), a bit without a name as "bit N"
export function emergencyText(flags: readonly string[]): string {
  const has = new Set(flags);
  return flags
    .filter((f) => !EMERGENCY_HIDE.includes(f) && !(EMERGENCY_HIDE_WITH[f] && has.has(EMERGENCY_HIDE_WITH[f])))
    .map((f) => {
      const bit = f.match(BIT);
      if (bit) return fill(tr(FALLBACK.emergency_bit), {n: Number(bit[1])});
      return EMERGENCY_TEXT[f] ? tr(EMERGENCY_TEXT[f]) : readable(f);
    })
    .join(', ');
}

// the reasons MowBite OS gave as text before E6 (area_recorder.cpp, logic_core.cpp), their numbers are metres with two
// decimals
const REFUSALS: [RegExp, string, string[]][] = [
  [/^a ring needs at least (\d+) points, it has (\d+)$/, 'a line needs at least {min} points, it has {n}', ['min', 'n']],
  [/^the line crosses itself$/, 'the line crosses itself', []],
  [/^it encloses only ([\d.]+) m², at least ([\d.]+) needed$/, 'it encloses only {a} m², at least {min} m² needed', ['a', 'min']],
  [/^Position accuracy ([\d.]+|nan) m, points need ([\d.]+) m or better$/i, 'position accurate to {acc} m, points need {max} m or better', ['acc', 'max']],
  [
    /^Position accuracy ([\d.]+|nan) m, the docking station needs ([\d.]+) m or better$/i,
    'position accurate to {acc} m, the docking station needs {max} m or better',
    ['acc', 'max'],
  ],
  [/^Only ([\d.]+) m from the first point, at least ([\d.]+) m needed for the heading$/, 'only {d} m from the first point, the direction needs at least {min} m', ['d', 'min']],
  [/^Only ([\d.]+) m from the last point, more than ([\d.]+) m needed$/, 'only {d} m from the last point, more than {min} m needed', ['d', 'min']],
  [/^The recording has reached (\d+) points, close the ring$/, 'the line has {n} points, the most there can be: close it', ['n']],
  [/^The last change of the map is still being saved$/, 'the last change of the map is still being saved', []],
  [/^No position$/, 'no position', []],
  [/^No outline recorded$/, 'no outline recorded yet', []],
  [/^The map does not fit the datum in use$/, "the map doesn't fit the reference point in use", []],
];
const RING = 'Cannot close the ring: ';

// the reason as a fixed name, MowBite OS from E6 on (masterplan 3.1a). OpenMower's own are lower case or free text
export const isReasonCode = (r?: string): boolean => !!r && /^[A-Z][A-Z0-9_]*$/.test(r);

// a reason in words (reasonTexts.ts): one in the list with the event's numbers, a fixed name it doesn't know by the
// mower's english text, else the name itself readable. free text (OpenMower, MowBite OS before E6) stays as it came
export function reasonText(e: MowerEvent): string {
  const r = e.reason;
  if (!r) return '';
  // (the fields a reader puts in itself, reasonTexts.ts)
  const f = typeof e.until === 'number' && e.until > 0 ? {...e, until_clock: clock(e.until)} : e;
  const v = pick(REASONS[r], f);
  let text: string;
  if (v) text = fill(tr(v.en), f);
  else if (isReasonCode(r)) text = e.message || readable(r);
  else if (/^[a-z][a-z0-9_]*$/.test(r)) text = readable(r);
  else return r;
  const wrap = Object.keys(WRAPPERS)
    .filter((k) => r.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return wrap && fits(WRAPPERS[wrap], e) ? fill(tr(WRAPPERS[wrap].en), {text}) : text;
}

// the reason in words of the app's language, one it doesn't know as it came
export function refusalReason(r?: string, action?: string, e?: MowerEvent): string {
  if (!r) return '';
  if (isReasonCode(r)) return reasonText({...(e ?? {id: '', t: 0, type: 'RECORDING_REFUSED'}), reason: r, action});
  const rest = r.startsWith(RING) ? r.slice(RING.length) : r;
  let text = rest;
  for (const [re, key, names] of REFUSALS) {
    const m = rest.match(re);
    if (!m) continue;
    const vars: Record<string, string> = {};
    names.forEach((name, i) => {
      const v = m[i + 1];
      vars[name] = /^nan$/i.test(v) ? '?' : v.includes('.') ? fmt(Number(v), 2) : v;
    });
    text = tr(key, vars);
    break;
  }
  return text;
}

export const refusalText = (e: MowerEvent): string => worded(e)?.text ?? '';

// an area or the docking station saved from recording mode (AREA_RECORDED, DOCK_RECORDED, MowBite OS only)
function recordedText(e: MowerEvent): string {
  const what = worded(e)?.text ?? '';
  const parts: string[] = [];
  if (typeof e.area_m2 === 'number') parts.push(`${fmt(e.area_m2, e.area_m2 < 10 ? 1 : 0)} m²`);
  if (e.obstacles === 1) parts.push(tr('1 obstacle'));
  else if (typeof e.obstacles === 'number' && e.obstacles > 1) parts.push(tr('{n} obstacles', {n: e.obstacles}));
  return parts.length ? `${what} (${parts.join(', ')})` : what;
}

const SEVERITIES = new Set<string>(['error', 'warning', 'info']);

// the event's words from its list in reasonTexts.ts: the head of the first variant that fits, the reason after it
function worded(e: MowerEvent): {text: string; severity: Severity} | null {
  const ev = EVENTS[e.type];
  const v = pick(ev?.variants, e);
  if (!ev || !v) return null;
  const head = fill(tr(v.en), e);
  let why = '';
  if (v.with_reason !== false && e.reason !== undefined && e.reason !== '') {
    if (v.reason_is === 'emergency_bits') {
      why = emergencyText(emergencyFlags(e.reason));
      const code = Number(e.reason);
      if (!why && code > 0) return {text: fill(tr(FALLBACK.emergency_code), {n: code}), severity: v.severity ?? ev.severity};
    } else why = e.type === 'RECORDING_REFUSED' ? refusalReason(e.reason, e.action, e) : reasonText(e);
  }
  return {text: why ? fill(tr(ev.join ?? FALLBACK.join), {head, reason: why}) : head, severity: v.severity ?? ev.severity};
}

// state is what the mower was doing when the event happened, gps is switched off on purpose outside
// of mowing, so losing it only counts as a problem while mowing. os: the mower runs MowBite OS, how bad it is comes
// with the event there, from OpenMower (and MowBite OS before E6) it's worked out here
export function describe(e: MowerEvent, state?: string, os = false): {text: string; severity: Severity} {
  const own = describeOwn(e, state);
  return os && SEVERITIES.has(e.severity ?? '') ? {text: own.text, severity: e.severity as Severity} : own;
}

function describeOwn(e: MowerEvent, state?: string): {text: string; severity: Severity} {
  switch (e.type) {
    case 'GPS':
      if (e.available) return {text: tr('GPS fix'), severity: 'info'};
      return state === 'MOWING' ? {text: tr('GPS lost'), severity: 'warning'} : {text: tr('GPS off'), severity: 'info'};
    case 'DOCKING':
      return {text: homeText(e.reason), severity: 'info'};
    case 'AREA_RECORDED':
      return {text: recordedText(e), severity: 'info'};
  }
  const said = worded(e);
  if (said) return said;
  const what = readable(e.type);
  const why = reasonText(e);
  return {text: why ? fill(FALLBACK.join, {head: what, reason: why}) : what, severity: 'info'};
}

// the sizes as the sizes card calls them
const SIZE_NAMES: Record<string, string> = {
  robot_width: 'Width',
  robot_front: 'Rear axle to the front',
  robot_rear: 'Rear axle to the back',
  robot_outline: 'Outline of the body',
};

const spinupFailed = () =>
  tr(
    "The mow motor didn't reach its speed in time (mower_logic/mower_spinup_timeout), so the mower stopped with an emergency. Often grass is wound round the blade or the blade is blocked, or the motor or its controller is faulty.",
  );

// what MowBite OS's own reasons are about and what to do, a sentence or two each
const EMERGENCY_HELP: Record<string, string> = {
  TILT: 'It stood tilted further than allowed, on a slope or lifted on one side, so the wheels and the blade went off. Stand it level: a reset only goes through below its release angle.',
  FENCE:
    "A drive of its own took it too far out of the area it may drive in, or into an obstacle, and the path follower hadn't stopped it. Check the map and the GPS at that spot. The reset always goes through.",
  IMU_TIMEOUT: "The IMU's data stopped coming, without it the tilt can't be watched. Once can be a hiccup, if it happens again check the IMU and its connection.",
  MOWER_NOT_STOPPED: 'The blade was switched off but kept turning faster than allowed. Let it run down, then check that the mow motor stops when told to.',
  WHEEL_RUNAWAY:
    "A wheel turned against the drive command: on after a stop, faster than told or the wrong way. Usual causes: pushed, rolling down a slope, or a wheel's motor controller playing up. Which wheel and how fast is in the log from that moment.",
  FOREIGN_HOST:
    "Another computer or program is talking to the mower's board, OpenMower still running next to MowBite OS say. Stop it: a reset only goes through once MowBite OS alone talks to the board.",
  DRIVER_STALL: 'The hardware driver hung for too long, so it stopped to be safe. Once can be a load peak, if it happens again the log from that moment says more.',
};

// a refused reset where it's reset, under the emergency stop and its reasons
export function resetRefusedText(e: MowerEvent): string {
  const why = reasonText(e);
  return why ? tr('Not reset: {reason}', {reason: why}) : tr('Not reset');
}

// what the mower's code does when it logs these, the event itself carries nothing more
// gpsTimeout: the mower's mower_logic/gps_timeout in seconds, if known
export function explain(e: MowerEvent, state?: string, gpsTimeout?: number, os = false): string | undefined {
  switch (e.type) {
    case 'STATE':
      // MowBite OS says whether it goes on by itself
      if (e.state !== 'PAUSED' || !e.reason || !os) return undefined;
      return e.resume === 'auto'
        ? tr('It goes on by itself once the position has been good for a moment.')
        : e.resume === 'user' && e.reason !== 'MANUAL'
          ? tr('It waits where it is until you continue it.')
          : undefined;
    case 'MOWING_REFUSED':
      return tr('The mower stays where it is. Once the reason is gone, start it again.');
    case 'GEOMETRY_CHANGED': {
      const small = (e.below_default ?? []).map((k) => tr(SIZE_NAMES[k] ?? readable(k)));
      return small.length ? tr('Set smaller than from the factory: {sizes}.', {sizes: small.join(', ')}) : undefined;
    }
    case 'UNDOCKING_FAILED':
      if (e.reason === 'no_gps')
        return tr(
          'It got out of the dock but had no RTK fix in time and stopped. Check the NTRIP corrections and whether the GPS antenna has a clear sky view there.',
        );
      return tr(
        "It couldn't drive the short way out of the dock (backwards, then turning) and gave up. Usual causes: the mower's idea of its heading is off while it stands in the dock, it's blocked (wheels, grass, bumper), or it's still in emergency mode.",
      );
    case 'DOCKING_RETRY':
    case 'DOCKING_FAILED':
      return e.reason === 'dock_failed'
        ? tr(
            "It was in front of the dock but didn't get charging contact, so it backed out to try again. Check the contacts and whether the dock position on the map is still right.",
          )
        : tr(
            "It couldn't reach the point in front of the dock. Usually the GPS fix was bad or the way there is blocked or outside the navigation area.",
          );
    case 'NAVIGATION_ERROR':
      return tr(
        "It couldn't follow the mowing path and the recovery didn't help, so it paused. Often something is in the way, or the path runs too close to an obstacle or the edge.",
      );
    case 'GPS':
      if (e.available || state !== 'MOWING') return undefined;
      return gpsTimeout !== undefined
        ? tr(
            'The RTK fix had been gone for about {n} s: xbot_positioning still takes a lost fix as good for 10 s, after that the mower keeps driving on wheel odometry for {timeout} s (mower_logic/gps_timeout). Then it stops with the blade off and waits until the fix is back.',
            {n: Math.round(gpsTimeout) + 10, timeout: Math.round(gpsTimeout)},
          )
        : tr(
            'The RTK fix had been gone for longer than the mower allows (mower_logic/gps_timeout), so it stopped with the blade off and waits until the fix is back.',
          );
    case 'EMERGENCY': {
      if (!e.emergency) return undefined;
      const flags = emergencyFlags(e.reason);
      const own = flags.filter((f) => EMERGENCY_HELP[f]);
      if (own.length) return own.map((f) => tr(EMERGENCY_HELP[f])).join(' ');
      if (flags.includes('MOWER_RPM_TIMEOUT')) return spinupFailed();
      // on MowBite OS only a latch from above or one the board still held, what the driver stops for has its own bits
      if (flags.includes('HIGH_LEVEL'))
        return os
          ? tr(
              'Something above the board latched it, a part of MowBite OS or a tool, or the board still held it from before. The log from that moment says why. It has to be reset before it drives again.',
            )
          : tr(
              'OpenMower stopped the mower itself, for example because the position, the wheel data or a motor controller stopped coming. The ROS log from that moment says why. It has to be reset before it drives again.',
            );
      if (flags.some((f) => BIT.test(f)))
        return tr("A reason MowBite doesn't know yet, a newer version may. The log from that moment says more. It has to be reset before it drives again.");
      return tr('Stop button, lift, tilt or a bumper. It has to be released and reset before it drives again.');
    }
    // the emergency stop stays as it was
    case 'EMERGENCY_RESET_REFUSED':
      if (e.reason === 'STILL_TILTED') return tr('Stand it level, then reset it again.');
      if (e.reason === 'TILT_UNKNOWN')
        return tr("Without fresh data from the IMU it can't tell whether it stands level. Try again in a moment, if it stays so check the IMU and its connection.");
      if (e.reason === 'FOREIGN_HOST')
        return tr('Stop the other computer or program first, OpenMower still running next to MowBite OS say, then reset it again.');
      return tr("A part of MowBite OS didn't answer. Try again in a moment, the log from that moment says more.");
    case 'MOW_MOTOR_SPINUP_FAILED':
      return spinupFailed();
    case 'RECORDING_REFUSED':
      return e.action === 'point'
        ? tr(
            'While the position is that inaccurate the mower records no points. Once it is good again the line goes on, straight from the last good point.',
          )
        : tr('The recording stays open, nothing recorded so far is lost. Once the reason is gone, try the step again.');
    case 'DOCKING':
      return homeReason(e.reason) === 'hot'
        ? tr("The mow motor reached mower_logic/motor_hot_temperature. Once it's down to motor_cold_temperature it mows on by itself in semi-automatic or automatic mode, otherwise it waits for a start.")
        : undefined;
  }
}

// where open_mower_ros writes the event and the line it logs at the same moment
export function eventSource(e: MowerEvent): {file: string; url: string; log?: string} | undefined {
  const src = (file: string, log?: string) => ({file, url: LOGIC_SOURCE + file, log});
  switch (e.type) {
    case 'UNDOCKING_FAILED':
      return src('behaviors/UndockingBehavior.cpp', e.reason === 'no_gps' ? 'Could not get GPS.' : 'Error during undock');
    case 'DOCKING_RETRY':
      return src('behaviors/DockingBehavior.cpp', e.reason === 'dock_failed' ? 'Error during docking.' : 'Error during docking approach.');
    case 'DOCKING_FAILED':
      return src('behaviors/DockingBehavior.cpp', 'Giving up on docking');
    case 'NAVIGATION_ERROR':
      return src('behaviors/MowingBehavior.cpp', 'MowingBehavior: (MOW) PAUSED due to MBF Error at …');
    case 'MOW_MOTOR_SPINUP_FAILED':
      return src('behaviors/MowingBehavior.cpp', 'Mower motor failed to reach … RPM within …s. Entering emergency.');
    case 'EMERGENCY':
    case 'GPS':
      return src('mower_logic.cpp');
  }
}

// one event as it comes live on events/json, null for anything that isn't one
export function parseEvent(payload: string): MowerEvent | null {
  try {
    const e = JSON.parse(payload);
    return e && typeof e === 'object' && typeof e.type === 'string' ? {...e, id: String(e.id ?? ''), t: Number(e.t) || Date.now() / 1000} : null;
  } catch {
    return null;
  }
}

// the line as it is in the file: id, t, type, the event's own fields, then position and ids
export function rawLine(e: MowerEvent): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- worked out here, not in the file
  const {id, t, type, x, y, job_id, session_id, sentHome, ...rest} = e;
  return JSON.stringify({id, t, type, ...rest, x, y, job_id, session_id});
}

export type Outcome =
  | 'done'
  | 'paused'
  | 'battery'
  | 'rain'
  | 'hot'
  | 'undock_failed'
  | 'dock_failed'
  | 'emergency'
  | 'interrupted'
  | 'manual'
  | 'returned'
  | 'stopped'
  | 'running';

export interface Run {
  start: number;
  end: number;
  events: MowerEvent[];
  areas: string[];
  bladeSeconds: number;
  problems: number;
  outcome: Outcome;
  jobId?: string;
}

export type Entry = {kind: 'run'; run: Run} | {kind: 'event'; event: MowerEvent};

// each event with the state the mower was in at that moment
export function withState(events: MowerEvent[]): {event: MowerEvent; state?: string}[] {
  let state: string | undefined;
  return events.map((event) => {
    const before = state;
    if (event.type === 'STATE') state = event.state;
    return {event, state: before};
  });
}

// A run starts when the mower leaves the dock and ends when it's docked again (or idle/off). Everything
// in between belongs to it, the rest (boot, shutdown, gps while parked) stays a loose event.
// sent home in the middle of a path, OpenMower also reports a navigation error (MowingBehavior.cpp checks for a pause
// there but not for an abort). it's the one the docking follows within a moment, a real one pauses the mower
const SENT_HOME_WITHIN = 2; // s
export function markSentHome(sorted: MowerEvent[]): MowerEvent[] {
  return sorted.map((e, i) => {
    if (e.type !== 'NAVIGATION_ERROR') return e;
    for (let j = i + 1; j < sorted.length && sorted[j].t - e.t <= SENT_HOME_WITHIN; j++) {
      if (sorted[j].type === 'STATE' && sorted[j].state === 'DOCKING') return {...e, sentHome: true};
    }
    return e;
  });
}

// os: the mower runs MowBite OS, it doesn't dock yet (until its stage 4): idle after mowing ends the run there, no DOCKED
// comes. on OpenMower idle in the middle of a run (an emergency, put in the dock by hand) goes on until it's docked
export function groupRuns(events: MowerEvent[], live: boolean, now = Date.now() / 1000, os = false): Entry[] {
  const sorted = markSentHome([...events].sort((a, b) => a.t - b.t));
  const out: Entry[] = [];
  let run: MowerEvent[] | null = null;

  // cut: OpenMower started again while it ran (a restart, the power was gone). hand: the blade on in recording mode,
  // mowing by hand (the mowing hours count it too)
  let hand = false;
  const close = (finished: boolean, cut = false, parked = false) => {
    if (run?.length) out.push({kind: 'run', run: summarize(run, finished || !live, now, cut, hand, parked, os)});
    run = null;
    hand = false;
  };
  // the state the mower is in, from its state events
  let state: string | undefined;

  for (const e of sorted) {
    const starts = e.type === 'STATE' && (e.state === 'UNDOCKING' || e.state === 'MOWING');
    // (a run going out straight from mowing by hand is a run of its own)
    if (run && hand && starts) close(true);
    if (!run && e.type === 'BLADES' && e.enabled && state === 'AREA_RECORDING') {
      run = [];
      hand = true;
    }
    if (e.type === 'STATE') state = e.state;
    if (run && e.type === 'BOOTED') close(true, true);
    // leaving the dock always starts a new run, also when the last one never got back (put in the dock by hand). not the
    // way out again of a docking that's tried once more
    const before = run ? (run as MowerEvent[]).filter((r) => r.type === 'STATE').pop()?.state : undefined;
    if (run && e.type === 'STATE' && e.state === 'UNDOCKING' && before !== 'DOCKING') close(true);
    if (!run && starts) run = [];
    if (!run) {
      out.push({kind: 'event', event: e});
      continue;
    }
    run.push(e);
    const ends =
      // by hand: the blade off, or recording mode left with it still on
      (hand && ((e.type === 'BLADES' && !e.enabled) || (e.type === 'STATE' && e.state !== 'AREA_RECORDING'))) ||
      e.type === 'DOCKED' ||
      e.type === 'SHUTDOWN' ||
      (e.type === 'STATE' && e.state === 'IDLE' && run.some((r) => r.type === 'UNDOCKING_FAILED' || r.type === 'DOCKING_FAILED'));
    // (a docking, from stage 4 on, ends it the usual way)
    const parked =
      os &&
      !hand &&
      e.type === 'STATE' &&
      e.state === 'IDLE' &&
      !run.some((r) => (r.type === 'STATE' && (r.state === 'DOCKING' || r.state === 'UNDOCKING')) || r.type === 'DOCKED' || r.type === 'UNDOCKED');
    if (ends || parked) close(true, false, parked && !ends);
  }
  close(false);
  return out;
}

// a run still going counts until now: its blade time and its end grow between the events
// parked: ended idle out on the lawn (MowBite OS), os: how bad an event is comes with it
function summarize(events: MowerEvent[], finished: boolean, now: number, cut: boolean, hand: boolean, parked: boolean, os: boolean): Run {
  const areas: string[] = [];
  let bladeSeconds = 0;
  let bladesSince: number | null = null;
  let problems = 0;
  for (const {event: e, state} of withState(events)) {
    if (e.type === 'AREA' && e.area_name && !areas.includes(e.area_name)) areas.push(e.area_name);
    if (e.type === 'BLADES') {
      if (e.enabled && bladesSince === null) bladesSince = e.t;
      if (!e.enabled && bladesSince !== null) {
        bladeSeconds += e.t - bladesSince;
        bladesSince = null;
      }
    }
    if (describe(e, state, os).severity !== 'info') problems++;
  }
  const last = events[events.length - 1];
  // (standing idle, put in the dock by hand say, it isn't going on)
  const going = !finished && events.filter((e) => e.type === 'STATE').pop()?.state !== 'IDLE';
  const end = going ? Math.max(last.t, now) : last.t;
  if (bladesSince !== null) bladeSeconds += end - bladesSince;

  const has = (type: string) => events.some((e) => e.type === type);
  let outcome: Outcome = 'returned';
  if (!finished) outcome = 'running';
  else if (hand) outcome = 'manual';
  else if (has('JOB_COMPLETE')) outcome = 'done';
  else if (events.some((e) => e.type === 'EMERGENCY' && e.emergency)) outcome = 'emergency';
  else if (has('DOCKING_FAILED')) outcome = 'dock_failed';
  else if (has('UNDOCKING_FAILED') && !has('UNDOCKED')) outcome = 'undock_failed';
  else if (cut || last.type === 'SHUTDOWN') outcome = 'interrupted';
  else if (parked) outcome = 'stopped';
  else {
    // why it went home, the last time it did
    const home = events.filter((e) => e.type === 'DOCKING' && homeReason(e.reason)).pop();
    const why = home ? homeReason(home.reason) : null;
    if (why) outcome = why;
  }

  return {
    start: events[0].t,
    end,
    events,
    areas,
    bladeSeconds,
    problems,
    outcome,
    jobId: events.find((e) => e.job_id)?.job_id,
  };
}

export const OUTCOMES: Record<Outcome, {label: string; tone: 'good' | 'neutral' | 'bad' | 'live'}> = {
  done: {label: 'Finished', tone: 'good'},
  paused: {label: 'Sent home', tone: 'neutral'},
  battery: {label: 'Back to charge', tone: 'neutral'},
  rain: {label: 'Stopped for rain', tone: 'neutral'},
  hot: {label: 'Mow motor too hot', tone: 'bad'},
  returned: {label: 'Back in the dock', tone: 'neutral'},
  stopped: {label: 'Stopped on the lawn', tone: 'neutral'},
  undock_failed: {label: 'Undocking failed', tone: 'bad'},
  dock_failed: {label: 'Docking failed', tone: 'bad'},
  emergency: {label: 'Emergency stop', tone: 'bad'},
  interrupted: {label: 'Interrupted', tone: 'bad'},
  manual: {label: 'Mowed by hand', tone: 'neutral'},
  running: {label: 'Running', tone: 'live'},
};
