import {describe, expect, it} from 'vitest';
import type {MapArea} from '@/hooks/useMowerMap';
import {nestedAreas, nestedIn} from './mowAround';

const area = (id: string, x0: number, y0: number, x1: number, y1: number, properties: Partial<MapArea['properties']> = {}): MapArea =>
  ({
    id,
    properties: {type: 'mow', ...properties},
    outline: [
      {x: x0, y: y0},
      {x: x1, y: y0},
      {x: x1, y: y1},
      {x: x0, y: y1},
    ],
  }) as MapArea;

describe('areas inside areas', () => {
  const lawn = area('lawn', 0, 0, 10, 10);
  it('a smaller mowing area inside is nested, it gets its own plan', () => {
    expect(nestedIn(area('bed', 2, 2, 4, 4), lawn)).toBe(true);
    // 90 % inside is enough
    expect(nestedIn(area('edge', 9.1, 2, 10.1, 4), lawn)).toBe(true);
  });
  it('not one next to it, a bigger one, an inactive one or one not to mow', () => {
    expect(nestedIn(area('next', 10, 0, 14, 10), lawn)).toBe(false);
    expect(nestedIn(area('half', 8, 2, 12, 4), lawn)).toBe(false);
    expect(nestedIn(area('big', -1, -1, 11, 11), lawn)).toBe(false);
    expect(nestedIn(area('off', 2, 2, 4, 4, {active: false}), lawn)).toBe(false);
    expect(nestedIn(area('skip', 2, 2, 4, 4, {mowable: false}), lawn)).toBe(false);
    expect(nestedIn(area('stone', 2, 2, 4, 4, {type: 'obstacle'}), lawn)).toBe(false);
  });
  it('lists the outlines of the nested ones', () => {
    const bed = area('bed', 2, 2, 4, 4);
    expect(nestedAreas(lawn, [lawn, bed, area('next', 10, 0, 14, 10)])).toEqual([bed.outline]);
  });
});
