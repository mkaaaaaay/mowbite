import {describe, expect, it, vi} from 'vitest';

vi.mock('./mqttClient', () => ({topicStore: () => ({subscribe: () => () => {}, get: () => null, initial: () => null})}));
vi.mock('./rpc', () => ({callRpc: async () => ({})}));
vi.mock('./autoUpdate', () => ({requestCalib: async () => {}, requestCalibBack: async () => {}}));

const {calibLines, changeOf, missing, preselected, readLast, readPaths, readProgress, readResult, readState} = await import('./calibration');

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
    expect(readLast('1793700000 ll/services/diff_drive/wheel_distance_m 0.3556 0.3612 xbot_positioning/antenna_offset_x -0.10 -0.12')).toEqual({
      at: 1793700000,
      values: [
        {path: 'll/services/diff_drive/wheel_distance_m', old: 0.3556, new: 0.3612},
        {path: 'xbot_positioning/antenna_offset_x', old: -0.1, new: -0.12},
      ],
    });
    expect(readLast('')).toBeNull();
  });

  it('says what a recording still lacks, each way when the planner counts them so', () => {
    const p = readProgress(JSON.stringify({phase: 'recording', m: 12.4, turns: {left: 3, right: 1}, runs: 2, ready: false}))!;
    expect(missing(p, 'joystick')).toEqual([
      {what: 'm', left: 8},
      {what: 'runs', left: 2},
      {what: 'right', left: 2},
    ]);
    expect(missing({...p, m: 20, runs: 4, turns: {left: 3, right: 3}}, 'joystick')).toEqual([]);
    expect(missing({...p, m: 60, runs: 9, turns: 30}, 'mow')).toEqual([{what: 'turns', left: 10}]);
    expect(readProgress('no json')).toBeNull();
  });
});
