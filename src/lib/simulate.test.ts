import {afterEach, describe, expect, it, vi} from 'vitest';
import {createSimClock, framesUntil, poseAt, readSimulation, type SimFrame} from './simulate';

const frames: SimFrame[] = [
  [0, 0, 0, 0, 0],
  [2, 0, 0, 0, 1],
  [4, 2, 0, 3, 1],
  [6, 2, 2, -3, 0],
];

describe('readSimulation', () => {
  it('reads what the planner answers', () => {
    const r = readSimulation({
      duration: {min: 10.4, mow_min: 10.3, model_min: 10.9},
      driven_m: 154.7,
      mowed_m2: 26.9,
      left_m2: 0.4,
      planned_left_m2: 0.1,
      left: [{m2: 0.3, outline: [[0, 0], [1, 0], [1, 1]]}, {m2: 0.1, outline: [[0, 0]]}],
      body: {places: [[1, 2, 0.035], [3, 4]], worst: 0.035},
      nav_errors: [[5, 6], 'x'],
      aborted: false,
      tracking: {lane: {p50: 0.018, p95: 0.037, max: 0.047}, turn: {p50: 0.013, p95: 0.037, max: 0.052}, estimate: {p50: 0.03, p95: 0.06, max: 0.2}},
      spins: 7,
      playback: [...frames, [7, 1], 'nope'],
    });
    expect(r.minutes).toEqual({all: 10.4, mow: 10.3, plan: 10.9});
    expect(r.left).toEqual([{m2: 0.3, outline: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}]}]);
    expect(r.touches).toEqual([{x: 1, y: 2, m: 0.035}, {x: 3, y: 4, m: 0}]);
    expect(r.navErrors).toEqual([{x: 5, y: 6}]);
    // the lanes' usual distance, the most anywhere it drove (not the position estimate's error)
    expect(r.offPlan).toEqual({usual: 0.018, p95: 0.037, max: 0.052});
    expect(r.frames).toEqual(frames);
    expect(r.spins).toBe(7);
  });

  it('takes an answer with things missing', () => {
    const r = readSimulation({});
    expect(r.minutes.all).toBe(0);
    expect(r.left).toEqual([]);
    expect(r.offPlan).toBeUndefined();
    expect(r.frames).toEqual([]);
  });
});

describe('poseAt', () => {
  it('goes between the frames around the time', () => {
    expect(poseAt(frames, 3)).toEqual({x: 1, y: 0, heading: 1.5});
    expect(poseAt(frames, -1)).toEqual({x: 0, y: 0, heading: 0});
    expect(poseAt(frames, 99)).toEqual({x: 2, y: 2, heading: -3});
    expect(poseAt([], 1)).toBeNull();
  });

  it('turns the short way across half a turn', () => {
    const h = poseAt(frames, 5)!.heading;
    // from 3 to -3 rad is 0.28 rad across pi, not 6 rad back round
    expect(Math.abs(Math.abs(h) - Math.PI)).toBeLessThan(0.01);
  });

  it('counts the frames up to a time', () => {
    expect(framesUntil(frames, -1)).toBe(0);
    expect(framesUntil(frames, 0)).toBe(1);
    expect(framesUntil(frames, 4)).toBe(3);
    expect(framesUntil(frames, 5)).toBe(3);
    expect(framesUntil(frames, 6)).toBe(4);
  });
});

describe('the clock of a drive played back', () => {
  afterEach(() => vi.restoreAllMocks());
  let now = 0;
  const at = (ms: number) => {
    now = ms;
  };

  it('plays at its speed, pauses, goes to a time and starts over at the end', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    at(1000);
    const clock = createSimClock(frames);
    const heard = vi.fn();
    clock.listen(heard);
    expect(clock.end).toBe(6);
    expect(clock.still(now)).toBe(true);
    clock.setSpeed(2);
    clock.play();
    expect(heard).toHaveBeenCalledTimes(2);
    at(2000);
    expect(clock.time()).toBe(2);
    expect(clock.still(now)).toBe(false);
    clock.pause();
    at(9000);
    expect(clock.time()).toBe(2);
    expect(clock.snapshot().playing).toBe(false);
    clock.seek(5);
    clock.play();
    at(12000);
    // at the end it stays there
    expect(clock.time()).toBe(6);
    expect(clock.still(now)).toBe(true);
    expect(clock.at(now)).toEqual({x: 2, y: 2, heading: -3});
    clock.play();
    expect(clock.time()).toBe(0);
  });
});
