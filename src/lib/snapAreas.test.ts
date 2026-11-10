import {describe, expect, it} from 'vitest';
import {crossesItself, layAgainst, movingOf, nearestOnOutline, snapPoint} from './snapAreas';

const pts = (list: [number, number][]) => list.map(([x, y]) => ({x, y}));

// a lawn with a wavy edge at the top
const lawn = pts([
  [0, 0],
  [10, 0],
  [10, 5],
  [8, 5.3],
  [6, 4.8],
  [4, 5.2],
  [2, 4.9],
  [0, 5],
]);

describe('snapPoint', () => {
  it('takes a corner within reach before an edge', () => {
    expect(snapPoint({x: 8.1, y: 5.45}, [lawn], 0.3)).toEqual({x: 8, y: 5.3, corner: true});
  });

  it('puts the point onto the nearest edge', () => {
    const s = snapPoint({x: 5, y: -0.2}, [lawn], 0.3);
    expect(s?.corner).toBe(false);
    expect(s?.x).toBeCloseTo(5, 9);
    expect(s?.y).toBeCloseTo(0, 9);
  });

  it('leaves a point further away', () => {
    expect(snapPoint({x: 5, y: 2}, [lawn], 0.3)).toBeNull();
  });
});

describe('layAgainst', () => {
  const path = pts([
    [0, 5.4],
    [10, 5.4],
    [10, 7],
    [0, 7],
  ]);

  it("takes over the other's edge between its close corners, no gap left", () => {
    const laid = layAgainst(path, lawn, 0.5)!;
    expect(laid.valid).toBe(true);
    expect(laid.moved).toBe(2);
    expect(laid.taken).toBe(4);
    // every point of the shared stretch is a point of the lawn
    for (const p of laid.outline.filter((q) => q.y < 6)) expect(lawn).toContainEqual(p);
    // and the far side stays
    expect(laid.outline).toContainEqual({x: 10, y: 7});
    expect(laid.outline).toContainEqual({x: 0, y: 7});
  });

  it('pulls corners lying over the other one back onto its edge', () => {
    const over = pts([
      [3, 4.5],
      [5, 4.6],
      [5, 6],
      [3, 6],
    ]);
    const laid = layAgainst(over, lawn, 0.8)!;
    expect(laid.valid).toBe(true);
    for (const p of laid.outline.filter((q) => q.y < 5.5)) expect(nearestOnOutline(lawn, p)!.d).toBeLessThan(1e-9);
  });

  it('does nothing when no corner is close, or every one is', () => {
    expect(layAgainst(path, lawn, 0.2)).toBeNull();
    const thin = pts([
      [2, 5.3],
      [6, 5.3],
      [6, 5.4],
      [2, 5.4],
    ]);
    expect(layAgainst(thin, lawn, 0.8)).toBeNull();
  });
});

describe('crossesItself', () => {
  it('finds a figure of eight', () => {
    expect(
      crossesItself(
        pts([
          [0, 0],
          [2, 2],
          [2, 0],
          [0, 2],
        ]),
      ),
    ).toBe(true);
    expect(crossesItself(lawn)).toBe(false);
  });
});

describe('movingOf', () => {
  const area = (type: string) => ({properties: {type}});
  it('keeps a mowing area as it is, unless both are', () => {
    const [mow, nav, obstacle, mow2] = [area('mow'), area('nav'), area('obstacle'), area('mow')];
    expect(movingOf(mow, nav)).toEqual([nav, mow]);
    expect(movingOf(nav, mow)).toEqual([nav, mow]);
    expect(movingOf(obstacle, nav)).toEqual([obstacle, nav]);
    expect(movingOf(mow, mow2)).toEqual([mow, mow2]);
  });
});
