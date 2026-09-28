import {describe, expect, it} from 'vitest';
import {splitPlan, type PlanPath} from './planProgress';

const line = (y: number, n: number): PlanPath => ({
  outline: false,
  // a straight line of n + 1 poses, simplified to its ends
  points: [
    {x: 0, y},
    {x: n, y},
  ],
  index: [0, n],
});

describe('splitPlan', () => {
  it('splits the current path at the pose the mower is at', () => {
    const r = splitPlan([line(0, 10), line(1, 10), line(2, 10)], 1, 4);
    expect(r.done).toHaveLength(2);
    expect(r.todo).toHaveLength(2);
    expect(r.done[1].at(-1)).toEqual({x: 4, y: 1});
    expect(r.todo[0][0]).toEqual({x: 4, y: 1});
    expect(r.fraction).toBeCloseTo(14 / 30);
  });

  it('is all to do before the first pose and all done after the last', () => {
    expect(splitPlan([line(0, 10)], 0, 0).fraction).toBe(0);
    expect(splitPlan([line(0, 10)], 0, 10).fraction).toBe(1);
    expect(splitPlan([line(0, 10)], 1, 0).fraction).toBe(1);
  });
});
