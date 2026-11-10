import {describe, expect, it} from 'vitest';
import type {MowerMap} from '@/hooks/useMowerMap';
import {sameContent, sameMap} from './sameMap';
import {closedRings} from './rings';

const map = (): MowerMap => ({
  areas: [
    {id: 'a', properties: {name: 'Front', type: 'mow'}, outline: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}]},
    {id: 'b', properties: {type: 'obstacle'}, outline: [{x: 0.2, y: 0.2}, {x: 0.4, y: 0.2}, {x: 0.4, y: 0.4}]},
  ],
  docking_stations: [{id: 'd', position: {x: 2, y: 2}, heading: 1}],
});

describe('sameMap', () => {
  it('takes the same map that came again (new objects) as the same', () => {
    expect(sameMap(map(), map())).toBe(true);
  });

  it('spots a moved point, a changed setting, a new area and a moved dock', () => {
    const moved = map();
    moved.areas[1].outline[0] = {x: 0.25, y: 0.2};
    expect(sameMap(map(), moved)).toBe(false);

    const renamed = map();
    renamed.areas[0].properties.name = 'Back';
    expect(sameMap(map(), renamed)).toBe(false);

    const added = map();
    added.areas.push({id: 'c', properties: {type: 'nav'}, outline: []});
    expect(sameMap(map(), added)).toBe(false);

    const dock = map();
    dock.docking_stations[0].heading = 2;
    expect(sameMap(map(), dock)).toBe(false);
  });

  it('counts other fields of map.json too', () => {
    expect(sameMap(map(), {...map(), version: 2} as MowerMap)).toBe(false);
  });
});

describe('sameContent', () => {
  it('takes a map as the mower writes it back as the same: keys sorted, outlines closed, numbers a little off', () => {
    const sent = map();
    const back = closedRings(map());
    back.areas[0] = {outline: back.areas[0].outline, properties: {type: 'mow', name: 'Front'}, id: 'a'};
    back.areas[1].outline[0] = {x: 0.2 + 1e-9, y: 0.2};
    expect(sameMap(sent, back)).toBe(false);
    expect(sameContent(sent, back)).toBe(true);
  });

  it('takes what the mower leaves out or fills in as the same: active and mowable when true, an empty name, the type, other fields', () => {
    const sent = map();
    const outline = [{x: 3, y: 3}, {x: 4, y: 3}, {x: 4, y: 4}];
    sent.areas.push({id: 'c', properties: {name: '', active: true, mowable: true, mow_around: false}, outline});
    const back = {...map(), areas: [...map().areas, {id: 'c', properties: {type: 'draft', mow_around: false}, outline}]};
    expect(sameContent({...sent, version: 2} as MowerMap, back)).toBe(true);
  });

  it('spots a setting the mower dropped or set otherwise', () => {
    const sent = map();
    sent.areas[0].properties.mow_around = false;
    expect(sameContent(sent, map())).toBe(false);
    const off = map();
    off.areas[0].properties.active = false;
    expect(sameContent(off, map())).toBe(false);
  });

  it('still spots a real change', () => {
    const back = map();
    back.areas[0].outline[1] = {x: 1.01, y: 0};
    expect(sameContent(map(), back)).toBe(false);
    const setting = map();
    setting.areas[0].properties.angle = 0.5;
    expect(sameContent(map(), setting)).toBe(false);
  });
});
