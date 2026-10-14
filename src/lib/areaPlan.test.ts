import {describe, expect, it} from 'vitest';
import {readChecks, readPlan} from './areaPlan';

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
