import {requestCalib, requestCalibBack} from './autoUpdate';
import {fmt, tr} from './i18n';
import {topicStore} from './mqttClient';
import {RPC, TOPIC} from './openmower';
import {callRpc} from './rpc';

// The mower's sizes measured from a recording (format mowbite-calib/1): on OpenMower the MowBite Planner records a drive
// by hand with the joystick or the next mow and works the values out (planner.calib.*), the MowBite Updater writes the
// chosen ones into OpenMower's mower_params.yaml (its list calib_paths: the path, unit and bounds of each, only what the
// file has) and starts OpenMower again. A value the planner trusts (ok) is offered, the others shown with why

export type CalibMode = 'joystick' | 'mow';
export type Quality = 'good' | 'fair' | 'poor';

export interface CalibValue {
  name: string;
  value: number | null;
  unit: string;
  // the one set now
  old: number | null;
  // how far off the value may be
  sigma: number | null;
  quality: Quality | null;
  // within the fixed bounds and not poor: offered to take
  ok: boolean;
  warning: string | null;
}

export interface CalibResult {
  ready: boolean;
  basedOn: {m: number; turns: number; runs: number};
  warnings: string[];
  // only to show: the gyro's scale and bias, the GNSS's delay, RTK's scatter, the tilt, real against asked speed
  info: Record<string, unknown>;
  values: CalibValue[];
}

// what a recording has so far (as the planner counts it while recording) and what its mode needs of each (need), by
// the planner's names: m and runs of straight runs (run_m long at least), still_s stood, and each way the turns between
// runs (turns_), their full turns (rotation_) and those of the tight ones on the spot (tight_, for the antenna)
export const COUNTS = ['m', 'runs', 'still_s', 'turns_left', 'turns_right', 'rotation_left', 'rotation_right', 'tight_left', 'tight_right'] as const;
export type Count = (typeof COUNTS)[number];

export interface CalibProgress {
  phase: 'recording' | 'evaluating' | 'done' | null;
  // from a planner that tells it
  mode: CalibMode | null;
  // full turns of all of it
  turns: number;
  has: Partial<Record<Count, number>>;
  // what the mode needs, empty from a planner that doesn't tell
  need: Partial<Record<Count | 'run_m', number>>;
  ready: boolean;
  error: string | null;
  // the receiver's fix while it's recorded, it counts only with it (planner v0.4.0 on); none from one that doesn't tell
  rtk: Rtk | null;
}
// accuracy in m, none when nothing comes from the receiver
export interface Rtk {
  fixed: boolean;
  accuracy: number | null;
}

// only in dev and test builds: before planner v0.4.1 a v2 mower's turns aren't counted (the firmware's turn rate is off)
export const CALIB_SHOWN = process.env.APP_CALIBRATION === '1';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const readRtk = (v: unknown): Rtk =>
  v && typeof v === 'object' ? {fixed: (v as {fixed?: unknown}).fixed === true, accuracy: num((v as {accuracy?: unknown}).accuracy)} : {fixed: false, accuracy: null};

export function readResult(answer: unknown): CalibResult | null {
  const r = answer as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.values)) return null;
  const b = (r.based_on ?? {}) as Record<string, unknown>;
  return {
    ready: r.ready === true,
    basedOn: {m: num(b.m) ?? 0, turns: num(b.turns) ?? 0, runs: num(b.runs) ?? 0},
    warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string') : [],
    info: r.info && typeof r.info === 'object' ? (r.info as Record<string, unknown>) : {},
    values: r.values.flatMap((v: Record<string, unknown>) => {
      const name = str(v?.name);
      if (!name) return [];
      const quality = v.quality === 'good' || v.quality === 'fair' || v.quality === 'poor' ? v.quality : null;
      return [{name, value: num(v.value), unit: str(v.unit) ?? '', old: num(v.old), sigma: num(v.sigma), quality, ok: v.ok === true && num(v.value) !== null, warning: str(v.warning)}];
    }),
  };
}

export function readProgress(payload: string): CalibProgress | null {
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!p || typeof p !== 'object') return null;
  const has: CalibProgress['has'] = {};
  for (const k of COUNTS) if (num(p[k]) !== null) has[k] = num(p[k])!;
  const need: CalibProgress['need'] = {};
  const n = p.need && typeof p.need === 'object' ? (p.need as Record<string, unknown>) : {};
  for (const k of [...COUNTS, 'run_m'] as const) if (num(n[k]) !== null) need[k] = num(n[k])!;
  const phase = p.phase === 'recording' || p.phase === 'evaluating' || p.phase === 'done' ? p.phase : null;
  const mode = p.mode === 'joystick' || p.mode === 'mow' ? p.mode : null;
  return {phase, mode, turns: num(p.turns) ?? 0, has, need, ready: p.ready === true, error: str(p.error), rtk: 'rtk' in p ? readRtk(p.rtk) : null};
}

// what the updater may write, by name: "<name>:<path>:<unit>:<min>:<max>:<value>" each (calib_paths)
export interface CalibPath {
  path: string;
  unit: string;
  min: number;
  max: number;
  value: number | null;
}
export function readPaths(s: string | undefined): Record<string, CalibPath> {
  const out: Record<string, CalibPath> = {};
  for (const e of (s ?? '').split(/\s+/)) {
    const [name, path, unit, min, max, value] = e.split(':');
    if (!name || !path || min === undefined || max === undefined || !Number.isFinite(+min) || !Number.isFinite(+max)) continue;
    out[name] = {path, unit: unit ?? '', min: +min, max: +max, value: value !== undefined && value !== '' && Number.isFinite(+value) ? +value : null};
  }
  return out;
}

// what the updater did with the last request (calib): written, back, refused, waiting for the dock, error, with why
export interface CalibState {
  what: 'written' | 'back' | 'refused' | 'waiting' | 'error';
  at: number;
  why: string | null;
}
export function readState(s: string | undefined): CalibState | null {
  const [what, at, why] = (s ?? '').split(' ');
  if (!['written', 'back', 'refused', 'waiting', 'error'].includes(what) || !Number.isFinite(+at)) return null;
  return {what: what as CalibState['what'], at: +at, why: why || null};
}

// what it wrote last (calib_last "<unix> <path> <old> <new> ..."), for "last calibration"
export interface CalibLast {
  at: number;
  values: {path: string; old: number; new: number}[];
}
export function readLast(s: string | undefined): CalibLast | null {
  const w = (s ?? '').split(/\s+/).filter(Boolean);
  if (w.length < 4 || !Number.isFinite(+w[0])) return null;
  const values: CalibLast['values'] = [];
  for (let i = 1; i + 2 < w.length; i += 3) {
    if (Number.isFinite(+w[i + 1]) && Number.isFinite(+w[i + 2])) values.push({path: w[i], old: +w[i + 1], new: +w[i + 2]});
  }
  return values.length ? {at: +w[0], values} : null;
}

// a big change against the value set now, shown clearly (the planner warns about it too): over 10 % for the ticks, 5 %
// for the wheels' distance, 5 cm for the antenna
const BIG: Record<string, (abs: number, pct: number | null) => boolean> = {
  ticks_per_m: (_, pct) => pct !== null && Math.abs(pct) > 10,
  wheel_distance_m: (_, pct) => pct !== null && Math.abs(pct) > 5,
  antenna_offset_x: (abs) => Math.abs(abs) > 0.05,
  antenna_offset_y: (abs) => Math.abs(abs) > 0.05,
};

// the change of a value as the dialog shows it: absolute, in % of the one set now, within its sigma (unchanged), big
export function changeOf(v: CalibValue): {abs: number; pct: number | null; unchanged: boolean; big: boolean} | null {
  if (v.value === null || v.old === null) return null;
  const abs = v.value - v.old;
  const pct = v.old !== 0 ? (abs / Math.abs(v.old)) * 100 : null;
  const unchanged = v.sigma !== null && Math.abs(abs) < v.sigma;
  return {abs, pct, unchanged, big: !unchanged && (BIG[v.name]?.(abs, pct) ?? false)};
}

// chosen at first: the ones it trusts that changed
export const preselected = (v: CalibValue) => v.ok && !changeOf(v)?.unchanged;

// the request for the updater: "<path> <value>" a line for the chosen values it may write (a name in its list, within
// its bounds), the others to type in by hand
export function calibLines(values: CalibValue[], chosen: Set<string>, paths: Record<string, CalibPath>): {lines: string; byHand: CalibValue[]} {
  const lines: string[] = [];
  const byHand: CalibValue[] = [];
  for (const v of values) {
    if (!chosen.has(v.name) || !v.ok || v.value === null) continue;
    const p = paths[v.name];
    if (p && v.value >= p.min && v.value <= p.max) lines.push(`${p.path} ${v.value}`);
    else byHand.push(v);
  }
  return {lines: lines.length ? lines.join('\n') + '\n' : '', byHand};
}

// what a recording still lacks, as the tiles show it: standing, straight runs (and their meters), the turns each way
// (how many, and their full turns: all, and on the spot). need minus what it has, nothing without need
export type Part = 'still' | 'straight' | 'left' | 'right';
export interface Lack {
  part: Part;
  // how many of how many, of the count the tile shows (s, runs, turns)
  has: number;
  need: number;
  // what's left of it, the count shown first, then the others: m of the runs, full turns of the turns
  left: number;
  more: number;
}
export function lacks(p: CalibProgress): Lack[] {
  const has = (k: Count) => p.has[k] ?? 0;
  const left = (k: Count) => Math.max(0, (p.need[k] ?? 0) - has(k));
  const out: Lack[] = [];
  if (p.need.still_s !== undefined) out.push({part: 'still', has: has('still_s'), need: p.need.still_s, left: left('still_s'), more: 0});
  if (p.need.runs !== undefined) out.push({part: 'straight', has: has('runs'), need: p.need.runs, left: left('runs'), more: left('m')});
  for (const side of ['left', 'right'] as const) {
    const turns = `turns_${side}` as const;
    if (p.need[turns] === undefined) continue;
    out.push({part: side, has: has(turns), need: p.need[turns]!, left: left(turns), more: Math.max(left(`rotation_${side}`), left(`tight_${side}`))});
  }
  return out;
}
export const lackDone = (l: Lack) => l.left === 0 && l.more <= 0;

// what the planner says (English with numbers in it) as a text to translate, its numbers in the reader's format. what
// isn't known stays as it came
const N = String.raw`(-?[\d.]+)`;
const re = (s: string) => new RegExp(`^${s}$`);
// a number as it came, with as many digits after the point, in the reader's format
const local = (s: string) => fmt(+s, (s.split('.')[1] ?? '').length);
const ONE_VALUE = 'OpenMower has one value for both, nothing to set for it.';
const SAYS: [RegExp, (n: string[], m: RegExpMatchArray) => string][] = [
  [/^no estimate$/, () => tr('Not enough data for it.')],
  [re(`too uncertain: ${N} \\+- ${N} (\\S*), needs \\+- ${N}`), ([a, b, , c], m) => tr('Too inaccurate: {a} ± {b} {u}, ± {c} needed.', {a, b, c, u: m[3]})],
  [re(`out of range: ${N} (\\S*), plausible ${N} to ${N}`), ([a, , b, c], m) => tr('Not plausible: {a} {u}, it should be between {b} and {c}.', {a, b, c, u: m[2]})],
  [re(`large change from ${N}: ${N} (%|\\S+)`), ([a, b], m) => tr('Big change from {a}: {b} {u}.', {a, b, u: m[3]})],
  [
    re(`too few straight runs: ${N} of ${N} \\(${N} m at least\\), ${N} of ${N} m`),
    ([a, b, c, d, e]) => tr('Too few straight runs: {a} of {b} (each {c} m at least), {d} of {e} m.', {a, b, c, d, e}),
  ],
  [re(`too few turns between runs: ${N} left, ${N} right, of ${N} each way`), ([a, b, c]) => tr('Too few turns between the runs: {a} left, {b} right, {c} needed each way.', {a, b, c})],
  [
    re(`too few tight turns: ${N} left, ${N} right \\(full turns, ${N} each way and two turns at least\\)`),
    ([a, b, c]) => tr('Too few turns on the spot: {a} rounds left, {b} right, {c} needed each way (in two turns at least).', {a, b, c}),
  ],
  [re(`too little standing: ${N} of ${N} s`), ([a, b]) => tr('Too little standing still: {a} of {b} s.', {a, b})],
  [re(`no place stood on in two headings \\(${N} stands with a heading\\)`), ([a]) => tr('It never stood on the same spot facing two ways ({a} stops).', {a})],
  [/^IMU data not in base_link \((.*)\)$/, (_, m) => tr("The IMU's data isn't in base_link ({x}).", {x: m[1]})],
  [
    re(`the IMU sits tilted: roll ${N} deg, pitch ${N} deg \\(OpenMower has no setting for it\\)`),
    ([a, b]) => tr('The IMU sits tilted: {a}° to the side, {b}° forward. Just a note, OpenMower has no setting for it.', {a, b}),
  ],
  [/^the recording stops in the middle \(no end line\): evaluated up to there$/, () => tr('The recording stopped partway, evaluated up to that point.')],
  [/^the recording ended with an error: (.*)$/, (_, m) => tr('The recording ended with an error: {x}', {x: m[1]})],
  [/^the recording ended with an error$/, () => tr('The recording ended with an error.')],
  [/^the recording ended at its time limit$/, () => tr('The recording ended at its time limit.')],
  [/^the recording ended at its size limit$/, () => tr('The recording ended at its size limit.')],
  [re(`no RTK fixed positions \\(${N}\\)`), () => tr('No positions with an RTK fix.')],
  [
    re(`left/right: the (left|right) wheel is in effect ${N} % smaller \\(diameter, wear, dirt\\), straight on the odometry it turns (?:left|right); OpenMower has one ticks_per_m for both`),
    ([, b], m) =>
      tr(m[1] === 'left' ? 'Left and right: the left wheel is in effect {b} % smaller (tyre, wear, dirt), the mower pulls to the left.' : 'Left and right: the right wheel is in effect {b} % smaller (tyre, wear, dirt), the mower pulls to the right.', {b}) +
      ' ' +
      tr(ONE_VALUE),
  ],
  [
    re(`left/right: the (left|right) wheel is in effect ${N} % smaller \\(diameter, wear, dirt\\): ${N} and ${N} ticks/m left and right; OpenMower has one ticks_per_m for both`),
    ([, b], m) =>
      tr(m[1] === 'left' ? 'Left and right: the left wheel is in effect {b} % smaller (tyre, wear, dirt), the mower pulls to the left.' : 'Left and right: the right wheel is in effect {b} % smaller (tyre, wear, dirt), the mower pulls to the right.', {b}) +
      ' ' +
      tr(ONE_VALUE),
  ],
  [/^no wheel ticks recorded: the wheel distance comes only from them$/, () => tr('No wheel ticks recorded: the wheel distance comes only from them.')],
  [
    re(`left/right: the (left|right) wheel turns ${N} % faster than asked \\(motor, gearbox, control\\)`),
    ([, b], m) =>
      tr(m[1] === 'left' ? 'Left and right: the left wheel turns {b} % faster than asked (motor, gearbox, control).' : 'Left and right: the right wheel turns {b} % faster than asked (motor, gearbox, control).', {b}) + ' ' + tr(ONE_VALUE),
  ],
  [
    re(`only ${N} % of the driving was straight \\(a radius of 3 m or more\\): the mower pulls to one side or was steered`),
    ([a]) => tr('Only {a} % of the driving was straight (a radius of 3 m or more): the mower pulls to one side or was steered.', {a}),
  ],
  [re(`RTK fixed only ${N} % of the time moving`), ([a]) => tr('RTK fix only {a} % of the time it moved.', {a})],
  [re(`wheel distance on the spot ${N} m, in arcs ${N} m \\(${N} % apart\\), proposed: .*`), ([a, b, c]) => tr('Wheel distance turning on the spot {a} m, in curves {b} m ({c} % apart).', {a, b, c})],
  [/^no RTK fixed$/, () => tr('No RTK fix: the recording only starts with one.')],
  [re(`RTK fixed, but ${N} m accuracy \\(${N} m at most\\)`), ([a, b]) => tr('RTK fix, but only accurate to {a} m ({b} m at most).', {a, b})],
  [/^nothing on (.*)$/, (_, m) => tr('Nothing comes on {x}: is OpenMower running?', {x: m[1]})],
  [/^OpenMower's parameter (.*) isn't set$/, (_, m) => tr("OpenMower's parameter {x} isn't set.", {x: m[1]})],
  [re(`only ${N} MB free on the mower, ${N} MB needed`), ([a, b]) => tr('Only {a} MB free on the mower, {b} MB needed for the recording.', {a, b})],
  [/^a calibration is recorded already/, () => tr('A calibration is being recorded already.')],
  [/^the last calibration is being evaluated$/, () => tr('The last calibration is still being worked out.')],
  [/^the calibration is still recorded$/, () => tr('The calibration is still being recorded.')],
  [/^the calibration is being evaluated$/, () => tr('The calibration is being worked out.')],
  [/^no calibration (is )?recorded$/, () => tr('No calibration recorded.')],
];
export function calibText(said: string): string {
  for (const [pattern, say] of SAYS) {
    const m = said.match(pattern);
    if (m) return say(m.slice(1).map((v) => (v !== undefined && /^-?[\d.]+$/.test(v) ? local(v) : v)), m);
  }
  return said;
}

// whether one can be recorded (planner v0.4.0 on): what stands in the way ({reason, message}), the receiver's fix
export interface CalibCheck {
  ok: boolean;
  problems: {reason: string; message: string}[];
  rtk: Rtk | null;
}
export async function calibCheck(): Promise<CalibCheck | null> {
  const a = await callRpc(RPC.plannerCalibCheck, {}, 30000);
  if (!a || typeof a !== 'object') return null;
  const c = a as Record<string, unknown>;
  const problems = (Array.isArray(c.problems) ? c.problems : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({reason: str(x.reason) ?? '', message: str(x.message) ?? ''}));
  return {ok: c.ok === true, problems, rtk: c.rtk && typeof c.rtk === 'object' ? readRtk(c.rtk) : null};
}
export const calibStart = (mode: CalibMode) => callRpc(RPC.plannerCalibStart, {mode}, 20000);
export const calibStop = () => callRpc(RPC.plannerCalibStop, {}, 20000);
export const calibResult = async () => readResult(await callRpc(RPC.plannerCalibResult, {}, 60000));
export const takeCalib = (lines: string) => requestCalib(lines);
export const calibBack = () => requestCalibBack();

export const calibProgress = topicStore<CalibProgress | null>(TOPIC.plannerCalib, null, (payload) => readProgress(payload.toString()));
