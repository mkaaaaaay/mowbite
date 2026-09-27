import {describe, expect, it} from 'vitest';
import {stripeAngleDiff} from './mowDirection';
import {autoMowAngle} from './mowStripes';

describe('autoMowAngle', () => {
  it('points from the first outline point to the first one more than 2 m away, like the mower', () => {
    const outline = [
      {x: 0, y: 0},
      {x: 1, y: 1},
      {x: 0, y: 3},
      {x: 5, y: 5},
    ];
    expect(autoMowAngle(outline)).toBeCloseTo(Math.PI / 2);
    expect(autoMowAngle([{x: 0, y: 0}, {x: 1, y: 0}])).toBe(0);
  });
});

describe('stripeAngleDiff', () => {
  it('treats stripes as having no front', () => {
    expect(stripeAngleDiff(10, 170)).toBe(-20);
    expect(stripeAngleDiff(170, 10)).toBe(20);
    expect(stripeAngleDiff(0, 90)).toBe(-90);
  });
});
