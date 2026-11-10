import {describe, expect, it, vi} from 'vitest';

// the planner's topic: a message handed to the store as the broker would
const topic = vi.hoisted(() => ({send: (() => {}) as (message: string) => void}));
vi.mock('./mqttClient', () => ({
  topicStore: <T,>(_: string, initial: T, parse: (payload: Buffer, prev: T) => T) => {
    let value = initial;
    const heard = new Set<() => void>();
    topic.send = (m) => {
      value = parse(Buffer.from(m), value);
      heard.forEach((l) => l());
    };
    return {subscribe: (l: () => void) => (heard.add(l), () => heard.delete(l)), get: () => value, initial: () => initial};
  },
}));
vi.mock('./rpc', () => ({callRpc: async () => ({})}));
vi.mock('./autoUpdate', () => ({requestCalib: async () => {}, requestCalibBack: async () => {}}));

vi.stubEnv('APP_CALIBRATION', '1');
const {answerTo, calibByHand, calibLeftOver, calibLines, calibMissing, calibProgress, calibStart, calibText, canCalibrate, changeOf, lackDone, lacks, noneRecorded, preselected, readLast, readPaths, readProgress, readResult, readState} = await import('./calibration');

// an answer of planner.calib.result as the planner gives it (mowbite-calib/1)
const answer = {
  version: 'mowbite-calib/1',
  ready: true,
  based_on: {m: 26.5, turns: 7, runs: 5},
  warnings: ['the right wheel turns 3 % slower'],
  info: {speed_ratio: 0.47},
  values: [
    {name: 'ticks_per_m', value: 2031.5, unit: 'ticks/m', old: 2025.0, sigma: 6, quality: 'good', ok: true, warning: null},
    {name: 'wheel_distance_m', value: 0.3612, unit: 'm', old: 0.3556, sigma: 0.002, quality: 'fair', ok: true, warning: null},
    {name: 'antenna_offset_x', value: -0.101, unit: 'm', old: -0.1, sigma: 0.01, quality: 'good', ok: true, warning: null},
    {name: 'antenna_offset_y', value: null, unit: 'm', old: 0, sigma: null, quality: 'poor', ok: false, warning: 'too few turns left'},
  ],
};
const PATHS =
  'ticks_per_m:ll/services/diff_drive/ticks_per_m:ticks/m:100:10000:2025.0 wheel_distance_m:ll/services/diff_drive/wheel_distance_m:m:0.15:0.80:0.3556 ' +
  'antenna_offset_x:xbot_positioning/antenna_offset_x:m:-0.60:0.60:-0.10';

describe('a calibration', () => {
  it('reads what the planner worked out, the values it trusts offered', () => {
    const r = readResult(answer)!;
    expect(r.ready).toBe(true);
    expect(r.basedOn).toEqual({m: 26.5, turns: 7, runs: 5});
    expect(r.values.map((v) => [v.name, v.ok, v.quality])).toEqual([
      ['ticks_per_m', true, 'good'],
      ['wheel_distance_m', true, 'fair'],
      ['antenna_offset_x', true, 'good'],
      ['antenna_offset_y', false, 'poor'],
    ]);
    expect(r.values[3].warning).toBe('too few turns left');
    expect(readResult({values: 'x'})).toBeNull();
  });

  it('shows each change, one within its sigma as unchanged and not chosen, a big one marked', () => {
    const r = readResult(answer)!;
    const ticks = changeOf(r.values[0])!;
    expect(ticks.abs).toBeCloseTo(6.5);
    expect(ticks.pct).toBeCloseTo(0.321, 2);
    expect(ticks.unchanged).toBe(false);
    expect(changeOf(r.values[1])!.big).toBe(false);
    expect(changeOf(r.values[2])!.unchanged).toBe(true);
    expect(r.values.map(preselected)).toEqual([true, true, false, false]);
    expect(changeOf({...r.values[1], value: 0.38})!.big).toBe(true);
    expect(changeOf({...r.values[2], value: -0.16, sigma: 0.01})!.big).toBe(true);
    expect(changeOf(r.values[3])).toBeNull();
  });

  it('asks the updater for the chosen ones it may write, the others by hand', () => {
    const r = readResult(answer)!;
    const paths = readPaths(PATHS);
    expect(paths.wheel_distance_m).toEqual({path: 'll/services/diff_drive/wheel_distance_m', unit: 'm', min: 0.15, max: 0.8, value: 0.3556});
    const {lines, byHand} = calibLines(r.values, new Set(['ticks_per_m', 'wheel_distance_m', 'antenna_offset_y']), paths);
    expect(lines).toBe('ll/services/diff_drive/ticks_per_m 2031.5\nll/services/diff_drive/wheel_distance_m 0.3612\n');
    expect(byHand).toEqual([]);
    // without the updater's list (an older one, no file found): all by hand
    const none = calibLines(r.values, new Set(['ticks_per_m']), readPaths(undefined));
    expect(none.lines).toBe('');
    expect(none.byHand.map((v) => v.name)).toEqual(['ticks_per_m']);
    // out of the updater's bounds: by hand, not sent
    expect(calibLines([{...r.values[0], value: 12000}], new Set(['ticks_per_m']), paths).byHand).toHaveLength(1);
  });

  it("reads the updater's state and what it wrote last", () => {
    expect(readState('waiting 1793700000')).toEqual({what: 'waiting', at: 1793700000, why: null});
    expect(readState('refused 1793700000 anchors_ll/x')).toEqual({what: 'refused', at: 1793700000, why: 'anchors_ll/x'});
    expect(readState('done 1')).toBeNull();
    // an answer is a change after the request, whatever its time says
    expect(answerTo('written 1793700000', 'written 1793700000')).toBeNull();
    expect(answerTo('waiting 1693700000', 'written 1793700000')).toEqual({what: 'waiting', at: 1693700000, why: null});
    expect(answerTo('written 1793700000', '')).toEqual({what: 'written', at: 1793700000, why: null});
    expect(answerTo(undefined, '')).toBeNull();
    expect(answerTo('back 1793700000', null)).toEqual({what: 'back', at: 1793700000, why: null});
    expect(readLast('1793700000 ll/services/diff_drive/wheel_distance_m 0.3556 0.3612 xbot_positioning/antenna_offset_x -0.10 -0.12')).toEqual({
      at: 1793700000,
      values: [
        {path: 'll/services/diff_drive/wheel_distance_m', old: 0.3556, new: 0.3612},
        {path: 'xbot_positioning/antenna_offset_x', old: -0.1, new: -0.12},
      ],
    });
    expect(readLast('')).toBeNull();
  });

  it('says what a recording still lacks, by what the planner says its mode needs', () => {
    const need = {m: 20, runs: 4, run_m: 5, still_s: 10, turns_left: 3, turns_right: 3, rotation_left: 2.5, rotation_right: 2.5, tight_left: 2, tight_right: 2};
    const has = {m: 12.4, turns: 3.1, runs: 2, still_s: 10.4, turns_left: 3, turns_right: 1, rotation_left: 2.6, rotation_right: 0.5, tight_left: 1.5, tight_right: 0.5};
    const p = readProgress(JSON.stringify({phase: 'recording', ...has, need, ready: false, error: null}))!;
    expect(p.phase).toBe('recording');
    expect(p.turns).toBe(3.1);
    expect(lacks(p).map((l) => [l.part, l.has, l.need, l.left, +l.more.toFixed(2), lackDone(l)])).toEqual([
      ['still', 10.4, 10, 0, 0, true],
      ['straight', 2, 4, 2, 7.6, false],
      // three turns left, but not enough of them on the spot
      ['left', 3, 3, 0, 0.5, false],
      ['right', 1, 3, 2, 2, false],
    ]);
    // a planner that doesn't tell what it needs: nothing to show as missing
    expect(lacks(readProgress(JSON.stringify({phase: 'recording', m: 3, turns: 1, runs: 0}))!)).toEqual([]);
    expect(readProgress('no json')).toBeNull();
    // driven by hand: as the planner says, from one that doesn't by recording mode
    const by = (p: object, recordingMode: boolean) => calibByHand(readProgress(JSON.stringify(p)), recordingMode);
    expect(by({phase: 'recording', mode: 'joystick'}, false)).toBe(true);
    expect(by({phase: 'recording', mode: 'mow'}, true)).toBe(false);
    expect(by({phase: 'recording'}, true)).toBe(true);
    expect(by({phase: 'recording'}, false)).toBe(false);
    expect(by({phase: 'done', mode: 'joystick'}, true)).toBe(false);
    expect(calibByHand(null, true)).toBe(false);
    // only with a planner that offers it, what its topic says alone doesn't count
    expect(canCalibrate(new Set(['planner.calib.start']))).toBe(true);
    expect([new Set(['planner.plan']), null, undefined].map(canCalibrate)).toEqual([false, false, false]);
    expect([new Set(['planner.calib.start']), new Set(['planner.plan']), null, undefined].map(calibMissing)).toEqual([null, 'planner', 'planner', 'connecting']);
  });

  it("takes a recording the planner doesn't have for none until it says something else", async () => {
    const recording = JSON.stringify({phase: 'recording', mode: 'joystick', m: 0, turns: 0, runs: 0});
    expect(['no calibration is recorded', 'no calibration recorded', 'the calibration is still recorded'].map(noneRecorded)).toEqual([true, true, false]);
    let told = 0;
    const off = calibProgress.subscribe(() => told++);
    topic.send(recording);
    const seen = calibProgress.get();
    expect(seen?.phase).toBe('recording');
    expect(calibProgress.get()).toBe(seen);
    calibLeftOver();
    expect(calibProgress.get()).toBeNull();
    // the same retained one again after a reconnect
    topic.send(recording);
    expect(calibProgress.get()).toBeNull();
    topic.send(JSON.stringify({phase: 'done', mode: 'joystick', m: 0, turns: 0, runs: 0}));
    expect(calibProgress.get()?.phase).toBe('done');
    // a new start of this app counts its first message, also the same text
    topic.send(recording);
    calibLeftOver();
    await calibStart('joystick');
    expect(calibProgress.get()?.phase).toBe('recording');
    expect(told).toBe(7);
    off();
  });

  it('is left to the builds that have it', async () => {
    vi.stubEnv('APP_CALIBRATION', '');
    vi.resetModules();
    const release = await import('./calibration');
    expect(release.canCalibrate(new Set(['planner.calib.start']))).toBe(false);
    expect([new Set(['planner.calib.start']), undefined].map(release.calibMissing)).toEqual(['build', 'build']);
    vi.stubEnv('APP_CALIBRATION', '1');
  });

  it("knows whether the receiver has its fix while it's recorded, a planner that doesn't tell says nothing", () => {
    const rtk = (extra: object) => readProgress(JSON.stringify({phase: 'recording', m: 0, turns: 0, runs: 0, ...extra}))!.rtk;
    expect(rtk({rtk: {fixed: true, accuracy: 0.021}})).toEqual({fixed: true, accuracy: 0.021});
    expect(rtk({rtk: {fixed: false, accuracy: 0.31}})).toEqual({fixed: false, accuracy: 0.31});
    // nothing from the receiver yet: no fix either
    expect(rtk({rtk: null})).toEqual({fixed: false, accuracy: null});
    expect(rtk({})).toBeNull();
  });

  it("puts the planner's words into a text to translate, the numbers in the reader's format", () => {
    expect(calibText('too few straight runs: 2 of 4 (5 m at least), 12.4 of 20 m')).toBe('Too few straight runs: 2 of 4 (each 5 m at least), 12.4 of 20 m.');
    expect(calibText('the IMU sits tilted: roll 0.3 deg, pitch 4.5 deg (OpenMower has no setting for it)')).toBe(
      'The IMU sits tilted: 0.3° to the side, 4.5° forward. Just a note, OpenMower has no setting for it.',
    );
    expect(
      calibText('left/right: the right wheel is in effect 2.4 % smaller (diameter, wear, dirt), straight on the odometry it turns right; OpenMower has one ticks_per_m for both'),
    ).toBe('Left and right: the right wheel is in effect 2.4 % smaller (tyre, wear, dirt), the mower pulls to the right. OpenMower has one value for both, nothing to set for it.');
    expect(calibText('large change from 0.3556: 6.2 %')).toBe('Big change from 0.3556: 6.2 %.');
    expect(calibText('RTK fixed, but 0.081 m accuracy (0.05 m at most)')).toBe('RTK fix, but only accurate to 0.081 m (0.05 m at most).');
    expect(calibText('left/right: the left wheel is in effect 2.1 % smaller (diameter, wear, dirt): 1846 and 1808 ticks/m left and right; OpenMower has one ticks_per_m for both')).toBe(
      'Left and right: the left wheel is in effect 2.1 % smaller (tyre, wear, dirt), the mower pulls to the left. OpenMower has one value for both, nothing to set for it.',
    );
    expect(calibText('no wheel ticks recorded: the wheel distance comes only from them')).toBe('No wheel ticks recorded: the wheel distance comes only from them.');
    expect(calibText('something new')).toBe('something new');
  });
});
