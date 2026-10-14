import {describe, expect, it} from 'vitest';
import {readLeftovers} from './leftovers';

describe('readLeftovers', () => {
  it('sums what every area has left and keeps the messages', () => {
    const r = readLeftovers({
      file: 'track_7.bin',
      armed: 0,
      areas: {
        a: {paths: [{}, {}], left_m2: 0.07, stats: {leftovers: {left_m2: 0.07, pieces: 1, passes: 2}}},
        b: {paths: [], message: 'nothing left', stats: {leftovers: {left_m2: 0, pieces: 0, passes: 0}}},
        c: {paths: [], message: 'most of the area is left', stats: null},
      },
    });
    expect(r.m2).toBeCloseTo(0.07);
    expect(r.passes).toBe(2);
    expect(r.armed).toBe(0);
    expect(r.file).toBe('track_7.bin');
    expect(r.areas.map((a) => [a.id, a.passes, a.message])).toEqual([
      ['a', 2, undefined],
      ['b', 0, 'nothing left'],
      ['c', 0, 'most of the area is left'],
    ]);
  });

  it('takes an answer with nothing in it', () => {
    expect(readLeftovers({})).toEqual({areas: [], m2: 0, passes: 0, armed: 0});
  });
});
