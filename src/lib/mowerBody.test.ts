import type {MapArea} from '@/hooks/useMowerMap';
import {describe, expect, it} from 'vitest';
import {
  bladeSeconds,
  bodyFrom,
  bodyShape,
  grownOutline,
  measuredOutline,
  modelOf,
  MOWER_MODELS,
  OUTLINE_LEEWAY,
  outlineOf,
  realEdges,
  roundBends,
  sizesBody,
  spotPlaces,
  swathAfter,
  swathEnd,
  swathGroups,
  swathPieces,
  type PlannerSettings,
} from './mowerBody';

const settings = (values: Record<string, unknown>): PlannerSettings => ({
  settings: Object.fromEntries(
    Object.entries(values).map(([k, value]) => [k, {value, default: null, stored: true, type: 'number', settable: true}]),
  ),
});

describe('mower body', () => {
  it('needs width, front and rear', () => {
    expect(bodyFrom(null)).toBeNull();
    expect(bodyFrom(settings({robot_width: 0.4, robot_front: 0.43}))).toBeNull();
    expect(bodyFrom(settings({robot_width: 0.4, robot_front: 0.43, robot_rear: null}))).toBeNull();
    expect(bodyFrom(settings({robot_width: 0, robot_front: 0.43, robot_rear: 0.14}))).toBeNull();
    expect(bodyFrom(settings({robot_width: 0.4, robot_front: 0.43, robot_rear: 0.14, mower_width: 0.18, blade_ahead: 0.17}))).toEqual({
      width: 0.4,
      front: 0.43,
      rear: 0.14,
      blade: 0.18,
      bladeAhead: 0.17,
      bladeOffset: 0,
    });
  });

  it('puts the body around the point the mower follows, turned with its heading', () => {
    const b = {width: 0.4, front: 0.43, rear: 0.14, blade: 0.18, bladeAhead: 0.17, bladeOffset: 0.05};
    const east = bodyShape(b, 1, 2, 0);
    expect(east.corners.map((c) => [+c.x.toFixed(6), +c.y.toFixed(6)])).toEqual([
      [1.43, 2.2],
      [0.86, 2.2],
      [0.86, 1.8],
      [1.43, 1.8],
    ]);
    expect(east.blade.x).toBeCloseTo(1.17);
    expect(east.blade.y).toBeCloseTo(2.05); // left of heading east is north
    expect(east.middle.x).toBeCloseTo(1.145);
    // facing north: ahead is +y, left is -x
    const north = bodyShape(b, 0, 0, Math.PI / 2);
    expect(north.blade.x).toBeCloseTo(-0.05);
    expect(north.blade.y).toBeCloseTo(0.17);
    expect(north.corners[0].x).toBeCloseTo(-0.2);
    expect(north.corners[0].y).toBeCloseTo(0.43);
  });
});

describe('body spots', () => {
  it('draws one body per place', () => {
    // a turn on the spot reported 30 times, a loop corner over half a metre of path, a drive between parts further away
    const spin = Array.from({length: 30}, (_, i) => ({x: 1, y: 1, yaw: i * 0.2, kind: 'spin'}));
    const corner = Array.from({length: 6}, (_, i) => ({x: 1.2 + i * 0.1, y: 1, yaw: 0, kind: 'loop'}));
    const transit = [{x: 5, y: 5, yaw: 1, kind: 'transit'}];
    const places = spotPlaces([...spin, ...corner, ...transit]);
    expect(places).toHaveLength(2);
    expect(places[0].kinds).toEqual(['spin', 'loop']);
    expect(places[1]).toEqual({spot: transit[0], kinds: ['transit']});
    expect(spotPlaces([])).toEqual([]);
  });
});

const body = {width: 0.4, front: 0.43, rear: 0.14, blade: 0.18, bladeAhead: 0.17, bladeOffset: 0};

describe('mower sizes in the app', () => {
  it('takes the sizes set in the app, width, front and rear needed', () => {
    expect(sizesBody(undefined)).toBeNull();
    expect(sizesBody({width: 0.4, front: 0.43})).toBeNull();
    expect(sizesBody({width: 0, front: 0.43, rear: 0.14})).toBeNull();
    expect(sizesBody({width: 0.4, front: 0.43, rear: 0.14, blade: 0.18, bladeAhead: 0.17})).toEqual(body);
    // a blade wider than 40 cm isn't taken
    expect(sizesBody({width: 0.4, front: 0.43, rear: 0.14, blade: 0.5})?.blade).toBe(0);
  });

  it('turns a drawn blade slower than the real one', () => {
    expect(bladeSeconds(2400)).toBe(2.5);
    expect(bladeSeconds(2450)).toBe(2.5);
    expect(bladeSeconds(100)).toBe(10);
    expect(bladeSeconds(-30000)).toBe(1);
  });
});

describe('cut strip', () => {
  it('follows the blade ahead of the track, one piece per lane', () => {
    // there and back on two lanes 0.15 m apart, a turn on the spot at each end
    const track = [
      {x: 0, y: 0},
      {x: 5, y: 0},
      {x: 5, y: 0.15},
      {x: 0, y: 0.15},
    ];
    const pieces = swathPieces(track, body);
    const first = pieces[0];
    expect(first[0].x).toBeCloseTo(0.17);
    expect(first[0].y).toBeCloseTo(0);
    expect(first[1].x).toBeCloseTo(5.17);
    // the lane back starts where the mower faces west, its blade 0.17 m to the west of the track
    const back = pieces[pieces.length - 1];
    expect(back[back.length - 1].x).toBeCloseTo(-0.17);
    expect(back[back.length - 1].y).toBeCloseTo(0.15);
    // the turns at the ends swing the blade round in their own pieces, so the lanes stay apart
    expect(pieces.length).toBeGreaterThan(3);
    for (const p of pieces.slice(1, -1)) {
      const xs = p.map((q) => q.x);
      expect(Math.min(...xs)).toBeGreaterThan(4.7);
    }
    // each piece goes on where the one before ended, on a straight bit, so their square ends meet without a step
    for (let i = 1; i < pieces.length; i++) {
      const before = pieces[i - 1];
      const [at, next] = pieces[i];
      const from = before[before.length - 2];
      expect(at).toEqual(before[before.length - 1]);
      expect((at.x - from.x) * (next.y - at.y) - (at.y - from.y) * (next.x - at.x)).toBeCloseTo(0, 9);
    }
  });

  it('rounds the ends of a stretch like the blade', () => {
    const half = swathEnd({x: 0, y: 0}, {x: 1, y: 0}, 0.09);
    expect(half[0].x).toBeCloseTo(1);
    expect(Math.abs(half[0].y)).toBeCloseTo(0.09);
    expect(half[4].x).toBeCloseTo(1.09);
    expect(half[4].y).toBeCloseTo(0);
    expect(half[8].x).toBeCloseTo(1);
  });

  it('keeps a slightly bending lane in one piece and skips tiny steps', () => {
    const track = [
      {x: 0, y: 0},
      {x: 0.005, y: 0},
      {x: 2, y: 0.1},
      {x: 4, y: 0.3},
    ];
    const pieces = swathPieces(track, {...body, bladeAhead: 0});
    expect(pieces).toHaveLength(1);
    expect(pieces[0][0]).toEqual({x: 0, y: 0});
  });

  it('has nothing for a mower standing still', () => {
    expect(swathPieces([{x: 1, y: 1}], body)).toEqual([]);
    expect(swathPieces([{x: 1, y: 1}, {x: 1.03, y: 1}], body)).toEqual([]);
  });
});

describe('cut strip on a wobbly track', () => {
  it('keeps the blade steady along a lane with gps wobble', () => {
    // a lane east with 1 cm wobble every 6 cm
    const track = Array.from({length: 60}, (_, i) => ({x: i * 0.06, y: i % 2 ? 0.01 : -0.01}));
    const pieces = swathPieces(track, body);
    expect(pieces).toHaveLength(1);
    // the blade 17 cm ahead wobbles little more than the track itself
    for (const p of pieces[0].slice(6)) expect(Math.abs(p.y)).toBeLessThan(0.025);
  });
});

describe('real edges', () => {
  const square = (id: string, type: string, x0: number, y0: number, size: number): MapArea =>
    ({
      id,
      properties: {type},
      outline: [
        {x: x0, y: y0},
        {x: x0 + size, y: y0},
        {x: x0 + size, y: y0 + size},
        {x: x0, y: y0 + size},
      ],
    }) as MapArea;
  const box = (o: {x: number; y: number}[]) => {
    const xs = o.map((p) => p.x);
    const ys = o.map((p) => p.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => +v.toFixed(3));
  };

  it('grows the lawn by half the width and shrinks obstacles by it, areas side by side as one', () => {
    const {lawn, obstacles} = realEdges(
      [square('a', 'mow', 0, 0, 4), square('b', 'mow', 4, 0, 4), square('o', 'obstacle', 1, 1, 1), square('n', 'nav', 9, 0, 2)],
      0.4,
    );
    expect(lawn).toHaveLength(1);
    expect(box(lawn[0])).toEqual([-0.2, -0.2, 8.2, 4.2]);
    expect(obstacles).toHaveLength(1);
    expect(box(obstacles[0])).toEqual([1.2, 1.2, 1.8, 1.8]);
  });

  it('leaves out an obstacle the mower drove round tighter than its width', () => {
    expect(realEdges([square('o', 'obstacle', 0, 0, 0.3)], 0.4).obstacles).toEqual([]);
  });
});

describe('real outline', () => {
  const outline: [number, number][] = [
    [0.4, 0.1],
    [0.3, 0.2],
    [-0.1, 0.2],
    [-0.1, -0.2],
    [0.3, -0.2],
    [0.4, -0.1],
  ];

  it('takes robot_outline when it is at least 3 points, the rectangle otherwise', () => {
    const base = {robot_width: 0.4, robot_front: 0.4, robot_rear: 0.1};
    expect(bodyFrom(settings({...base, robot_outline: outline}))?.outline).toEqual(outline);
    expect(bodyFrom(settings({...base, robot_outline: null}))?.outline).toBeUndefined();
    expect(bodyFrom(settings({...base, robot_outline: outline.slice(0, 2)}))?.outline).toBeUndefined();
    expect(outlineOf([[0, 0], [1, NaN], [0, 1]])).toBeUndefined();
    // in cm, around another point, or tiny: no outline
    expect(outlineOf(outline.map(([a, l]) => [a * 100, l * 100]))).toBeUndefined();
    expect(outlineOf(outline.map(([a, l]) => [a + 0.6, l]))).toBeUndefined();
    expect(outlineOf(outline.map(([a, l]) => [a / 10, l / 10]))).toBeUndefined();
    for (const m of MOWER_MODELS.filter((x) => x.outline)) expect(outlineOf(m.outline)).toEqual(m.outline);
    expect(sizesBody({width: 0.4, front: 0.4, rear: 0.1, outline})?.outline).toEqual(outline);
  });

  it('draws the body along the outline, turned with the heading', () => {
    const b = {width: 0.4, front: 0.4, rear: 0.1, blade: 0.18, bladeAhead: 0.17, bladeOffset: 0, outline};
    const north = bodyShape(b, 1, 2, Math.PI / 2);
    expect(north.corners).toHaveLength(6);
    // ahead is +y, left is -x
    expect(north.corners[0].x).toBeCloseTo(0.9);
    expect(north.corners[0].y).toBeCloseTo(2.4);
  });

  it('grows an outline outwards with pointed corners, either way round', () => {
    const square: [number, number][] = [
      [0.1, 0.1],
      [-0.1, 0.1],
      [-0.1, -0.1],
      [0.1, -0.1],
    ];
    expect(grownOutline(square, 0.01)).toEqual([
      [0.11, 0.11],
      [-0.11, 0.11],
      [-0.11, -0.11],
      [0.11, -0.11],
    ]);
    expect(grownOutline([...square].reverse(), 0.01)).toEqual([
      [0.11, -0.11],
      [-0.11, -0.11],
      [-0.11, 0.11],
      [0.11, 0.11],
    ]);
  });

  it('finds the model of an outline grown for the planner', () => {
    for (const m of MOWER_MODELS.filter((x) => x.outline)) {
      const g = grownOutline(m.outline!, OUTLINE_LEEWAY);
      expect(Math.max(...g.map(([a]) => a))).toBeCloseTo(m.sizes.front + OUTLINE_LEEWAY, 2);
      expect(Math.min(...g.map(([a]) => a))).toBeCloseTo(-m.sizes.rear - OUTLINE_LEEWAY, 2);
      expect(measuredOutline(g)).toEqual(m.outline);
    }
    expect(measuredOutline(outline)).toEqual(outline);
  });

  it('fits the sizes of the models that have one', () => {
    for (const m of MOWER_MODELS.filter((x) => x.outline)) {
      const xs = m.outline!.map(([a]) => a);
      const ys = m.outline!.map(([, l]) => Math.abs(l));
      expect(Math.max(...xs)).toBeCloseTo(m.sizes.front, 3);
      expect(Math.min(...xs)).toBeCloseTo(-m.sizes.rear, 3);
      expect(Math.max(...ys)).toBeLessThanOrEqual(m.sizes.width / 2 + 0.001);
      expect(modelOf({...m.sizes, outline: m.outline})).toBe(m.key);
    }
  });
});

describe('mower models', () => {
  it('knows the sizes measured on a real one, to the millimetre', () => {
    expect(modelOf(MOWER_MODELS[0].sizes)).toBe('yf-nx');
    expect(modelOf({width: 0.425, front: 0.47, rear: 0.1, blade: 0.18, bladeAhead: 0.18})).toBe('yf-classic500');
    expect(modelOf({width: 0.41, front: 0.43, rear: 0.18, blade: 0.18, bladeAhead: 0.185})).toBe('yf-nx');
    expect(modelOf({width: 0.535, front: 0.56, rear: 0.215, blade: 0.3, bladeAhead: 0.17})).toBe('jd-tango-e5');
    expect(modelOf({...MOWER_MODELS[0].sizes, width: 0.42})).toBeNull();
    expect(modelOf(undefined)).toBeNull();
  });
});

describe('strip without seams', () => {
  const body = {width: 0.41, front: 0.43, rear: 0.18, blade: 0.18, bladeAhead: 0.185, bladeOffset: 0};

  it('keeps a bend round an obstacle in one group, so it is drawn as one line', () => {
    // three quarters round, a full circle overlaps itself where it closes and shows that darker
    const bend = Array.from({length: 48}, (_, i) => ({x: Math.cos((i / 47) * 1.5 * Math.PI), y: Math.sin((i / 47) * 1.5 * Math.PI)}));
    const pieces = swathPieces(bend, body);
    expect(pieces.length).toBeGreaterThan(4);
    expect(new Set(swathGroups(pieces, body.blade)).size).toBe(1);
  });

  it('goes on across the chunks of a trail as if it were one', () => {
    // a lane bending left, cut in two in the bend, the second chunk starting with the last point of the first
    const track = [
      ...Array.from({length: 20}, (_, i) => ({x: i * 0.1, y: 0})),
      ...Array.from({length: 20}, (_, i) => ({x: 1.9 + (i + 1) * 0.07, y: (i + 1) * 0.07})),
    ];
    const whole = swathPieces(track, body).flat();
    const one = swathAfter(track.slice(0, 24), body, null);
    const two = swathAfter(track.slice(23), body, one.state);
    const last = one.pieces[one.pieces.length - 1];
    expect(two.pieces[0][0]).toBe(last[last.length - 1]);
    const joined = [...one.pieces, ...two.pieces].flat();
    expect(joined[joined.length - 1].x).toBeCloseTo(whole[whole.length - 1].x, 9);
    expect(joined[joined.length - 1].y).toBeCloseTo(whole[whole.length - 1].y, 9);
  });

  it('still puts the lane back after a turn into another group than the lane out', () => {
    // out along y = 0, a turn on the spot round the end, back 14 cm further over
    const track = [
      ...Array.from({length: 31}, (_, i) => ({x: i * 0.1, y: 0})),
      {x: 3, y: 0.14},
      ...Array.from({length: 31}, (_, i) => ({x: 3 - i * 0.1, y: 0.14})),
    ];
    const pieces = swathPieces(track, body);
    const g = swathGroups(pieces, body.blade);
    expect(g[0]).not.toBe(g[g.length - 1]);
  });
});

describe('strip in a few paths', () => {
  const lane = (y: number) => [
    {x: 0, y},
    {x: 3, y},
  ];

  it('puts lanes that overlap into different groups, far apart ones may share', () => {
    // back and forth 14 cm apart, an 18 cm blade overlaps the lane before
    const lanes = [0, 1, 2, 3, 4, 5].map((i) => (i % 2 ? lane(i * 0.14).reverse() : lane(i * 0.14)));
    const g = swathGroups(lanes, 0.18);
    for (let i = 1; i < g.length; i++) expect(g[i]).not.toBe(g[i - 1]);
    expect(Math.max(...g)).toBeLessThan(4);
    // half a meter apart they don't touch
    expect(swathGroups([lane(0), lane(0.5)], 0.18)).toEqual([0, 0]);
  });

  it('shares a group only where more pieces overlap than there are groups', () => {
    const g = swathGroups(
      Array.from({length: 6}, () => lane(0)),
      0.18,
    );
    expect(g.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(g).toHaveLength(6);
  });
});

describe('round bends', () => {
  // a bend of radius 3 m with a point every 0.5 m, like a recorded track simplified to a centimetre
  const arc = Array.from({length: 13}, (_, i) => ({x: 3 * Math.sin(i / 6), y: 3 - 3 * Math.cos(i / 6), b: true}));

  it('draws a bend round through its points', () => {
    const r = roundBends(arc);
    for (const p of arc) expect(r).toContainEqual(p);
    // on the real circle, where the 0.5 m straight pieces are up to 1 cm off it; at the two ends, where the track
    // starts and stops mid bend, the curve leaves straight
    const off = (p: {x: number; y: number}) => Math.abs(Math.hypot(p.x, p.y - 3) - 3);
    const inner = r.filter((p) => Math.atan2(p.x, 3 - p.y) * 6 > 1 && Math.atan2(p.x, 3 - p.y) * 6 < 11);
    for (const p of inner) expect(off(p)).toBeLessThan(0.0005);
    for (const p of r) expect(off(p)).toBeLessThan(0.008);
    const turns = r.slice(2).map((c, i) => {
      const [a, b] = [r[i], r[i + 1]];
      return Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
    });
    expect(Math.max(...turns)).toBeLessThan((2 * Math.PI) / 180);
    expect(r.every((p) => p.b)).toBe(true);
  });

  it('keeps the corners of a turn and straight lanes as they are', () => {
    const lanes = [
      {x: 0, y: 0},
      {x: 5, y: 0},
      {x: 5, y: 0.14},
      {x: 0, y: 0.14},
    ];
    expect(roundBends(lanes)).toEqual(lanes);
    const straight = [
      {x: 0, y: 0},
      {x: 1, y: 0},
      {x: 2, y: 0},
    ];
    expect(roundBends(straight)).toEqual(straight);
  });
});
