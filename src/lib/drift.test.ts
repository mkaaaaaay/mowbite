import {describe, expect, it} from 'vitest';
import {DRIFT_MIN, headingDrift} from './drift';

const deg = Math.PI / 180;
// 6.7 samples a second like position/json, a little noise on the heading
const stand = (seconds: number, at: (t: number) => number) =>
  Array.from({length: Math.round(seconds / 0.15)}, (_, i) => ({t: i * 0.15, heading: at(i * 0.15) + 0.002 * Math.sin(i * 2.3)}));

describe('the heading running away while it stands', () => {
  it('a wrong gyro zero: −3.6°/s (the NX60i on 04.11.)', () => {
    const d = headingDrift(stand(10, (t) => 2.864 - 3.6 * deg * t))!;
    expect(d.drift).toBe(true);
    expect(d.rate / deg).toBeCloseTo(-3.6, 1);
  });

  it('across ±180°', () => {
    const d = headingDrift(stand(10, (t) => Math.atan2(Math.sin(3.1 + 2 * deg * t), Math.cos(3.1 + 2 * deg * t))))!;
    expect(d.drift).toBe(true);
    expect(d.rate / deg).toBeCloseTo(2, 1);
  });

  it('none with a good zero (−0.16°/min) and none from a single step', () => {
    expect(headingDrift(stand(10, (t) => 1 - (0.16 / 60) * deg * t))!.drift).toBe(false);
    // the filter's first gps fix turns it once by 20°
    const step = headingDrift(stand(10, (t) => (t > 5 ? 20 * deg : 0)))!;
    expect(step.drift).toBe(false);
    expect(Math.abs(step.rate)).toBeGreaterThan(DRIFT_MIN);
  });

  it('only from 8 s of standing on', () => {
    expect(headingDrift(stand(6, (t) => -3.6 * deg * t))).toBeNull();
  });
});
