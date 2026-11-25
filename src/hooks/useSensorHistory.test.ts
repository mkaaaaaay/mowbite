import {describe, expect, it} from 'vitest';
import {addOsHistory} from './useSensorHistory';

const H = 3600;
const answer = (from: number, points: unknown[], step = 300) => ({step, from, to: from + H, truncated: false, sensors: [{sensor_id: 'v', points}]});

describe("MowBite OS's sensor history", () => {
  it('takes [t, min, avg, max] per step and leaves out what is no point', () => {
    const got = addOsHistory({}, 300000, answer(1000 * H, [[1000 * H, 1, 2, 3], [1000 * H + 300, null, 2, 3], 'x']), 1000 * H * 1000);
    expect(got).toEqual({v: [{t: 1000 * H * 1000, v: 2, lo: 1, hi: 3}]});
  });

  it('asked again from its newest step on: that one comes anew, older ones stay within 48 h', () => {
    const now = 1000 * H;
    const known = {v: [{t: (now - 49 * H) * 1000, v: 1}, {t: (now - 600) * 1000, v: 1}, {t: (now - 300) * 1000, v: 1}], w: [{t: (now - 600) * 1000, v: 5}]};
    const got = addOsHistory(known, 300000, answer(now - 300, [[now - 300, 1, 4, 6], [now, 2, 3, 4]]), now * 1000);
    expect(got.v.map((s) => [s.t / 1000 - now, s.v])).toEqual([[-600, 1], [-300, 4], [0, 3]]);
    expect(got.w).toHaveLength(1);
  });

  it('starts anew with another step', () => {
    const got = addOsHistory({w: [{t: 0, v: 5}]}, 300000, answer(1000 * H, [], 900), 1000 * H * 1000);
    expect(got).toEqual({v: []});
  });

  it("files a sensor under OpenMower's id, also by its own key", () => {
    const h = {...answer(H, [[H, 1, 2, 3]]), sensors: [{sensor_id: 'blade_rpm', key: 'blade_rpm', points: [[H, 1, 2, 3]]}]};
    expect(Object.keys(addOsHistory({}, 300000, h, H * 1000))).toEqual(['om_mow_motor_rpm']);
  });
});
