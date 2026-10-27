import {describe, expect, it, vi} from 'vitest';
import type {MowerEvent} from './events';
import {bladeSeconds, saveRate, savedRate, splitPlan, type PlanPath} from './planProgress';

const store = new Map<string, string>();
vi.stubGlobal('window', {});
vi.stubGlobal('localStorage', {getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k)});

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
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.done).toHaveLength(2);
    expect(r.todo).toHaveLength(2);
    expect(r.done[1].at(-1)).toEqual({x: 4, y: 1});
    expect(r.todo[0][0]).toEqual({x: 4, y: 1});
    expect(r.fraction).toBeCloseTo(14 / 30);
  });

  it('is all to do before the first pose and all done after the last', () => {
    expect(splitPlan([line(0, 10)], 0, 0)?.fraction).toBe(0);
    expect(splitPlan([line(0, 10)], 0, 10)?.fraction).toBe(1);
    expect(splitPlan([line(0, 10)], 1, 0)?.fraction).toBe(1);
  });

  it("can't tell without the pose index of the points", () => {
    expect(splitPlan([{...line(0, 10), index: undefined}], 0, 5)).toBeNull();
  });
});

describe('bladeSeconds', () => {
  const ev = (t: number, type: string, more: Partial<MowerEvent> = {}): MowerEvent => ({id: String(t), t, type, job_id: 'j', ...more});

  it('adds up the blade time in the area over the whole job, breaks left out', () => {
    const events = [
      ev(0, 'AREA', {area_id: 'a'}),
      ev(10, 'BLADES', {enabled: true}),
      ev(110, 'BLADES', {enabled: false}),
      // docked to charge, resumed later
      ev(500, 'AREA', {area_id: 'a'}),
      ev(510, 'BLADES', {enabled: true}),
    ];
    expect(bladeSeconds(events, 'a', 560)).toBe(150);
  });

  it('only counts the area asked for and the job it is in', () => {
    const events = [
      ev(0, 'AREA', {area_id: 'old', job_id: 'x'}),
      ev(5, 'BLADES', {enabled: true, job_id: 'x'}),
      ev(100, 'AREA', {area_id: 'a'}),
      ev(110, 'BLADES', {enabled: true}),
      ev(210, 'AREA', {area_id: 'b'}),
    ];
    expect(bladeSeconds(events, 'a', 300)).toBe(100);
    expect(bladeSeconds(events, 'c', 300)).toBe(0);
  });
});

describe('savedRate', () => {
  it("is the mower's own, the demo's isn't kept", () => {
    saveRate(0.3);
    expect(savedRate()).toBe(0.3);
    localStorage.setItem('mower', 'demo');
    expect(savedRate()).toBeNull();
    saveRate(0.45);
    localStorage.removeItem('mower');
    expect(savedRate()).toBe(0.3);
    expect([...store.keys()]).toEqual(['mowRate']);
  });
});
