import {describe, expect, it} from 'vitest';
import {datumFromParams, numParam} from './useMowerParams';

describe('numParam', () => {
  const sent = {'/mower_logic/outline_overlap_count': 1, '/mower_logic/tool_width': 0.18};

  it('takes what the mower sent', () => {
    expect(numParam(sent, '/mower_logic/tool_width')).toBe(0.18);
    expect(numParam(sent, '/mower_logic/outline_overlap_count')).toBe(1);
  });

  it("falls back to mower_logic's default for one the list came without", () => {
    expect(numParam(sent, '/mower_logic/outline_count')).toBe(3);
    expect(numParam({'/mower_logic/outline_overlap_count': 1}, '/mower_logic/tool_width')).toBe(0.14);
  });

  it("takes MowBite OS's own default where it has another", () => {
    expect(numParam(sent, '/mower_logic/max_position_accuracy')).toBe(0.2);
    expect(numParam(sent, '/mower_logic/max_position_accuracy', true)).toBe(0.1);
    expect(numParam(sent, '/mower_logic/outline_count', true)).toBe(3);
    expect(numParam({'/mower_logic/max_position_accuracy': 0.05}, '/mower_logic/max_position_accuracy', true)).toBe(0.05);
  });

  it('knows nothing for params without a default', () => {
    expect(numParam(sent, '/ll/services/gps/datum_lat')).toBeUndefined();
  });
});

describe('datumFromParams', () => {
  it('finds the datum by the end of the key, the same object for the same params', () => {
    const params = {'/ll/services/gps/datum_lat': 52.1, '/ll/services/gps/datum_long': 9.8};
    const d = datumFromParams(params);
    expect(d).toEqual({lat: 52.1, lon: 9.8});
    expect(datumFromParams(params)).toBe(d);
    expect(datumFromParams({...params})).toEqual(d);
  });

  it('has none without a position', () => {
    expect(datumFromParams({'/ll/services/gps/datum_lat': 0, '/ll/services/gps/datum_long': 0})).toBeUndefined();
    expect(datumFromParams({})).toBeUndefined();
  });
});

describe('params as they come from the mower', () => {
  it('are an object of params, anything else keeps the ones before', async () => {
    const {paramsFrom} = await import('./useMowerParams');
    const before = {'/mower_logic/tool_width': 0.2};
    expect(paramsFrom('{"/a/datum_lat": 52}', before)).toEqual({'/a/datum_lat': 52});
    for (const bad of ['null', '[]', '"x"', '3']) expect(paramsFrom(bad, before)).toBe(before);
  });
});
