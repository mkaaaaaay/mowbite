import {describe, expect, it} from 'vitest';
import {exportParams, gardenExport, scrub} from './gardenExport';

describe('the garden file', () => {
  it('keeps what planning and driving need, nothing that says who or where', () => {
    const kept = exportParams({
      '/mower_logic/tool_width': 0.14,
      '/xbot_positioning/antenna_offset_x': -0.1,
      '/move_base_flex/FTCPlanner/speed_fast': 0.5,
      '/ll/services/diff_drive/wheel_distance_m': 0.325,
      '/ll/services/gps/datum_lat': 52.1,
      '/ll/services/gps/datum_long': 9.7,
      '/ll/services/gps/ntrip_password': 'x',
      '/ll/bind_ip': '10.0.0.2',
      '/xbot_monitoring/external_mqtt_enable': true,
    });
    expect(Object.keys(kept)).toEqual([
      '/ll/services/diff_drive/wheel_distance_m',
      '/move_base_flex/FTCPlanner/speed_fast',
      '/mower_logic/tool_width',
      '/xbot_positioning/antenna_offset_x',
    ]);
  });

  it('has the map closed as map.json has it and the run only with one', () => {
    const map = {areas: [{id: 'a', outline: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}], properties: {type: 'mow'}}], docking_stations: []};
    const g = gardenExport({created: 0, appVersion: '1', methods: null, map: map as never, planner: null, params: {}});
    expect(g.format).toBe('mowbite-garden-export');
    expect(g.map?.areas[0].outline).toHaveLength(4);
    expect('run' in g).toBe(false);
    expect('run' in gardenExport({created: 0, appVersion: '1', methods: null, map: null, planner: null, params: {}, startMap: null})).toBe(true);
  });

  it('takes logins and positions in degrees out of log lines', () => {
    expect(scrub('ntrip://me:secret@caster.example:2101/X')).toBe('ntrip://***@caster.example:2101/X');
    expect(scrub('password=abc token: xyz')).toBe('password=*** token: ***');
    expect(scrub('datum_lat 52.12345 lat=52.1 lon: 9.75 "latitude":52.1')).toBe('datum_lat *** lat=*** lon: *** "latitude":***');
    expect(scrub('lateral 0.05, along 1.2 m')).toBe('lateral 0.05, along 1.2 m');
  });
});
