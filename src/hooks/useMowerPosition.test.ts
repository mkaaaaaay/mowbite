import {describe, expect, it} from 'vitest';
import {glidePose} from './useMowerPosition';

describe('glidePose', () => {
  it('keeps the pose of a mower standing with its heading drifting, and follows one that drives off', () => {
    // in the dock: the heading drifts by a degree a second, poses every 150 ms
    const shown = Array.from({length: 40}, (_, i) => glidePose({x: 1, y: 2, heading: (i * 0.15 * Math.PI) / 180}, i * 150));
    // after a second only a new heading every 2 degrees, the poses between keep the last one
    const changes = shown.slice(7).filter((p, i, all) => i > 0 && p.heading !== all[i - 1].heading);
    expect(changes.length).toBeLessThanOrEqual(3);
    // driving at 0.3 m/s it gets every pose as it is
    const driving = Array.from({length: 10}, (_, i) => ({x: 1 + (i + 1) * 0.045, y: 2, heading: 0}));
    driving.forEach((p, i) => expect(glidePose(p, 6000 + i * 150)).toBe(p));
  });
});
