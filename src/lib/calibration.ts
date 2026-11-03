import {requestCalib, requestCalibBack} from './autoUpdate';
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

// turns counted each way, or all of them (a planner that doesn't tell the way)
export type Turns = {left: number; right: number} | number;

export interface CalibProgress {
  phase: string | null;
  m: number;
  turns: Turns;
  runs: number;
  ready: boolean;
  error: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

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
  const t = p.turns as Record<string, unknown> | number | undefined;
  const turns: Turns = t && typeof t === 'object' ? {left: num(t.left) ?? 0, right: num(t.right) ?? 0} : (num(t) ?? 0);
  return {phase: str(p.phase), m: num(p.m) ?? 0, turns, runs: num(p.runs) ?? 0, ready: p.ready === true, error: str(p.error)};
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

// what a recording still lacks for the values (as the planner counts): by hand at least 20 m in 4 runs and 3 turns on
// the spot each way, a mow 50 m in 8 runs and 20 turns each way
const NEEDS: Record<CalibMode, {m: number; runs: number; turns: number}> = {
  joystick: {m: 20, runs: 4, turns: 3},
  mow: {m: 50, runs: 8, turns: 20},
};
export function missing(p: CalibProgress, mode: CalibMode): {what: 'm' | 'runs' | 'left' | 'right' | 'turns'; left: number}[] {
  const need = NEEDS[mode];
  const out: {what: 'm' | 'runs' | 'left' | 'right' | 'turns'; left: number}[] = [];
  if (p.m < need.m) out.push({what: 'm', left: Math.ceil(need.m - p.m)});
  if (p.runs < need.runs) out.push({what: 'runs', left: need.runs - p.runs});
  if (typeof p.turns === 'number') {
    if (p.turns < 2 * need.turns) out.push({what: 'turns', left: 2 * need.turns - p.turns});
  } else {
    if (p.turns.left < need.turns) out.push({what: 'left', left: need.turns - p.turns.left});
    if (p.turns.right < need.turns) out.push({what: 'right', left: need.turns - p.turns.right});
  }
  return out;
}

export const calibStart = (mode: CalibMode) => callRpc(RPC.plannerCalibStart, {mode}, 20000);
export const calibStop = () => callRpc(RPC.plannerCalibStop, {}, 20000);
export const calibResult = async () => readResult(await callRpc(RPC.plannerCalibResult, {}, 60000));
export const takeCalib = (lines: string) => requestCalib(lines);
export const calibBack = () => requestCalibBack();

export const calibProgress = topicStore<CalibProgress | null>(TOPIC.plannerCalib, null, (payload) => readProgress(payload.toString()));
