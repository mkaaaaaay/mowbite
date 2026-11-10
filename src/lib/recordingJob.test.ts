import {describe, expect, it} from 'vitest';
import type {MapArea, MowerMap} from '@/hooks/useMowerMap';
import {pinSquare} from '@/app/map/editing';
import {dropsJob, lanesKey, MODE_GAP_MS} from './recordingJob';

const square = (x: number, y: number, side: number) => [
  {x, y},
  {x: x + side, y},
  {x: x + side, y: y + side},
  {x, y: y + side},
];
const lawn: MapArea = {id: 'l', properties: {name: 'Lawn', type: 'mow'}, outline: square(0, 0, 10)};
const pin = (id: string, x: number, y: number): MapArea => ({id, properties: {type: 'decor', pin: true}, outline: pinSquare(x, y)});
const map = (...areas: MapArea[]): MowerMap => ({areas, docking_stations: [{id: 'd', position: {x: -1, y: 3}, heading: Math.PI}]});

describe('the interrupted job after recording mode', () => {
  const began = lanesKey(map(lawn, pin('p', 2, 2)));
  // an area recorded with an obstacle in it, both added after the others like OpenMower does
  const recorded = lanesKey(
    map(lawn, pin('p', 2, 2), {id: 'n', properties: {type: 'mow'}, outline: square(12, 0, 5)}, {id: 'o', properties: {type: 'obstacle'}, outline: square(13, 1, 1)}),
  );

  it('is dropped once the mower is idle right after the mode, the areas changed and it offers the drop', () => {
    expect(dropsJob('IDLE', 1000, recorded, began, true)).toBe(true);
    expect(dropsJob('IDLE', MODE_GAP_MS, recorded, began, true)).toBe(true);
  });

  it('stays when any of that is missing', () => {
    // in the mode still, or out again (mowing, docking)
    for (const state of ['AREA_RECORDING', 'MOWING', 'DOCKING', 'UNDOCKING', undefined]) expect(dropsJob(state, 1000, recorded, began, true)).toBe(false);
    // the mode not seen up to a moment ago: opened after it, asleep meanwhile
    expect(dropsJob('IDLE', MODE_GAP_MS + 1, recorded, began, true)).toBe(false);
    expect(dropsJob('IDLE', Infinity, recorded, began, true)).toBe(false);
    // no map (yet), or the same areas
    expect(dropsJob('IDLE', 1000, null, began, true)).toBe(false);
    expect(dropsJob('IDLE', 1000, began, began, true)).toBe(false);
    // the mower doesn't offer it (none, or it was dropped already)
    expect(dropsJob('IDLE', 1000, recorded, began, false)).toBe(false);
  });

  it('takes pins and the docking station as no change', () => {
    expect(lanesKey(map(lawn, pin('p', 3, 5), pin('q', 1, 1)))).toBe(began);
    expect(lanesKey(map(lawn))).toBe(began);
    const station = {...map(lawn, pin('p', 2, 2)), docking_stations: [{id: 'new', position: {x: -1.2, y: 3.1}, heading: 3}]};
    expect(lanesKey(station)).toBe(began);
    expect(lanesKey({...station, docking_stations: []})).toBe(began);
  });

  it('takes the same map sent again as no change, an area renamed or moved as one', () => {
    // keys in another order, the ring closed, a hundredth of a mm off
    const outline = lawn.outline.map((p) => ({y: p.y, x: p.x + 1e-5}));
    const again = map({outline: [...outline, outline[0]], properties: {type: 'mow', name: 'Lawn'}, id: 'l'}, pin('p', 2, 2));
    expect(lanesKey(again)).toBe(began);
    expect(lanesKey(map({...lawn, properties: {name: 'Front', type: 'mow'}}, pin('p', 2, 2)))).not.toBe(began);
    expect(lanesKey(map({...lawn, outline: square(0, 0, 10.05)}))).not.toBe(began);
  });
});
