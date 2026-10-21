import {describe, expect, it, vi} from 'vitest';
import polygonClipping from 'polygon-clipping';
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

  it('drops slivers left over, too narrow or too small to be an area', () => {
    // a 5 cm strip along the edge, 0.3 m² but no area to mow
    const strip = subtractOutline(rect(0, 0, 10, 6), rect(0.05, -1, 3, 7));
    expect(strip && areas(strip.pieces)).toEqual([42]);
    expect(strip?.dropped).toBe(1);
    // a 40 cm corner, wide enough but only 0.16 m²
    const path = [{x: -1, y: 0.4}, {x: 0.4, y: 0.4}, {x: 0.4, y: -1}, {x: 3, y: -1}, {x: 3, y: 7}, {x: -1, y: 7}];
    const corner = subtractOutline(rect(0, 0, 10, 6), path);
    expect(corner && areas(corner.pieces)).toEqual([42]);
    expect(corner?.dropped).toBe(1);
    // 12 cm wide and 0.72 m² stays
    const kept = subtractOutline(rect(0, 0, 10, 6), rect(0.12, -1, 3, 7));
    expect(kept && areas(kept.pieces)).toEqual([42, 0.72]);
    expect(kept?.dropped).toBe(0);
    // a 6 cm strip 5 m long with a 35 cm blob at its end, 0.42 m² but only the blob is wide enough
    const around = [
      {x: -1, y: 7},
      {x: -1, y: 0.06},
      {x: 5, y: 0.06},
      {x: 5, y: 0.35},
      {x: 5.35, y: 0.35},
      {x: 5.35, y: -1},
      {x: 5.5, y: -1},
      {x: 5.5, y: 7},
    ];
    const lollipop = subtractOutline(rect(0, 0, 10, 6), around);
    expect(lollipop && areas(lollipop.pieces)).toEqual([27]);
    expect(lollipop?.dropped).toBe(1);
  });

  it("doesn't count crumbs of the computing as slivers", () => {
    // 1 mm along the edge, 0.006 m²
    const r = subtractOutline(rect(0, 0, 10, 6), rect(0.001, -1, 3, 7));
    expect(r && areas(r.pieces)).toEqual([42]);
    expect(r?.dropped).toBe(0);
  });

  it('keeps the biggest piece even when it is small or narrow', () => {
    // a path over a 40 cm post
    const post = subtractOutline(rect(0, 0, 0.4, 0.4), rect(-1, 0.3, 2, 1));
    expect(post && areas(post.pieces)).toEqual([0.12]);
    expect(post?.dropped).toBe(0);
    // all that's left of a way is a 6 cm strip
    const strip = subtractOutline(rect(0, 0, 5, 0.5), rect(0.06, -1, 6, 1));
    expect(strip && areas(strip.pieces)).toEqual([0.03]);
    expect(strip?.dropped).toBe(0);
  });

  it("says so when the outlines can't be worked with, not that they don't overlap", () => {
    const spy = vi.spyOn(polygonClipping, 'difference').mockImplementation(() => {
      throw new Error('Unable to complete output ring');
    });
    try {
      expect(subtractOutline(rect(0, 0, 10, 6), rect(3, -1, 5, 7))).toEqual({pieces: [], cut: 0, dropped: 0, failed: true});
    } finally {
      spy.mockRestore();
    }
  });
  it('keeps every piece of an obstacle, a path through a post leaves both halves', () => {
    const post = rect(0, 0, 0.4, 0.4);
    const path = rect(0.15, -1, 0.25, 3);
    const out = subtractOutline(post, path, false)!;
    expect(out.pieces).toHaveLength(2);
    expect(out.dropped).toBe(0);
  });
});
