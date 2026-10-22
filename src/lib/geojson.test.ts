import {describe, expect, it} from 'vitest';
import type {MowerMap} from '@/hooks/useMowerMap';
import {isGeoJson, mapFromGeoJson, mapToGeoJson} from './geojson';

const datum = {lat: 52.4735, lon: 13.4035};
const MAP: MowerMap = {
  areas: [
    {id: 'lawn', properties: {name: 'Lawn', type: 'mow', angle: 0.35, outline_count: 2}, outline: [{x: 0, y: 0}, {x: 30, y: 0}, {x: 30, y: 20}, {x: 0, y: 20}]},
    {id: 'bed', properties: {name: 'Bed', type: 'obstacle'}, outline: [{x: 5, y: 5}, {x: 8, y: 5}, {x: 8, y: 7}]},
  ],
  docking_stations: [{id: 'dock', position: {x: -1.25, y: 3.5}, heading: Math.PI}],
};

type Json = {features: {properties: Record<string, unknown>; geometry: {type: string; coordinates: number[][][] | number[]}}[]};

describe('the map as geojson', () => {
  it('goes there and back to within a millimeter, with properties and docking station', () => {
    const json = mapToGeoJson(MAP, datum);
    expect(isGeoJson(json)).toBe(true);
    const ring = json.features[0].geometry.coordinates as number[][][];
    // closed, longitude first
    expect(ring[0][0]).toEqual(ring[0][ring[0].length - 1]);
    expect(ring[0][0][0]).toBeCloseTo(datum.lon, 6);
    const {map, added} = mapFromGeoJson(JSON.parse(JSON.stringify(json)), datum, null);
    // the two areas and the docking station
    expect(added).toBe(3);
    expect(map.areas.map((a) => a.properties)).toEqual(MAP.areas.map((a) => a.properties));
    map.areas.forEach((a, i) =>
      a.outline.forEach((p, k) => {
        expect(Math.abs(p.x - MAP.areas[i].outline[k].x)).toBeLessThan(0.001);
        expect(Math.abs(p.y - MAP.areas[i].outline[k].y)).toBeLessThan(0.001);
      }),
    );
    expect(map.docking_stations[0].heading).toBe(Math.PI);
    expect(Math.abs(map.docking_stations[0].position.x + 1.25)).toBeLessThan(0.001);
  });

  it('keeps a pin a pin there and back', () => {
    const pinned: MowerMap = {
      ...MAP,
      areas: [...MAP.areas, {id: 'gnome', properties: {name: 'Gartenzwerg', type: 'decor', pin: true}, outline: [{x: 2.95, y: 1.45}, {x: 3.05, y: 1.45}, {x: 3.05, y: 1.55}, {x: 2.95, y: 1.55}]}],
    };
    const {map} = mapFromGeoJson(JSON.parse(JSON.stringify(mapToGeoJson(pinned, datum))), datum, null);
    expect(map.areas[2].properties).toEqual({name: 'Gartenzwerg', type: 'decor', pin: true});
    expect(map.areas[2].outline).toHaveLength(4);
  });

  it('puts an area back in place of the one with its id and adds new ones as drafts, other apps\' styles stay out', () => {
    const json = mapToGeoJson(MAP, datum) as unknown as Json;
    const moved = json.features[0];
    (moved.geometry.coordinates as number[][][])[0][1][0] += 0.00001;
    moved.properties.name = 'Big lawn';
    moved.properties.stroke = '#555555';
    const drawn = {
      type: 'Feature',
      properties: {fill: '#ff0000'},
      geometry: {type: 'Polygon', coordinates: [[[13.4036, 52.4736], [13.4037, 52.4736], [13.4037, 52.4737], [13.4036, 52.4736]]]},
    };
    const {map, changed, added} = mapFromGeoJson({type: 'FeatureCollection', features: [moved, drawn]}, datum, MAP);
    expect([changed, added]).toEqual([1, 1]);
    expect(map.areas).toHaveLength(3);
    expect(map.areas[0].properties).toEqual({name: 'Big lawn', type: 'mow', angle: 0.35, outline_count: 2});
    expect(map.areas[0].outline[1].x).toBeGreaterThan(30.5);
    expect(map.areas[1]).toBe(MAP.areas[1]);
    expect(map.areas[2].properties).toEqual({type: 'draft'});
    expect(map.docking_stations).toEqual(MAP.docking_stations);
  });

  it('leaves what the file has unchanged as it is and counts only real changes', () => {
    const json = JSON.parse(JSON.stringify(mapToGeoJson(MAP, datum))) as Json;
    const same = mapFromGeoJson(json, datum, MAP);
    expect([same.changed, same.added]).toEqual([0, 0]);
    same.map.areas.forEach((a, i) => expect(a).toBe(MAP.areas[i]));
    expect(same.map.docking_stations[0]).toBe(MAP.docking_stations[0]);
    // only a property changed: the outline keeps its points to the bit
    json.features[1].properties.name = 'Roses';
    (json.features[2].geometry.coordinates as number[])[0] += 0.00002;
    const renamed = mapFromGeoJson(json, datum, MAP);
    expect([renamed.changed, renamed.added]).toEqual([2, 0]);
    expect(renamed.map.areas[0]).toBe(MAP.areas[0]);
    expect(renamed.map.areas[1].properties.name).toBe('Roses');
    expect(renamed.map.areas[1].outline).toBe(MAP.areas[1].outline);
    // the docking station moved by about 1.4 m
    expect(renamed.map.docking_stations[0].position.x).toBeGreaterThan(0);
  });

  it('takes a hole as an obstacle and refuses a file for another place', () => {
    const square = (lon: number, lat: number, d: number) => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
    const holed = {type: 'Feature', properties: {type: 'mow'}, geometry: {type: 'Polygon', coordinates: [square(13.4035, 52.4735, 0.0003), square(13.4036, 52.4736, 0.00005)]}};
    const {map} = mapFromGeoJson(holed, datum, null);
    expect(map.areas.map((a) => a.properties.type)).toEqual(['mow', 'obstacle']);
    expect(() => mapFromGeoJson({...holed, geometry: {type: 'Polygon', coordinates: [square(52.4735, 13.4035, 0.0003)]}}, datum, null)).toThrow(/2 km/);
    expect(() => mapFromGeoJson({type: 'FeatureCollection', features: []}, datum, null)).toThrow(/No areas/);
  });

  it('says so when the coordinates are meters of a projected system, not longitude and latitude', () => {
    // utm zone 33 around the datum
    const utm = [[392000, 5815000], [392030, 5815000], [392030, 5815020], [392000, 5815000]];
    const feature = {type: 'Feature', properties: {type: 'mow'}, geometry: {type: 'Polygon', coordinates: [utm]}};
    expect(() => mapFromGeoJson(feature, datum, null)).toThrow(/longitude and latitude/);
  });
});
