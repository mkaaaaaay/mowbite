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

  it('follows a slow turn on the spot after standing, and keeps where it turned to', () => {
    for (let i = 0; i < 10; i++) glidePose({x: 5, y: 5, heading: 0}, 10000 + i * 150);
    // a degree every pose
    const turn = Array.from({length: 20}, (_, i) => ({x: 5, y: 5, heading: ((i + 1) * Math.PI) / 180}));
    turn.forEach((p, i) => expect(glidePose(p, 11500 + i * 150)).toBe(p));
    // standing again it keeps the last heading, no step back
    for (let i = 0; i < 12; i++) expect(glidePose({x: 5, y: 5, heading: (20 * Math.PI) / 180}, 14500 + i * 150).heading).toBeCloseTo((20 * Math.PI) / 180, 9);
  });
});
