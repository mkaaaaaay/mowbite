import {describe, expect, it} from 'vitest';
import type {MapArea} from '@/hooks/useMowerMap';
import {bladeSeconds, bodyFrom, bodyShape, realEdges, swathEnd, swathPieces} from './mowerBody';

const body = {width: 0.4, front: 0.43, rear: 0.14, blade: 0.18, bladeAhead: 0.17, bladeOffset: 0};

describe('mower body', () => {
  it('needs width, front and rear', () => {
    expect(bodyFrom(undefined)).toBeNull();
    expect(bodyFrom({width: 0.4, front: 0.43})).toBeNull();
    expect(bodyFrom({width: 0, front: 0.43, rear: 0.14})).toBeNull();
    expect(bodyFrom({width: 0.4, front: 0.43, rear: 0.14, blade: 0.18, bladeAhead: 0.17})).toEqual(body);
    // a blade wider than 40 cm isn't taken
    expect(bodyFrom({width: 0.4, front: 0.43, rear: 0.14, blade: 0.5})?.blade).toBe(0);
  });

  it('puts the body around the point the mower follows, turned with its heading', () => {
    const b = {...body, bladeOffset: 0.05};
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
    // each piece goes on where the one before ended
    for (let i = 1; i < pieces.length; i++) expect(pieces[i][0]).toEqual(pieces[i - 1][pieces[i - 1].length - 1]);
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
