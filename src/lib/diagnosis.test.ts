import {describe, expect, it} from 'vitest';
import {buildDiagnosis, collapse, gpsChanges, gpsSummary, noise} from './diagnosis';
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
      'RTK fix (2.0 cm) at 1.00, 2.00, Wi-Fi -50 dBm',
      'too inaccurate, the mower ignores it (30 cm) at 1.00, 2.00, Wi-Fi -60 dBm',
      'off in the dock approach (normal) at 1.00, 2.00, Wi-Fi -55 dBm',
    ]);
    expect(gpsSummary(s, 0.2)[0]).toContain('RTK fix 67 %');
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
    });
    for (const part of ['MowBite diagnosis', 'Problems', 'GPS the minute before', 'planner INFO', '/mower_logic/gps_timeout = 15', 'dock d: 1.000, 2.000', 'Raw: GPS'])
      expect(text).toContain(part);
    // the filler line only in the raw part
    expect(text.indexOf('Active Inputs')).toBeGreaterThan(text.indexOf('Raw data'));
  });
});
