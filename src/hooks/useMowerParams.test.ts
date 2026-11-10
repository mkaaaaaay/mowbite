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
