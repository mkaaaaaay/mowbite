import type {MapArea, MowerMap} from '@/hooks/useMowerMap';
import {PIN_SIDE, pinAt} from '@/lib/mowerBody';
import {describe, expect, it} from 'vitest';
import {decorRedo, decorUndo, goneLooks, onlyPinsChanged, overrideError, PIN_TILES, pinSquare, pinsFrom, pinTiles} from './editing';

describe('overrideError', () => {
  it('takes empty (global value) and values within the mower limits', () => {
    expect(overrideError('outline_count', '')).toBeNull();
    expect(overrideError('outline_count', '3')).toBeNull();
    expect(overrideError('outline_overlap_count', '0')).toBeNull();
    expect(overrideError('outline_offset', '-0.25')).toBeNull();
    expect(overrideError('outline_offset', '1')).toBeNull();
  });

  it('turns down what the mower would ignore or misread', () => {
    // -2 would count as "not set", 1.5 as 1
    expect(overrideError('outline_count', '-2')).not.toBeNull();
    expect(overrideError('outline_count', '1.5')).not.toBeNull();
    expect(overrideError('outline_overlap_count', '300')).not.toBeNull();
    expect(overrideError('outline_offset', '5')).not.toBeNull();
    expect(overrideError('outline_offset', '-1.2')).not.toBeNull();
  });
});

describe('pins', () => {
  const pin = (id: string, x: number, y: number): MapArea => ({id, properties: {type: 'decor', pin: true}, outline: pinSquare(x, y)});
  const lawn: MapArea = {id: 'l', properties: {type: 'mow'}, outline: pinSquare(0, 0).map((p) => ({x: p.x * 100, y: p.y * 100}))};
  const map = (...areas: MapArea[]): MowerMap => ({areas, docking_stations: [{id: 'd', position: {x: 1, y: 1}, heading: 0}]});

  it('stands in the middle of its square, moved it keeps its 4 points', () => {
    const p = pin('p', 2.3, -1.7);
    expect(p.outline).toHaveLength(4);
    expect(pinAt(p)).toEqual({x: expect.closeTo(2.3, 9), y: expect.closeTo(-1.7, 9)});
    const xs = p.outline.map((q) => q.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(PIN_SIDE, 9);
    const moved = {...p, outline: pinSquare(4, 5)};
    expect(moved.outline).toHaveLength(4);
    expect(pinAt(moved)).toEqual({x: expect.closeTo(4, 9), y: expect.closeTo(5, 9)});
  });

  it('notices when nothing but pins changed', () => {
    const base = map(lawn, pin('p', 1, 1));
    expect(onlyPinsChanged(base, base)).toBe(true);
    expect(onlyPinsChanged(base, map(lawn))).toBe(true);
    expect(onlyPinsChanged(base, map(lawn, pin('p', 2, 1), pin('q', 3, 3)))).toBe(true);
    expect(onlyPinsChanged(base, map({...lawn, properties: {type: 'mow', name: 'Front'}}, pin('p', 1, 1)))).toBe(false);
    expect(onlyPinsChanged(base, map(pin('p', 1, 1)))).toBe(false);
    expect(onlyPinsChanged(base, {...base, docking_stations: [{id: 'd', position: {x: 1, y: 1}, heading: 1}]})).toBe(false);
    // decoration in a pin's place is an area of its own, one that lost pin keeps its square and stays one
    expect(onlyPinsChanged(base, map(lawn, {...pin('p', 1, 1), properties: {type: 'decor'}, outline: pinSquare(1, 1).slice(0, 3)}))).toBe(false);
    expect(onlyPinsChanged(base, map(lawn, {...pin('p', 1, 1), properties: {type: 'decor'}}))).toBe(true);
  });

  it("takes the pins of the mower's map back, the areas stay as they are", () => {
    const live = map(lawn, pin('p', 1, 1), pin('q', 2, 2));
    const edited = map({...lawn, properties: {type: 'mow', name: 'Front'}}, pin('p', 3, 3), pin('n', 4, 4));
    const back = pinsFrom(edited, live);
    expect(back.areas[0].properties.name).toBe('Front');
    expect(back.areas.slice(1)).toEqual(live.areas.slice(1));
    expect(onlyPinsChanged(edited, back)).toBe(true);
    expect(back.docking_stations).toBe(edited.docking_stations);
  });

  it('undoes while decorating no further than where it started, redoes only pins', () => {
    const start = map(lawn);
    const one = map(lawn, pin('p', 1, 1));
    const two = map(lawn, pin('p', 2, 1));
    expect(decorUndo(start, start, [])).toBe(false);
    // a step before it is there, but not for decorating
    expect(decorUndo(start, start, [map()])).toBe(false);
    expect(decorUndo(one, start, [start])).toBe(true);
    expect(decorUndo(two, start, [start, one])).toBe(true);
    // no start known: as long as there are steps
    expect(decorUndo(start, null, [map()])).toBe(true);
    expect(decorRedo(one, [two])).toBe(true);
    expect(decorRedo(start, [])).toBe(false);
    // undone before decorating: a change to an area, it stays undone
    expect(decorRedo(start, [map({...lawn, properties: {type: 'mow', name: 'Front'}})])).toBe(false);
  });

  it('puts back the pictures of pins no longer on the map, the others stay as they are', () => {
    const kept = {p: {looks: 'gnome', lookSizes: 0.4}, n: {}, q: {}};
    expect(goneLooks(kept, map(lawn, pin('p', 1, 1)))).toEqual({n: {}, q: {}});
    expect(goneLooks(kept, null)).toEqual(kept);
    expect(goneLooks({}, map(lawn))).toEqual({});
  });

  it("offers the pins' pictures first, the most used in front, then the usual ones", () => {
    expect(pinTiles([])).toEqual(PIN_TILES);
    expect(pinTiles(['lamp', 'statue', 'lamp', 'gnome', 'statue', 'lamp'])).toEqual(['lamp', 'statue', 'gnome', 'pot', 'bush', 'tree', 'bench', 'umbrella', 'grill']);
    // as often: the one set first
    expect(pinTiles(['rose', 'fern']).slice(0, 3)).toEqual(['rose', 'fern', 'gnome']);
  });
});
