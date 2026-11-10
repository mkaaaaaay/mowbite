import {describe, expect, it} from 'vitest';
import type {MapArea, MowerMap, Point} from '@/hooks/useMowerMap';
import {narrowPassages} from './narrowPassages';

const pts = (...xy: number[]): Point[] => xy.flatMap((v, i) => (i % 2 ? [] : [{x: v, y: xy[i + 1]}]));
const rect = (x: number, y: number, w: number, h: number) => pts(x, y, x + w, y, x + w, y + h, x, y + h);
const area = (id: string, type: string, outline: Point[], more: Partial<MapArea['properties']> = {}): MapArea => ({
  id,
  properties: {type, active: true, ...more},
  outline,
});
const map = (...areas: MapArea[]): MowerMap => ({areas, docking_stations: []});
const margins = {edge: 0.05, obstacle: 0.1, width: 0.41};
const lawn = area('lawn', 'mow', rect(0, 0, 10, 10));

describe('narrowPassages', () => {
  it('finds an obstacle too close to the edge, with the middle of the gap', () => {
    const [n] = narrowPassages(map(lawn, area('table', 'obstacle', rect(0.08, 4, 1, 1))), margins);
    expect(n).toMatchObject({kind: 'narrow', areaId: 'table', otherId: 'lawn', edge: true});
    expect(n.gap).toBeCloseTo(0.08);
    // the two distances
    expect(n.need).toBeCloseTo(0.15);
    expect(n.at.x).toBeCloseTo(0.04);
  });

  it('leaves out obstacles with room enough, touching the edge or outside the lawn', () => {
    expect(narrowPassages(map(lawn, area('bed', 'obstacle', rect(0.3, 4, 1, 1))), margins)).toEqual([]);
    expect(narrowPassages(map(lawn, area('bed', 'obstacle', rect(-0.5, 4, 1, 1))), margins)).toEqual([]);
    expect(narrowPassages(map(lawn, area('bed', 'obstacle', rect(0, 4, 1, 1))), margins)).toEqual([]);
    expect(narrowPassages(map(lawn, area('bed', 'obstacle', rect(10.05, 4, 1, 1))), margins)).toEqual([]);
  });

  it('finds two obstacles too close to each other', () => {
    const found = narrowPassages(map(lawn, area('a', 'obstacle', rect(4, 4, 1, 1)), area('b', 'obstacle', rect(5.15, 4, 1, 1))), margins);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({areaId: 'a', otherId: 'b', edge: false});
    expect(found[0].gap).toBeCloseTo(0.15);
    expect(found[0].need).toBeCloseTo(0.2);
    expect(found[0].at.x).toBeCloseTo(5.075);
  });

  it("takes an obstacle's own distance and the area's own settings", () => {
    const close = area('pole', 'obstacle', rect(0.12, 4, 0.1, 0.1));
    expect(narrowPassages(map(lawn, close), margins)).toHaveLength(1);
    expect(narrowPassages(map(lawn, {...close, properties: {...close.properties, margin: 0}}), margins)).toEqual([]);
    const tight = {...lawn, properties: {...lawn.properties, planner: {edge_margin: 0, obstacle_margin: 0}}};
    expect(narrowPassages(map(tight, close), margins)).toEqual([]);
  });

  it('counts areas not mowed only when they are mowed around, and no inactive obstacles', () => {
    const path = rect(0.1, 2, 2, 0.5);
    expect(narrowPassages(map(lawn, area('path', 'mow', path, {mowable: false})), margins)).toEqual([]);
    expect(narrowPassages(map(lawn, area('path', 'mow', path, {mowable: false, mow_around: true})), margins)).toHaveLength(1);
    expect(narrowPassages(map(lawn, area('bed', 'obstacle', rect(0.08, 4, 1, 1), {active: false})), margins)).toEqual([]);
  });

  it('leaves out an edge shared with another mowing area, the body reaches over into that one', () => {
    const next = area('next', 'mow', rect(10, 0, 5, 10));
    expect(narrowPassages(map(lawn, next, area('stump', 'obstacle', rect(8.92, 4, 1, 1))), margins)).toEqual([]);
    // a wider way off than the mower is wide, the edge is one
    const far = area('far', 'mow', rect(10.5, 0, 5, 10));
    expect(narrowPassages(map(lawn, far, area('stump', 'obstacle', rect(8.92, 4, 1, 1))), margins)).toHaveLength(1);
    // the other edges stay edges
    expect(narrowPassages(map(lawn, next, area('table', 'obstacle', rect(0.08, 4, 1, 1))), margins)).toHaveLength(1);
  });

  it('leaves out an obstacle drawn inside another one', () => {
    const found = narrowPassages(map(lawn, area('bed', 'obstacle', rect(3, 3, 3, 3)), area('stone', 'obstacle', rect(3.1, 4, 0.5, 0.5))), margins);
    expect(found).toEqual([]);
  });
});
