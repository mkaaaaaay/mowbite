import {describe, expect, it} from 'vitest';
import {autoPasses, longestEdgeAngle, minWidthAngle, plannerEstimate, scanLanes, type PlannerEstimateInput} from './plannerEstimate';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  {x: x0, y: y0},
  {x: x1, y: y0},
  {x: x1, y: y1},
  {x: x0, y: y1},
];

const base: PlannerEstimateInput = {
  outline: rect(0, 0, 10, 6),
  holes: [],
  spacing: 0.14,
  bladeWidth: 0.18,
  perimeterOffset: 0,
  passes: 3,
  overlapPasses: 1,
  angle: 0,
  strategy: 'longest_edge',
  angleOffset: 0,
  angleStep: (5 * Math.PI) / 180,
  fillPattern: 'lanes',
  crosshatchAngle: Math.PI / 2,
  minLaneLength: 0.1,
};

describe('estimate like the MowBite Planner', () => {
  it('spreads the rows evenly between the edges of what the lanes fill, at most a spacing apart', () => {
    const plan = plannerEstimate(base)!;
    // 3 passes, the lanes reach under one of them: the lanes fill the area shrunk by 2 spacings
    const ys = [...new Set(plan.stripes.map(([p]) => +p.y.toFixed(6)))].sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(0.28 + 1e-4, 6);
    expect(ys.at(-1)).toBeCloseTo(6 - 0.28 - 1e-4, 6);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(0.14 + 1e-9);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1e-5);
    // the lanes run from edge to edge of that region, one a row
    expect(plan.stripes).toHaveLength(ys.length);
    expect(Math.min(...plan.stripes.map(([p, q]) => Math.min(p.x, q.x)))).toBeCloseTo(0.28, 6);
    // three passes around the outline, closed rings
    expect(plan.loops).toHaveLength(3);
    expect(plan.loops[0][0]).toEqual(plan.loops[0].at(-1));
  });

  it('crosshatch adds lanes across, rings has no lanes', () => {
    const cross = plannerEstimate({...base, fillPattern: 'crosshatch'})!;
    const vertical = cross.stripes.filter(([p, q]) => Math.abs(p.x - q.x) < 1e-9);
    expect(vertical.length).toBeGreaterThan(30);
    const rings = plannerEstimate({...base, fillPattern: 'concentric'})!;
    expect(rings.stripes).toHaveLength(0);
    expect(rings.loops.length).toBeGreaterThan(15);
  });

  it('obstacles get passes of their own and split the rows', () => {
    const plan = plannerEstimate({...base, holes: [rect(4, 2, 6, 4)]})!;
    expect(plan.loops).toHaveLength(6);
    const nearest = plan.stripes.reduce((b, [p]) => (Math.abs(p.y - 3) < Math.abs(b - 3) ? p.y : b), Infinity);
    expect(plan.stripes.filter(([p]) => Math.abs(p.y - nearest) < 1e-9)).toHaveLength(2);
  });

  it('collision mode: the first pass keeps the distance to the edge, the passes round an obstacle its own', () => {
    const minX = (l: {x: number}[]) => Math.min(...l.map((p) => p.x));
    expect(Math.min(...plannerEstimate(base)!.loops.map(minX))).toBeCloseTo(0, 6);
    expect(Math.min(...plannerEstimate({...base, edgeMargin: 0.2})!.loops.map(minX))).toBeCloseTo(0.2, 6);
    // the pass closest to the obstacle (its left side at x 4)
    const closest = (input: PlannerEstimateInput) =>
      Math.max(
        ...plannerEstimate(input)!
          .loops.filter((l) => minX(l) > 3 && Math.max(...l.map((p) => p.x)) < 7)
          .map(minX),
      );
    expect(closest({...base, holes: [rect(4, 2, 6, 4)]})).toBeCloseTo(4, 3);
    expect(closest({...base, holes: [rect(4, 2, 6, 4)], holeMargins: [0.3]})).toBeCloseTo(3.7, 3);
    // a hole without a margin of its own stays as it is
    expect(closest({...base, holes: [rect(4, 2, 6, 4)], holeMargins: [undefined]})).toBeCloseTo(4, 3);
  });

  it('works the direction out like the planner', () => {
    const tilted = rect(0, 0, 12, 3).map((p) => ({x: p.x * Math.cos(0.5) - p.y * Math.sin(0.5), y: p.x * Math.sin(0.5) + p.y * Math.cos(0.5)}));
    expect(Math.abs(Math.sin(longestEdgeAngle(tilted) - 0.5))).toBeLessThan(1e-9);
    expect(Math.abs(Math.sin(minWidthAngle(tilted) - 0.5))).toBeLessThan(1e-9);
    const auto = plannerEstimate({...base, outline: tilted, angle: null, strategy: 'optimal'})!;
    expect(Math.abs(Math.sin(auto.angle - 0.5))).toBeLessThan(0.05);
    // a fixed direction with the planner's own offset, kept in a range
    expect(plannerEstimate({...base, angle: 0.2, angleOffset: 0.1})!.angle).toBeCloseTo(0.3);
    expect(plannerEstimate({...base, angle: 1.2, angleMin: 0.1, angleMax: 0.5})!.angle).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('leaves out lane pieces shorter than the shortest lane', () => {
    const rows = scanLanes([rect(0, 0, 0.05, 1)], 0, 0.14, 0.1);
    expect(rows.flat()).toHaveLength(0);
  });

  it('narrow parts: the passes go on in there, the lanes only where a U-turn fits', () => {
    // a lawn with a 0.8 m path off it
    const outline = [
      {x: 0, y: 0},
      {x: 6, y: 0},
      {x: 6, y: 4},
      {x: 3.4, y: 4},
      {x: 3.4, y: 9},
      {x: 2.6, y: 9},
      {x: 2.6, y: 4},
      {x: 0, y: 4},
    ];
    const lanes = plannerEstimate({...base, outline, narrowParts: 'lanes', turnRadius: 0.25, laneOrder: 'skip'})!;
    const loops = plannerEstimate({...base, outline, narrowParts: 'loops', turnRadius: 0.25, laneOrder: 'skip'})!;
    const inPath = (plan: typeof lanes) => plan.stripes.filter(([a, b]) => a.y > 4.5 && b.y > 4.5).length;
    expect(inPath(lanes)).toBeGreaterThan(0);
    expect(inPath(loops)).toBe(0);
    expect(loops.loops.length).toBeGreaterThan(lanes.loops.length);
  });

  it('the body: lane ends come back until it fits, the blade ahead moves the lanes back', () => {
    // no passes the lanes don't reach under: the lanes go right to the edge
    const opts = {...base, passes: 1, overlapPasses: 1, turnRadius: 0.25, laneOrder: 'skip', bladeAhead: 0.17, start: {x: 0, y: 3, heading: 0}};
    const plain = plannerEstimate(opts)!;
    // walls: nothing of the body past the outline (and the tolerance)
    const body = plannerEstimate({...opts, body: {width: 0.4, front: 0.43, rear: 0.14, recorded: false, drivable: [], keepOut: [], tolerance: 0.05}})!;
    const sticksOut = (plan: typeof plain) =>
      plan.stripes.some(([a, b]) => {
        const yaw = Math.atan2(b.y - a.y, b.x - a.x);
        return [a, b].some((p) =>
          [
            [0.43, 0.2],
            [0.43, -0.2],
            [-0.14, 0.2],
            [-0.14, -0.2],
          ].some(([dx, dy]) => {
            const x = p.x + Math.cos(yaw) * dx - Math.sin(yaw) * dy;
            const y = p.y + Math.sin(yaw) * dx + Math.cos(yaw) * dy;
            return x < -0.05 - 1e-6 || x > 10.05 + 1e-6 || y < -0.05 - 1e-6 || y > 6.05 + 1e-6;
          }),
        );
      });
    expect(body.stripes.length).toBeGreaterThan(0);
    expect(sticksOut(plain)).toBe(true);
    expect(sticksOut(body)).toBe(false);
    // the lanes alternate, each the other way than the one before
    const dir = body.stripes.map(([a, b]) => Math.sign(b.x - a.x));
    expect(dir.slice(1).every((d, i) => d === -dir[i])).toBe(true);
  });

  it('another angle moves the lanes, the passes stay', () => {
    const a = plannerEstimate({...base, angle: 0.3})!;
    const b = plannerEstimate({...base, angle: 0.6})!;
    expect(b.loops).toBe(a.loops);
    expect(b.stripes).not.toEqual(a.stripes);
  });

  it('outline passes -1: as many as the turns at the lane ends need, like the planner', () => {
    const body = {width: 0.4, front: 0.43, rear: 0.14, recorded: true, drivable: [], keepOut: [], tolerance: 0.05};
    // the planner's PlannerConfig.passes for these: hypot(0.25 + 0.2, 0.43) = 0.622, less 0.25 allowed: 0.372 from the
    // edge, 0.17 ahead, less half the blade twice: (0.452 - 0.09) / 0.14 -> 3 + 1
    const input = {...base, passes: -1, turnRadius: 0.25, bladeAhead: 0.17, body};
    expect(autoPasses(input, 0.18)).toBe(4);
    expect(plannerEstimate(input)!.chosen).toEqual({lane_spacing: 0.14, perimeter_passes: 4, mode: 'fixed'});
    // without the body: the turn's radius
    expect(autoPasses({...input, body: undefined}, 0.18)).toBe(3);
  });
});

