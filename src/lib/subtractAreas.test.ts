import {describe, expect, it} from 'vitest';
import type {Point} from '@/hooks/useMowerMap';
import {polygonArea} from './geometry';
import {subtractOutline} from './subtractAreas';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  {x: x0, y: y0},
  {x: x1, y: y0},
  {x: x1, y: y1},
  {x: x0, y: y1},
];
const areas = (pieces: Point[][]) => pieces.map((p) => Math.round(polygonArea(p) * 100) / 100);

describe('taking one area out of another', () => {
  it('cuts off the part the other one lies over', () => {
    const r = subtractOutline(rect(0, 0, 10, 6), rect(8, -1, 12, 7));
    expect(r && areas(r.pieces)).toEqual([48]);
    expect(r?.cut).toBe(0);
  });

  it('gives the pieces left on both sides, the biggest first', () => {
    const r = subtractOutline(rect(0, 0, 10, 6), rect(3, -1, 5, 7));
    expect(r && areas(r.pieces)).toEqual([30, 18]);
  });

  it('cuts the rest open through one that lies inside, an area has no holes', () => {
    const r = subtractOutline(rect(0, 0, 10, 6), rect(4, 2, 6, 4));
    expect(r?.cut).toBe(1);
    expect(r?.pieces).toHaveLength(2);
    expect(areas(r!.pieces).reduce((a, b) => a + b, 0)).toBeCloseTo(56, 6);
    // the shortest cut runs across the short side
    expect(r!.pieces.every((p) => p.every((q) => q.x <= 10 && q.x >= 0 && q.y <= 6 && q.y >= 0))).toBe(true);
    expect(areas(r!.pieces)).toEqual([28, 28]);
  });

  it("is null when they don't overlap and leaves nothing when the other one covers it", () => {
    expect(subtractOutline(rect(0, 0, 10, 6), rect(12, 0, 14, 6))).toBeNull();
    expect(subtractOutline(rect(0, 0, 10, 6), rect(10, 0, 14, 6))).toBeNull();
    expect(subtractOutline(rect(0, 0, 10, 6), rect(-1, -1, 11, 7))?.pieces).toEqual([]);
  });
});
