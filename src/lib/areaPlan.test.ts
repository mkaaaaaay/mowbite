import {describe, expect, it} from 'vitest';
import type {MapArea} from '@/hooks/useMowerMap';
import {areaPlanRequest, planAsker, readChecks, readPlan} from './areaPlan';
import type {MowPlan} from './mowPlan';

describe('readPlan', () => {
  it('reads the planner answer as ROS gives it', () => {
    const pose = (x: number, y: number) => ({pose: {position: {x, y}}});
    const plan = readPlan({
      paths: [
        {is_outline: 1, path: {poses: [pose(0, 0), pose(1, 0), pose(1, 1)]}},
        {is_outline: 0, path: {poses: [pose(0.2, 0.2), pose(0.8, 0.2), pose(0.8, 0.4)]}},
      ],
    });
    expect(plan.loops).toEqual([[{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}]]);
    expect(plan.stripes).toHaveLength(2);
  });

  it('also takes plain point lists', () => {
    const plan = readPlan([{outline: true, points: [[0, 0], [2, 0], [2, 2]]}]);
    expect(plan.loops[0][1]).toEqual({x: 2, y: 0});
  });
});

describe('readChecks', () => {
  it("reads what the planner's collision mode found", () => {
    const plan = readPlan({
      paths: [],
      stats: {
        body_fit: {fixed: 2, left: 1, skipped_m: 1.25, places: [[1, 2, 0], [3, 4, 1.25], ['x']], jumps: [[3, 4]], tries: 3},
        headland_turns: {turns_in_field: 1, places: [[5, 6]], crossings: 0},
      },
      warnings: [
        '2 places driven another way where the body would stick out, 1.2 m of loops and lanes left out there',
        "1 places left out where the body doesn't fit and no other way does, the path jumps over them at (3.00, 4.00)",
        'the area is too narrow somewhere',
        7,
      ],
      body_space: {outlines: [[[0, 0], [4, 0], [4, 3]], [[1, 1]]], holes: [[[1, 1], [2, 1], [2, 2]]]},
    });
    expect(plan.checks).toEqual({
      space: [
        [{x: 0, y: 0}, {x: 4, y: 0}, {x: 4, y: 3}],
        [{x: 1, y: 1}, {x: 2, y: 1}, {x: 2, y: 2}],
      ],
      places: [
        {x: 1, y: 2, m: 0},
        {x: 3, y: 4, m: 1.25},
      ],
      fixed: 2,
      left: 1,
      skipped: 1.25,
      jumps: [{x: 3, y: 4}],
      unchecked: [],
      turns: [{x: 5, y: 6}],
      // the lines for the counts come from the counts
      warnings: ['the area is too narrow somewhere'],
    });
  });

  it('takes where the plan starts or ends without the body checked', () => {
    expect(readChecks({paths: [], stats: {body_fit: {places: [], unchecked: [[1, 2]]}}})?.unchecked).toEqual([{x: 1, y: 2}]);
    expect(readChecks({paths: [], stats: {body_fit: {places: [], unchecked: [5, 6]}}})?.unchecked).toEqual([{x: 5, y: 6}]);
    expect(readChecks({paths: [], stats: {body_fit: {places: []}}})?.unchecked).toEqual([]);
  });

  it('takes where the body would have stuck out, one pose for each place', () => {
    const checks = readChecks({
      paths: [],
      stats: {body_fit: {fixed: 2, left: 0, skipped_m: 0, places: [['x'], [1, 2, 0], [3, 4, 0.5]], poses: [[0, 0, 0, 0], [1.1, 2.1, 0.5, 0.03, 1], 'bad']}},
    });
    expect(checks?.places).toEqual([
      {x: 1, y: 2, m: 0, pose: {x: 1.1, y: 2.1, yaw: 0.5, d: 0.03, spin: true}},
      {x: 3, y: 4, m: 0.5},
    ]);
  });

  it('has nothing from a planner without it', () => {
    expect(readChecks({paths: []})).toBeUndefined();
    expect(readPlan({paths: []}).checks).toBeUndefined();
  });
});

describe('the MowBite Planner answer', () => {
  it('cuts the paths into pieces by their segments, and reads the duration and the zones', () => {
    const plan = readPlan({
      paths: [
        {
          is_outline: false,
          points: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 2], [1, 2]],
          pose_index: [0, 10, 15, 20, 25, 35],
          segments: [
            {type: 'lane', start: 0, end: 10},
            {type: 'turn', start: 10, end: 20},
            {type: 'transit', start: 20, end: 25},
            {type: 'lane', start: 25, end: 35},
          ],
        },
      ],
      duration: {min: 41.5, model_min: 40, factor: 1.04, runs: 3},
      stats: {zones: [{angle: 0.5, lanes: 7, outlines: [[[0, 0], [1, 0], [1, 1]]]}, 'x']},
    });
    expect(plan.pieces?.map((p) => [p.type, p.points.length])).toEqual([
      ['lane', 2],
      ['turn', 3],
      ['transit', 2],
      ['lane', 2],
    ]);
    // the pieces join up: the turn starts where the lane ended
    expect(plan.pieces?.[1].points[0]).toEqual({x: 1, y: 0});
    expect(plan.duration).toEqual({min: 41.5, modelMin: 40, factor: 1.04, runs: 3});
    expect(plan.zones).toEqual([{angle: 0.5, lanes: 7, outlines: [[{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}]]}]);
  });

  it('has no pieces, duration or zones from a planner that does not tell', () => {
    const plan = readPlan({paths: [{is_outline: true, points: [[0, 0], [1, 0], [1, 1]], pose_index: [0, 1, 2]}]});
    expect(plan.pieces).toBeUndefined();
    expect(plan.duration).toBeUndefined();
    expect(plan.zones).toBeUndefined();
  });
});

describe('areaPlanRequest', () => {
  const outline = [{x: 0, y: 0}, {x: 10, y: 0}, {x: 10, y: 5}];
  const hole = [{x: 1, y: 1}, {x: 2, y: 1}, {x: 2, y: 2}];
  const area = (properties: MapArea['properties']): MapArea => ({id: 'a', properties: {type: 'mow', ...properties}, outline});
  const ask = (edited: MapArea['properties'], saved: MapArea['properties'] | undefined, byId = true, planner = true) =>
    areaPlanRequest(area(edited), saved && {type: 'mow', ...saved}, byId, planner, () => [hole]);

  it('asks the MowBite Planner by id with the values as edited on top of the saved ones', () => {
    expect(ask({angle: 1, outline_count: 4, planner: {fill_pattern: 'spiral'}}, {angle: 0.5, planner: {fill_pattern: 'lanes'}})).toEqual({
      area_id: 'a',
      angle: 1,
      outline_count: 4,
      settings: {fill_pattern: 'spiral'},
    });
  });

  it('asks as it is when a saved value was taken out, the planner would keep that one', () => {
    for (const k of ['angle', 'outline_count', 'outline_overlap_count', 'outline_offset'] as const) {
      expect(ask({}, {[k]: 2})).toEqual({outline, obstacles: [hole]});
    }
    expect(ask({}, {angle_min: 0, angle_max: 1})).toEqual({outline, obstacles: [hole]});
    expect(ask({angle_min: 0}, {angle_min: 0, angle_max: 1})).toEqual({outline, obstacles: [hole]});
  });

  it("asks as it is without a strategy taken out for an angle, the strategy for all areas doesn't go along", () => {
    expect(ask({angle: 0.3}, {planner: {angle_strategy: 'optimal'}})).toEqual({outline, obstacles: [hole], angle: 0.3});
    // MowBite OS: a count of its own in place of the planner's
    expect(ask({outline_count: 3, planner: {fill_pattern: 'lanes'}}, {planner: {perimeter_passes: -1, fill_pattern: 'lanes'}})).toEqual({
      outline,
      obstacles: [hole],
      outline_count: 3,
      settings: {fill_pattern: 'lanes'},
    });
  });

  it('asks as it is when moved, and without the MowBite Planner with no planner settings', () => {
    expect(ask({angle: 1}, {angle: 1}, false)).toEqual({outline, obstacles: [hole], angle: 1});
    expect(ask({angle: 1, planner: {fill_pattern: 'spiral'}}, {angle: 1}, true, false)).toEqual({outline, obstacles: [hole], angle: 1});
  });
});

describe('the plans the map asks for, one at a time', () => {
  // the mower answering when the test says, what the map got and what it showed under it
  function mower(known: Record<string, MowPlan | null> = {}) {
    const asked: {key: string; answer: (plan: MowPlan | null) => void; fail: () => void}[] = [];
    const got: [string, MowPlan | null][] = [];
    const shown: {key: string; since: number; hidden: boolean}[] = [];
    const asker = planAsker<{cacheKey: string}>({
      known: (job) => known[job.cacheKey],
      ask: (job) => new Promise((resolve, reject) => asked.push({key: job.cacheKey, answer: resolve, fail: () => reject(new Error('no plan'))})),
      got: (job, plan) => got.push([job.cacheKey, plan]),
      show: (job, since) => {
        const s = {key: job.cacheKey, since, hidden: false};
        shown.push(s);
        return () => (s.hidden = true);
      },
    });
    return {asker, asked, got, shown, keys: () => asked.map((a) => a.key)};
  }
  const job = (cacheKey: string) => ({cacheKey});
  const plan = readPlan([{outline: true, points: [[0, 0], [2, 0], [2, 2]]}]);
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('shows the one the map wants while the same one is worked out ahead, and takes its answer', async () => {
    const m = mower();
    m.asker.prefetch([job('a'), job('b')]);
    m.asker.want(job('a'));
    expect(m.keys()).toEqual(['a']);
    expect(m.shown).toMatchObject([{key: 'a', hidden: false}]);
    m.asked[0].answer(plan);
    await settle();
    expect(m.got).toEqual([['a', plan]]);
    expect(m.shown[0].hidden).toBe(true);
    expect(m.keys()).toEqual(['a', 'b']);
  });

  it('asks for the one the map wants before the rest worked out ahead, shown while one asked before goes', async () => {
    const m = mower();
    m.asker.prefetch([job('a'), job('b')]);
    m.asker.want(job('c'));
    expect(m.keys()).toEqual(['a']);
    expect(m.shown).toMatchObject([{key: 'c', hidden: false}]);
    m.asked[0].answer(plan);
    await settle();
    expect(m.got).toEqual([]);
    expect(m.keys()).toEqual(['a', 'c']);
    m.asked[1].answer(plan);
    await settle();
    expect(m.got).toEqual([['c', plan]]);
    expect(m.shown[0].hidden).toBe(true);
    expect(m.keys()).toEqual(['a', 'c', 'b']);
  });

  it('asks only for the newest one wanted meanwhile, the waiting going on without a gap', async () => {
    const m = mower();
    m.asker.prefetch([job('a')]);
    m.asker.want(job('c'));
    m.asker.want(job('d'));
    expect(m.shown).toMatchObject([
      {key: 'c', hidden: true},
      {key: 'd', hidden: false},
    ]);
    expect(m.shown[1].since).toBe(m.shown[0].since);
    m.asked[0].answer(plan);
    await settle();
    expect(m.keys()).toEqual(['a', 'd']);
  });

  it('waits for the one being asked when the map wants it again', async () => {
    const m = mower();
    m.asker.want(job('a'));
    m.asker.want(job('c'));
    m.asker.want(job('a'));
    m.asked[0].answer(plan);
    await settle();
    expect(m.got).toEqual([['a', plan]]);
    expect(m.keys()).toEqual(['a']);
    expect(m.shown.every((s) => s.hidden)).toBe(true);
  });

  it('ends the waiting with a plan the mower had none for', async () => {
    const m = mower();
    m.asker.want(job('a'));
    m.asked[0].fail();
    await settle();
    expect(m.got).toEqual([['a', null]]);
    expect(m.shown[0].hidden).toBe(true);
  });

  it('takes a plan known already without asking or showing anything', () => {
    const m = mower({k: plan});
    m.asker.want(job('k'));
    expect(m.got).toEqual([['k', plan]]);
    m.asker.prefetch([job('k'), job('b')]);
    expect(m.keys()).toEqual(['b']);
    expect(m.shown).toEqual([]);
  });

  it('shows nothing and leaves out the one waiting once the map wants none, asks for nothing more once left', async () => {
    const m = mower();
    m.asker.prefetch([job('a'), job('b'), job('x')]);
    m.asker.want(job('c'));
    m.asker.want(null);
    expect(m.shown[0].hidden).toBe(true);
    m.asked[0].answer(plan);
    await settle();
    expect(m.keys()).toEqual(['a', 'b']);
    m.asker.stop();
    m.asked[1].answer(plan);
    await settle();
    expect(m.keys()).toEqual(['a', 'b']);
  });
});
