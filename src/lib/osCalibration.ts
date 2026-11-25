import {heldBack} from '@/hooks/useMowerActions';
import {changeOf, readValue, type CalibResult, type CalibValue} from './calibration';
import type {MowerEvent} from './events';
import {geometryChanged, saveGeometry, type Geometry} from './mowerBody';
import {CALIBRATION_PHASES, RPC} from './openmower';
import {callCommand, callRpc, RpcError} from './rpc';

// MowBite OS's calibration drive (calibration.*, masterplan 3): the mower drives a lane to and fro by itself, without
// the blade, its planner works the sizes out and the OS keeps the result. Nothing of it is taken by itself: the values
// the user ticks go in with calibration.apply (api 67, before it robot.geometry.set). Whether a drive may start is the
// OS's to say (calibration.check), the app only shows it

export interface CalibProblem {
  reason: string;
  message: string;
  [field: string]: unknown;
}
// the strip the drive needs (m) and the lane in it, heading in rad
export interface CalibSpace {
  length: number;
  width: number;
  lane_length: number;
  heading: number;
}
export interface OsCheck {
  ok: boolean;
  problems: CalibProblem[];
  space: CalibSpace | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// calibration.check's answer, null for one that can't be read. ok only when it says so and names no problem
export function readCheck(answer: unknown): OsCheck | null {
  const c = answer as Record<string, unknown> | null;
  if (!c || typeof c !== 'object' || !Array.isArray(c.problems)) return null;
  const problems = c.problems.map((p: unknown): CalibProblem => {
    const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
    return {...o, reason: typeof o.reason === 'string' ? o.reason : '', message: typeof o.message === 'string' ? o.message : ''};
  });
  const s = c.space && typeof c.space === 'object' ? (c.space as Record<string, unknown>) : null;
  const [length, width, lane, heading] = [num(s?.length), num(s?.width), num(s?.lane_length), num(s?.heading)];
  const space = length !== null && width !== null && lane !== null && heading !== null ? {length, width, lane_length: lane, heading} : null;
  return {ok: c.ok === true && problems.length === 0, problems, space};
}

// the corners of the strip on the map: the lane from the mower along heading, the strip as far behind its start as
// beyond its end and as wide to each side
export function stripCorners(space: CalibSpace, at: {x: number; y: number}): {x: number; y: number}[] {
  const over = (space.length - space.lane_length) / 2;
  const [c, s] = [Math.cos(space.heading), Math.sin(space.heading)];
  const corner = (ahead: number, left: number) => ({x: at.x + c * ahead - s * left, y: at.y + s * ahead + c * left});
  return [corner(-over, space.width / 2), corner(space.lane_length + over, space.width / 2), corner(space.lane_length + over, -space.width / 2), corner(-over, -space.width / 2)];
}

export type OsStatus = 'done' | 'not_evaluated' | 'failed';
// the last calibration.apply of a result: when, the keys it took ([] for none on purpose) and the sizes' version after it
export interface Applied {
  t: number;
  keys: string[];
  geometryVersion: number;
}
// key: the size of robot.geometry the value goes to, null for one that has none
export interface OsValue extends CalibValue {
  key: string | null;
}
export interface OsResult extends CalibResult {
  id: string;
  // when the drive ended (unix s)
  time: number;
  status: OsStatus;
  // DONE, or why the drive stopped
  reason: string;
  message: string;
  // what the planner said against the recording
  error: string | null;
  // the antenna moved by more than the OS's limit: the station recorded with the old one lies off
  stationAgain: boolean;
  // the version of the sizes the drive was made with, from an OS that tells it
  geometryVersion: number | null;
  applied: Applied | null;
  values: OsValue[];
}

function readApplied(v: unknown): Applied | null {
  const a = v as Record<string, unknown> | null;
  const [t, version] = [num(a?.t), num(a?.geometry_version)];
  if (!a || t === null || version === null || !Array.isArray(a.keys)) return null;
  return {t, keys: a.keys.filter((k): k is string => typeof k === 'string'), geometryVersion: version};
}

// calibration.result's answer: null before the first drive and for one that can't be read
export function readOsResult(answer: unknown): OsResult | null {
  const r = answer as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.values)) return null;
  const status = r.status === 'done' || r.status === 'not_evaluated' || r.status === 'failed' ? r.status : null;
  const time = num(r.time);
  if (!status || time === null) return null;
  const b = (r.based_on ?? {}) as Record<string, unknown>;
  return {
    id: typeof r.id === 'string' ? r.id : '',
    time,
    status,
    reason: typeof r.reason === 'string' ? r.reason : '',
    message: typeof r.message === 'string' ? r.message : '',
    error: typeof r.error === 'string' && r.error ? r.error : null,
    stationAgain: r.station_again === true,
    geometryVersion: num(r.geometry_version),
    applied: readApplied(r.applied),
    ready: r.ready === true,
    basedOn: {m: num(b.m) ?? 0, turns: num(b.turns) ?? 0, runs: num(b.runs) ?? 0},
    warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string') : [],
    info: r.info && typeof r.info === 'object' ? (r.info as Record<string, unknown>) : {},
    values: r.values.flatMap((v: Record<string, unknown>) => {
      const value = readValue(v);
      return value ? [{...value, key: typeof v.key === 'string' && v.key ? v.key : null}] : [];
    }),
  };
}

// What can be done with a value of the result as the mower's sizes are now. take: it can be ticked. applied: the mower
// has it from this result. same: the mower had it before the drive already. The rest can't be taken: the planner
// doesn't trust it (not_ok), the mower has no size for it (no_key), it's outside what the mower accepts
// (out_of_range, never cut to fit), or the sizes were changed since the drive (stale, then for all of them)
export type Offer = 'take' | 'applied' | 'same' | 'not_ok' | 'no_key' | 'out_of_range' | 'stale';
export interface Offered {
  value: OsValue;
  offer: Offer;
  // the range the mower accepts for it, where it gives one
  min?: number;
  max?: number;
}

// (the numbers go through json twice, on the mower and here)
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
const sizeNow = (g: Geometry, key: string | null) => {
  const s = key ? g.settings[key] : undefined;
  return s && s.settable && typeof s.value === 'number' ? {...s, value: s.value} : null;
};

// the sizes changed since the drive: one of them is neither the value before the drive nor the one the drive gave.
// without a value before, one set or confirmed after the drive counts as changed. never with the sizes at the version
// the drive was made with or its last apply left. apply: an OS with calibration.apply, which turns down any other version
export function stale(result: OsResult, g: Geometry, apply = false): boolean {
  const since = result.applied?.geometryVersion ?? result.geometryVersion;
  if (since === g.version) return false;
  // (0: a drive whose version the OS didn't know)
  if (apply && since) return true;
  return result.values.some((v) => {
    const s = sizeNow(g, v.key);
    if (!s || (v.value !== null && same(s.value, v.value))) return false;
    return v.old !== null ? !same(s.value, v.old) : typeof s.confirmed === 'number' && s.confirmed > result.time;
  });
}

export function offers(result: OsResult, g: Geometry, apply = false): Offered[] {
  const old = result.status !== 'done' || stale(result, g, apply);
  return result.values.map((value): Offered => {
    const s = sizeNow(g, value.key);
    const range = s && typeof s.min === 'number' && typeof s.max === 'number' ? {min: s.min, max: s.max} : {};
    const offer = ((): Offer => {
      if (!value.ok || value.value === null) return 'not_ok';
      if (!s) return 'no_key';
      if (old) return 'stale';
      if (same(s.value, value.value)) return value.old !== null && same(value.old, value.value) ? 'same' : 'applied';
      if ((typeof s.min === 'number' && value.value < s.min) || (typeof s.max === 'number' && value.value > s.max)) return 'out_of_range';
      return 'take';
    })();
    return {value, offer, ...range};
  });
}

// ticked at first: what can be taken, changed by more than the measuring accuracy and not by much. a big change is
// for the user to tick
export function preselected(o: Offered): boolean {
  const c = changeOf(o.value);
  return o.offer === 'take' && !!c && !c.unchanged && !c.big;
}

// robot.geometry.set's settings for the values ticked: each as the result has it
export function takeSettings(offered: Offered[], chosen: ReadonlySet<string>): Record<string, number> {
  return Object.fromEntries(offered.filter((o) => o.offer === 'take' && chosen.has(o.value.name)).map((o) => [o.value.key!, o.value.value!]));
}

// and for setting back what was taken from this result: the values before the drive, as long as the mower still has
// the ones taken
export function backSettings(offered: Offered[]): Record<string, number> {
  return Object.fromEntries(offered.filter((o) => o.offer === 'applied' && o.value.old !== null).map((o) => [o.value.key!, o.value.old!]));
}

// The one place values of a result go into the mower's sizes: all of them or none. With calibration.apply the OS takes
// them from its result by key ([] for none on purpose) and turns them down when the sizes changed since, before it
// robot.geometry.set with the version they were checked against
export async function setSizes(g: Geometry, settings: Record<string, number>, apply: boolean): Promise<{geometry: Geometry; applied: Applied | null}> {
  if (!apply) return {geometry: await saveGeometry(g.version, settings, []), applied: null};
  const r = await callCommand<{applied: unknown; geometry: Geometry}>(RPC.calibrationApply, {keys: Object.keys(settings), client: 'app'}, 10000);
  return {geometry: geometryChanged(r.geometry), applied: readApplied(r.applied)};
}
// the values before the drive back: not from the result, so always robot.geometry.set
export const setBack = (g: Geometry, settings: Record<string, number>) => saveGeometry(g.version, settings, []);

// the sizes sent that the mower doesn't answer with: none when it took them all
export const notTaken = (settings: Record<string, number>, g: Geometry): string[] =>
  Object.entries(settings).flatMap(([key, value]) => {
    const now = g.settings[key]?.value;
    return typeof now === 'number' && same(now, value) ? [] : [key];
  });

const ANTENNA = ['antenna_x', 'antenna_y'];
// the OS says the station is to be recorded again, and an antenna value of this result is on the mower: how far it
// moved (m), null otherwise
export function stationAgain(result: OsResult, offered: Offered[]): number | null {
  const moved = offered
    .filter((o) => o.offer === 'applied' && ANTENNA.includes(o.value.key ?? '') && o.value.old !== null)
    .map((o) => Math.abs(o.value.value! - o.value.old!));
  return result.stationAgain && moved.length ? Math.max(...moved) : null;
}

// the drive's start and stop come together and only while its program runs, the result is there without it
export const offersDrive = (methods: Set<string> | null | undefined) =>
  [RPC.calibrationCheck, RPC.calibrationStart, RPC.calibrationAbort].every((m) => !!methods?.has(m));
export const offersResult = (methods: Set<string> | null | undefined) => !!methods?.has(RPC.calibrationResult);
export const offersApply = (methods: Set<string> | null | undefined) => !!methods?.has(RPC.calibrationApply);

export const osCalibCheck = async () => readCheck(await callRpc(RPC.calibrationCheck, {}, 5000));
export const osCalibResult = async () => readOsResult(await callRpc(RPC.calibrationResult, {}, 10000));

// The start sets the mower off: only with a current state and an interface this app speaks, never sent again by
// itself. late: its answer after the time
export function osCalibStart(late?: (answer: unknown) => void): Promise<{state: string}> {
  const held = heldBack();
  if (held) return Promise.reject(new RpcError(RPC.calibrationStart, 'held', held.text));
  return callCommand<{state: string}>(RPC.calibrationStart, {client: 'app'}, 10000, late);
}
// the stop always goes out. ok false: no drive ran. whether the mower stopped only its state tells
export const osCalibAbort = () => callCommand<{ok: boolean}>(RPC.calibrationAbort, {}, 5000);

// how long after a stop the mower has to have left the drive, before the app says it isn't confirmed
export const STOP_CONFIRM_MS = 2000;
// a check older than this doesn't count for a start
export const CHECK_FRESH_MS = 5000;
export const CHECK_EVERY_MS = 2000;

// a start the OS turned down, as the event it also goes out as: its answer carries the reason and its fields, no event
export function startRefused(e: unknown): MowerEvent | null {
  if (!(e instanceof RpcError) || e.code !== -32600 || typeof e.data?.reason !== 'string') return null;
  const d = e.data;
  return {...d, id: typeof d.event_id === 'string' ? d.event_id : '', t: Date.now() / 1000, type: 'CALIBRATION_REFUSED'};
}

export type CalibPhase = (typeof CALIBRATION_PHASES)[number];
// the phase a CALIBRATION event names and its round, null for another event. rounds and seconds: how many rounds the
// drive has and how long it takes, as its start tells from an OS that does
export interface PhaseSaid {
  phase: CalibPhase;
  index: number;
  rounds: number | null;
  seconds: number | null;
}
export function phaseOf(e: MowerEvent | null): PhaseSaid | null {
  const phase = CALIBRATION_PHASES.find((p) => p === e?.phase);
  if (e?.type !== 'CALIBRATION' || !phase) return null;
  return {phase, index: num(e.index) ?? 0, rounds: num(e.rounds), seconds: num(e.expected_s)};
}
