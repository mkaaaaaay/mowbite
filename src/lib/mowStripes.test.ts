import {describe, expect, it} from 'vitest';
import {stripeAngleDiff} from './mowDirection';
import {autoMowAngle, mowStripes} from './mowStripes';

const square = (x: number, y: number, size: number) => [
  {x, y},
  {x: x + size, y},
  {x: x + size, y: y + size},
  {x, y: y + size},
];

describe('mowStripes', () => {
  it('draws evenly spaced lines in the given direction, inside the area', () => {
    const stripes = mowStripes(square(0, 0, 10), [], 0, 1);
    expect(stripes.length).toBeGreaterThan(5);
    for (const [a, b] of stripes) {
      expect(a.y).toBeCloseTo(b.y);
      expect(Math.min(a.x, b.x)).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.max(a.x, b.x)).toBeLessThanOrEqual(10 + 1e-9);
    }
    const ys = [...new Set(stripes.map(([a]) => a.y.toFixed(6)))].map(Number).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(1);
  });

  it('turns with the angle', () => {
    for (const [a, b] of mowStripes(square(0, 0, 10), [], Math.PI / 2, 1)) expect(a.x).toBeCloseTo(b.x);
  });

  it('leaves out obstacles', () => {
    const through = mowStripes(square(0, 0, 10), [square(4, 4, 2)], 0, 1).filter(([a]) => Math.abs(a.y - 5) < 1e-6);
    expect(through).toHaveLength(2);
  });

  it('gives up on nonsense input', () => {
    expect(mowStripes(square(0, 0, 10), [], 0, 0)).toEqual([]);
    expect(mowStripes([{x: 0, y: 0}], [], 0, 1)).toEqual([]);
  });
});

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
