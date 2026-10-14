import {describe, expect, it} from 'vitest';
import {buildDiagnosis, collapse, gpsChanges, gpsSummary, mergePlanner, noise, readKeptPlanner, rosEmergencies, whereOnMap} from './diagnosis';
import {readGpsLog} from './gpslog';
import type {Run} from './events';

describe('diagnosis', () => {
  it('counts lines that come again within seconds, also flipping back and forth', () => {
    const l = (t: number, text: string) => ({t, src: 'ros WARN', text});
    const out = collapse([l(1, 'a'), l(1.5, 'b'), l(2, 'a'), l(2.5, 'b'), l(3, 'a'), l(20, 'a')]);
    expect(out.map((o) => [o.text, o.n, o.until])).toEqual([
      ['a', 3, 3],
      ['b', 2, 2.5],
      ['a', 1, 20],
    ]);
  });

  it('a gps line only when it gets better or worse', () => {
    const s = readGpsLog(['1 MOWING 1 2 0.020 -50', '2 MOWING 1 2 0.021 -50', '3 MOWING 1 2 0.300 -60', '4 DOCKING 1 2 999 -55'].join('\n'));
    expect(gpsChanges(s, 0.2).map((l) => l.text)).toEqual([
      'at most 5 cm, RTK fix level (2.0 cm) at 1.00, 2.00, Wi-Fi -50 dBm',
      'too inaccurate, the mower ignores it (30 cm) at 1.00, 2.00, Wi-Fi -60 dBm',
      'off in the dock approach (normal) at 1.00, 2.00, Wi-Fi -55 dBm',
    ]);
    expect(gpsSummary(s, 0.2)[0]).toContain('at most 5 cm 67 %');
  });

  it('one bump is one stop, and one without latch is no stop', () => {
    const r = (t: number, from: string, to: string) => ({t, level: 'WARN' as const, text: `mower_comms_v2: Emergency reason changed from: '${from}' to: '${to}'`});
    const stops = rosEmergencies([
      r(1, '', 'LATCH, COLLISION_MULTIPLE'),
      r(1.2, 'LATCH, COLLISION_MULTIPLE', 'LATCH'),
      r(1.5, 'LATCH', 'LATCH, COLLISION'),
      r(1.6, 'LATCH, COLLISION', 'LATCH'),
      r(10, '', 'TIMEOUT_HIGH_LEVEL'),
      r(90, '', 'LATCH, COLLISION_MULTIPLE'),
    ]);
    expect(stops.map((s) => [s.t, s.reasons, s.latched])).toEqual([
      [1, 'COLLISION_MULTIPLE, COLLISION', true],
      [10, 'TIMEOUT_HIGH_LEVEL', false],
      [90, 'COLLISION_MULTIPLE', true],
    ]);
  });

  it('says where on the map', () => {
    const map = {areas: [{id: 'g', properties: {type: 'mow', name: 'Garten'}, outline: [{x: 0, y: 0}, {x: 4, y: 0}, {x: 4, y: 4}, {x: 0, y: 4}]}], docking_stations: []};
    expect(whereOnMap(map, 1, 0.5)).toBe('(1.00, 0.50) in mow "Garten", 50 cm inside its edge');
    expect(whereOnMap(map, 5, 1)).toBe('(5.00, 1.00), 100 cm outside mow "Garten"');
  });

  it('a bump right before docking is a note, not a problem', () => {
    const run: Run = {start: 0, end: 100, events: [{id: 'd', type: 'DOCKED', t: 50.7}], areas: [], bladeSeconds: 0, problems: 0, outcome: 'done'};
    const text = buildDiagnosis({
      run,
      appVersion: '1',
      created: 0,
      methods: null,
      params: {},
      kept: null,
      map: null,
      planner: null,
      gps: null,
      gpsLimit: 0.2,
      ros: [{t: 50, level: 'WARN', text: "mower_comms_v2: Emergency reason changed from: '' to: 'LATCH, COLLISION_MULTIPLE'"}],
      plannerLines: [],
      sensors: [],
      drive: null,
      snapshot: null,
    });
    expect(text).toContain('COLLISION_MULTIPLE while docking, docked 0.7 s later');
    expect(text).toMatch(/Problems\n-+\nnone/);
  });

  it('the planner lines the container kept and the ones in memory, each once', () => {
    const kept = readKeptPlanner('10.5 INFO planned\n12 ERROR failed\\nTraceback\nbroken');
    expect(kept).toEqual([
      {t: 10.5, level: 'INFO', msg: 'planned'},
      {t: 12, level: 'ERROR', msg: 'failed\nTraceback'},
    ]);
    expect(mergePlanner(kept, [{t: 12, level: 'ERROR', msg: 'failed\nTraceback'}, {t: 13, level: 'INFO', msg: 'new'}])?.map((l) => l.t)).toEqual([10.5, 12, 13]);
    expect(mergePlanner([], null)).toBeNull();
  });

  it('leaves out ros filler lines', () => {
    expect(noise('mower_comms_v2: Active Inputs bitmask: 32')).toBe(true);
    expect(noise('mower_comms_v2: "Bumper rear left" is active')).toBe(false);
  });

  it('puts it all in one file', () => {
    const run: Run = {
      start: 1000,
      end: 1100,
      events: [{id: 'a', type: 'EMERGENCY', t: 1050, emergency: true, reason: '64', x: 1, y: 2}],
      areas: ['Garten'],
      bladeSeconds: 60,
      problems: 1,
      outcome: 'emergency',
      jobId: 'j',
    };
    const text = buildDiagnosis({
      run,
      appVersion: '1.3.0',
      created: 2000,
      methods: ['rpc.methods'],
      params: {'/mower_logic/gps_timeout': 15},
      kept: {},
      map: {areas: [], docking_stations: [{id: 'd', position: {x: 1, y: 2}, heading: 0}]},
      planner: null,
      gps: readGpsLog('1049 MOWING 1 2 0.020 -50\n1050 MOWING 1 2 0.020 -50'),
      gpsLimit: 0.2,
      ros: [{t: 1050, level: 'WARN', text: 'mower_comms_v2: Active Inputs bitmask: 4'}],
      plannerLines: [{t: 1040, level: 'INFO', msg: 'planned'}],
      sensors: [],
      drive: null,
      snapshot: null,
    });
    for (const part of ['MowBite diagnosis', 'Problems', 'GPS the minute before', 'planner INFO', '/mower_logic/gps_timeout = 15', 'dock d: 1.000, 2.000', 'Raw: GPS'])
      expect(text).toContain(part);
    // the filler line only in the raw part
    expect(text.indexOf('Active Inputs')).toBeGreaterThan(text.indexOf('Raw data'));
  });
});
