import {beforeEach, describe, expect, it, vi} from 'vitest';
import {calibrationWay} from './calibration';
import {demoGeometry} from './demo/geometry';
import {reasonSentence, describe as say} from './events';
import type {Geometry} from './mowerBody';
import {RPC} from './openmower';
import {RpcError} from './rpc';

const sent: {method: string; params: object}[] = [];
let answer: () => Promise<unknown> = () => Promise.resolve({});
vi.mock('./rpc', async (orig) => ({
  ...(await orig<typeof import('./rpc')>()),
  callRpc: (method: string, params: object) => (sent.push({method, params}), answer()),
  callCommand: (method: string, params: object) => (sent.push({method, params}), answer()),
}));
const hold: {note: {at: number; text: string; warn: boolean} | null} = {note: null};
vi.mock('@/hooks/useMowerActions', () => ({heldBack: () => hold.note}));

const {
  backSettings,
  notTaken,
  offers,
  offersApply,
  offersDrive,
  osCalibAbort,
  osCalibStart,
  phaseOf,
  preselected,
  readCheck,
  readOsResult,
  setBack,
  setSizes,
  stale,
  startRefused,
  stationAgain,
  stripCorners,
  takeSettings,
} = await import('./osCalibration');

// the mower's sizes as the demo's robot.geometry has them, and a change of them
function sizes() {
  const g = demoGeometry().methods;
  const get = () => g[RPC.geometry]({}) as Geometry;
  return {get, set: (settings: Record<string, number>) => g[RPC.geometrySet]({version: get().version, settings}) as Geometry};
}
const value = (name: string, key: string | null, v: number | null, old: number | null, more: object = {}) => ({
  name,
  key,
  value: v,
  unit: 'm',
  old,
  sigma: 0.004,
  quality: 'good',
  ok: true,
  warning: null,
  ...more,
});
// a result as calibration.result gives it after a drive with the platform's sizes
const drive = (values: object[], more: object = {}) =>
  readOsResult({id: 'calib-1', time: 1000, status: 'done', reason: 'DONE', message: '', recording: 'r', summary: 's', station_again: true, ready: true, values, ...more})!;
const VALUES = [
  value('ticks_per_m', 'ticks_per_m', 941, 1000, {unit: '1/m', sigma: 3}),
  value('wheel_distance_m', 'track', 0.42, 0.395, {ok: false, quality: 'poor'}),
  value('antenna_offset_x', 'antenna_x', 0.097, 0),
  value('antenna_offset_y', 'antenna_y', 0.001, 0),
  value('imu_roll', 'imu_roll', 0.035, 0),
  value('imu_yaw', null, 0.2, 0),
];
const by = (list: ReturnType<typeof offers>) => Object.fromEntries(list.map((o) => [o.value.name, o.offer]));

describe("MowBite OS's calibration drive", () => {
  beforeEach(() => {
    sent.length = 0;
    hold.note = null;
    answer = () => Promise.resolve({});
  });

  it('reads what stands in the way of a drive, ok only when the mower says so and names nothing', () => {
    const space = {length: 4.9, width: 1.9, lane_length: 3, heading: 0};
    expect(readCheck({ok: true, problems: [], space})).toEqual({ok: true, problems: [], space});
    const battery = {reason: 'BATTERY_LOW', message: 'Battery 20 %, at least 30 % for a calibration', battery_percentage: 20, limit: 30};
    expect(readCheck({ok: false, problems: [battery], space: null})).toEqual({ok: false, problems: [battery], space: null});
    // an ok with a problem named, or without the list, starts nothing
    expect(readCheck({ok: true, problems: [battery], space})?.ok).toBe(false);
    expect(readCheck({ok: true, space})).toBeNull();
    expect(readCheck(null)).toBeNull();
    expect(readCheck({ok: true, problems: [], space: {length: 4.9, width: 1.9}})?.space).toBeNull();
    // in words: the reason's with its numbers, the mower's own for one the app doesn't know
    expect(reasonSentence('BATTERY_LOW', 'CALIBRATION_REFUSED', battery)).toBe('Battery at 20 %, the calibration drive needs 30 %.');
    expect(reasonSentence('STILL_STOPPING', 'CALIBRATION_REFUSED')).toBe('The last calibration drive is still stopping, try again in a moment.');
    expect(reasonSentence('BUSY', 'CALIBRATION_REFUSED', {state: 'calibrating'})).toBe('Busy: calibration drive.');
    expect(reasonSentence('MOON_PHASE', 'CALIBRATION_REFUSED', {message: 'The moon is full'})).toBe('The moon is full.');
  });

  it('puts the strip around the lane: as far behind its start as beyond its end, as wide to each side', () => {
    const north = stripCorners({length: 5, width: 2, lane_length: 3, heading: Math.PI / 2}, {x: 10, y: 20});
    expect(north.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100])).toEqual([
      [9, 19],
      [9, 24],
      [11, 24],
      [11, 19],
    ]);
  });

  it('reads a result with its status and the size each value goes to, nothing it can not read', () => {
    const r = drive(VALUES, {based_on: {m: 12, turns: 6, runs: 4}});
    expect(r).toMatchObject({id: 'calib-1', time: 1000, status: 'done', stationAgain: true, geometryVersion: null, basedOn: {m: 12, turns: 6, runs: 4}});
    expect(r.values.map((v) => v.key)).toEqual(['ticks_per_m', 'track', 'antenna_x', 'antenna_y', 'imu_roll', null]);
    expect(readOsResult(null)).toBeNull();
    expect(readOsResult({status: 'done', time: 1, values: 'none'})).toBeNull();
    expect(readOsResult({status: 'great', time: 1, values: []})).toBeNull();
    expect(readOsResult({status: 'failed', time: 5, reason: 'LEFT_LANE', values: [], error: 7})).toMatchObject({status: 'failed', reason: 'LEFT_LANE', error: null});
    // a value that says ok without a number isn't one
    expect(drive([value('ticks_per_m', 'ticks_per_m', null, 1000)]).values[0].ok).toBe(false);
  });

  it('offers only what the planner trusts, the mower has a size for and accepts', () => {
    const {get} = sizes();
    const offered = offers(drive(VALUES), get());
    expect(by(offered)).toEqual({
      ticks_per_m: 'take',
      wheel_distance_m: 'not_ok',
      antenna_offset_x: 'take',
      antenna_offset_y: 'take',
      imu_roll: 'take',
      imu_yaw: 'no_key',
    });
    // a size of the platform alone is none to take
    expect(by(offers(drive([value('wheel_radius', 'wheel_radius', 0.11, 0.1)]), get())).wheel_radius).toBe('no_key');
    // outside the mower's range: not offered, and never cut to fit
    const far = offers(drive([value('ticks_per_m', 'ticks_per_m', 12000, 1000), value('imu_roll', 'imu_roll', 0.09, 0)]), get());
    expect(far.map((o) => [o.offer, o.min, o.max])).toEqual([
      ['out_of_range', 100, 10000],
      ['out_of_range', -0.087, 0.087],
    ]);
    expect(takeSettings(far, new Set(['ticks_per_m', 'imu_roll']))).toEqual({});
    // a drive that wasn't evaluated, or didn't run to its end, has nothing to take
    for (const status of ['not_evaluated', 'failed']) expect(Object.values(by(offers(drive(VALUES, {status}), get()))).filter((o) => o === 'take')).toEqual([]);
  });

  it('ticks at first only what changed by more than the measuring accuracy and not by much', () => {
    const offered = offers(drive(VALUES), sizes().get());
    // the antenna 9.7 cm off is a big change, 1 mm is within the accuracy
    expect(offered.filter(preselected).map((o) => o.value.name)).toEqual(['ticks_per_m', 'imu_roll']);
    // without the value before the change isn't known
    expect(preselected(offers(drive([value('imu_pitch', 'imu_pitch', 0.02, null)]), sizes().get())[0])).toBe(false);
  });

  it('sends exactly the ticked values as the result has them, and nothing that can not be taken', () => {
    const offered = offers(drive(VALUES), sizes().get());
    expect(takeSettings(offered, new Set(['ticks_per_m', 'antenna_offset_x', 'wheel_distance_m', 'imu_yaw']))).toEqual({ticks_per_m: 941, antenna_x: 0.097});
    expect(takeSettings(offered, new Set())).toEqual({});
  });

  it('knows what the mower took from the result, sets it back with the values before, and says the station again', () => {
    const {get, set} = sizes();
    const result = drive(VALUES);
    expect(stationAgain(result, offers(result, get()))).toBeNull();
    const taken = takeSettings(offers(result, get()), new Set(['ticks_per_m', 'antenna_offset_x']));
    expect(notTaken(taken, set(taken))).toEqual([]);
    const after = offers(result, get());
    expect(by(after)).toMatchObject({ticks_per_m: 'applied', antenna_offset_x: 'applied', antenna_offset_y: 'take', imu_roll: 'take'});
    expect(stationAgain(result, after)).toBeCloseTo(0.097);
    // the OS's word counts for the station, not a limit of the app
    expect(stationAgain(drive(VALUES, {station_again: false}), after)).toBeNull();
    expect(backSettings(after)).toEqual({ticks_per_m: 1000, antenna_x: 0});
    set(backSettings(after));
    expect(by(offers(result, get()))).toMatchObject({ticks_per_m: 'take', antenna_offset_x: 'take'});
    // a mower that answers with another value than the one sent
    expect(notTaken({ticks_per_m: 941, antenna_x: 0.5}, get())).toEqual(['ticks_per_m', 'antenna_x']);
  });

  it('offers nothing of a result once the sizes were changed after its drive', () => {
    const {get, set} = sizes();
    const result = drive(VALUES);
    expect(stale(result, get())).toBe(false);
    set({antenna_y: 0.02});
    expect(stale(result, get())).toBe(true);
    expect(Object.values(by(offers(result, get()))).filter((o) => o === 'take' || o === 'applied')).toEqual([]);
    expect(by(offers(result, get()))).toMatchObject({ticks_per_m: 'stale', wheel_distance_m: 'not_ok', imu_yaw: 'no_key'});
    expect(takeSettings(offers(result, get()), new Set(['ticks_per_m']))).toEqual({});
    // without the value before: one set or confirmed after the drive counts as changed
    const blind = drive([value('imu_pitch', 'imu_pitch', 0.02, null)]);
    const fresh = sizes();
    expect(stale(blind, fresh.get())).toBe(false);
    fresh.set({imu_pitch: 0.01});
    expect(stale(blind, fresh.get())).toBe(true);
    // an OS that tells the version of the sizes the drive was made with: the same version is never stale
    expect(stale(drive(VALUES, {geometry_version: get().version}), get())).toBe(false);
    expect(stale(drive(VALUES, {geometry_version: get().version - 1}), get())).toBe(true);
    // nor at the version its last apply left
    const took = {result_id: 'calib-1', t: 1100, keys: ['ticks_per_m'], geometry_version: get().version, values: {}};
    expect(stale(drive(VALUES, {geometry_version: get().version - 1, applied: took}), get())).toBe(false);
    // with calibration.apply any other version is, as the OS turns it down: a value set back too
    const other = sizes().get();
    const back = drive(VALUES, {geometry_version: other.version + 6});
    expect([stale(back, other), stale(back, other, true)]).toEqual([false, true]);
    expect(stale(drive(VALUES, {geometry_version: 0}), other, true)).toBe(false);
  });

  it('takes a value the mower has had all along for the same, not for applied', () => {
    const {get} = sizes();
    expect(by(offers(drive([value('antenna_offset_y', 'antenna_y', 0, 0)]), get())).antenna_offset_y).toBe('same');
  });

  it('writes the sizes with the version they were checked against, all at once, before calibration.apply', async () => {
    const {get} = sizes();
    answer = () => Promise.resolve(get());
    expect(await setSizes(get(), {ticks_per_m: 941, antenna_x: 0.097}, false)).toEqual({geometry: get(), applied: null});
    expect(sent).toEqual([{method: RPC.geometrySet, params: {version: get().version, settings: {ticks_per_m: 941, antenna_x: 0.097}}}]);
  });

  it('lets the OS take the values from its result by key with calibration.apply, none on purpose too', async () => {
    const {get} = sizes();
    expect(offersApply(new Set([RPC.calibrationResult]))).toBe(false);
    expect(offersApply(new Set([RPC.calibrationResult, RPC.calibrationApply]))).toBe(true);
    const applied = {result_id: 'calib-1', t: 1100, keys: ['ticks_per_m', 'antenna_x'], geometry_version: 7, values: {ticks_per_m: 941}};
    answer = () => Promise.resolve({applied, geometry: get()});
    expect(await setSizes(get(), {ticks_per_m: 941, antenna_x: 0.097}, true)).toEqual({geometry: get(), applied: {t: 1100, keys: ['ticks_per_m', 'antenna_x'], geometryVersion: 7}});
    await setSizes(get(), {}, true);
    expect(sent).toEqual([
      {method: RPC.calibrationApply, params: {keys: ['ticks_per_m', 'antenna_x'], client: 'app'}},
      {method: RPC.calibrationApply, params: {keys: [], client: 'app'}},
    ]);
    // the values from before the drive aren't the result's: always robot.geometry.set
    answer = () => Promise.resolve(get());
    await setBack(get(), {ticks_per_m: 1000});
    expect(sent[2]).toEqual({method: RPC.geometrySet, params: {version: get().version, settings: {ticks_per_m: 1000}}});
  });

  it("reads the result's last apply, none before it and from an OS before api 67", () => {
    expect(drive(VALUES).applied).toBeNull();
    expect(drive(VALUES, {applied: null}).applied).toBeNull();
    expect(drive(VALUES, {applied: {result_id: 'calib-1', t: 1100, keys: [], geometry_version: 3, values: {}}}).applied).toEqual({t: 1100, keys: [], geometryVersion: 3});
  });

  it('starts only with a current state and never holds the stop back', async () => {
    hold.note = {at: 0, text: "Not sent, the mower hasn't reported for a while.", warn: true};
    await expect(osCalibStart()).rejects.toMatchObject({code: 'held', message: "Not sent, the mower hasn't reported for a while."});
    expect(sent).toEqual([]);
    await osCalibAbort();
    expect(sent.map((s) => s.method)).toEqual([RPC.calibrationAbort]);
    hold.note = null;
    await osCalibStart();
    expect(sent[1]).toMatchObject({method: RPC.calibrationStart});
  });

  it("reads a start turned down as the event it goes out as, though the answer doesn't name one", () => {
    const e = new RpcError(RPC.calibrationStart, -32600, 'no room', {reason: 'NO_ROOM', message: 'No room', free_length: 1.2, length: 2});
    const refused = startRefused(e)!;
    expect(refused).toMatchObject({type: 'CALIBRATION_REFUSED', reason: 'NO_ROOM', free_length: 1.2});
    expect(say(refused, undefined, true)).toEqual({text: 'Calibration not started: not enough room here, the drive needs 2.0 m and has 1.2 m', severity: 'warning'});
    // an OS that names the event and how bad it is
    const named = startRefused(new RpcError(RPC.calibrationStart, -32600, 'busy', {event: 'CALIBRATION_REFUSED', reason: 'BUSY', state: 'MOWING', severity: 'info', event_id: 'e3'}))!;
    expect(named.id).toBe('e3');
    expect(say(named, undefined, true)).toEqual({text: 'Calibration not started: busy: Mowing', severity: 'info'});
    expect(startRefused(new RpcError(RPC.calibrationStart, 'timeout', 'calibration.start timed out'))).toBeNull();
    expect(startRefused(new RpcError(RPC.calibrationStart, -32601, 'Method not found'))).toBeNull();
  });

  it('follows the phases of the drive, with its rounds and time from an OS that tells them', () => {
    expect(phaseOf({id: '', t: 0, type: 'CALIBRATION', phase: 'spin_left', index: 2})).toEqual({phase: 'spin_left', index: 2, rounds: null, seconds: null});
    expect(phaseOf({id: '', t: 0, type: 'CALIBRATION', phase: 'start', index: 0, rounds: 4, expected_s: 230})).toMatchObject({rounds: 4, seconds: 230});
    expect(phaseOf({id: '', t: 0, type: 'CALIBRATION', phase: 'dance'})).toBeNull();
    expect(phaseOf({id: '', t: 0, type: 'STATE', phase: 'line'})).toBeNull();
  });

  it('is offered with its start and stop together, the result alone leads to its page too', () => {
    const all = new Set([RPC.calibrationCheck, RPC.calibrationStart, RPC.calibrationAbort, RPC.calibrationResult]);
    expect(offersDrive(all)).toBe(true);
    expect(offersDrive(new Set([RPC.calibrationCheck, RPC.calibrationStart]))).toBe(false);
    expect(calibrationWay(new Set([RPC.calibrationResult]), true)).toBe('os');
    expect([null, undefined, new Set(['planner.calib.start'])].map((m) => calibrationWay(m, true))).toEqual([null, null, null]);
  });
});
