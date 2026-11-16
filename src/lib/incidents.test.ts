import {beforeEach, describe, expect, it, vi} from 'vitest';
import {demoIncidents} from './demo/incidents';
import {downloadIncident, incidentOf, readIncident} from './incidents';
import type {MowerEvent} from './events';

let methods: Record<string, (params: unknown) => unknown> = {};
vi.mock('./rpc', () => ({callRpc: async (m: string, p: unknown) => methods[m](p)}));

describe('an incident of MowBite OS', () => {
  const now = 1_800_000_000;
  let emitted: {type: string; t: number; [k: string]: unknown}[] = [];
  let demo: ReturnType<typeof demoIncidents>;
  beforeEach(() => {
    emitted = [];
    demo = demoIncidents(() => now, (e) => emitted.push(e));
    methods = demo.methods;
  });

  it('puts the monotonic times of the window, the triggers and the timeline on the wall clock', () => {
    const answer = {
      manifest: {
        created: 1000,
        window: {from_ns: 50e9, to_ns: 200e9},
        triggers: [{kind: 'EMERGENCY', reason: 'LIFT', safety: true, t_ns: 100e9, utc: '2026-11-16T10:00:00Z'}],
        runs: [{name: 'mowbite_logic', revision: 'abc'}, {process: 'mowbite_hw'}],
        log: [
          {t: 1763287199.5, level: 30, name: 'mowbite_hw', msg: 'lift'},
          {t: 1763287199.6, level: 20, name: 'mowbite_hw', msg: 'info is left out'},
          {t: 1763287199.7, level: 40, name: 'mowbite_logic', msg: 'stop'},
        ],
      },
      timeline: [
        {t_ns: 99e9, process: 'mowbite_logic', stream: 'rpc', method: 'mowing.start'},
        {t_ns: 99.5e9, process: 'mowbite_hw', stream: 'imu', records: 100, bytes: 6400},
        {t_ns: 100e9, process: 'mowbite_logic', stream: 'state', view: {state: 'EMERGENCY'}},
        {t_ns: 101e9, process: 'mowbite_planner', end: 'signal 11'},
        {t_ns: 102e9, process: 'mowbite_hw', stream: 'imu', gap: {why: 'full', dropped: {imu: 3}}},
        {truncated: 7},
      ],
    };
    const d = readIncident(answer);
    const at = Date.parse('2026-11-16T10:00:00Z') / 1000;
    expect(d.triggers).toEqual([{kind: 'EMERGENCY', reason: 'LIFT', safety: true, t: at}]);
    expect([d.from, d.to]).toEqual([at - 50, at + 100]);
    expect(d.processes).toBe(2);
    expect(d.log.map((l) => l.level)).toEqual(['WARN', 'ERROR']);
    expect(d.log[0].text).toBe('mowbite_hw: lift');
    expect(d.timeline.map((l) => [l.t - at, l.text])).toEqual([
      [-1, 'rpc mowing.start()'],
      [0, 'state {"state":"EMERGENCY"}'],
      [1, 'ended: signal 11'],
      [2, 'gap: full'],
    ]);
    expect(d.left).toBe(7);
  });

  it('reads an answer it does not know without failing', () => {
    expect(readIncident(null)).toMatchObject({triggers: [], log: [], timeline: [], processes: 0, left: 0});
  });

  it('belongs to the event the INCIDENT came within a few seconds of', () => {
    const ev = (t: number, type: string, f: Partial<MowerEvent> = {}): MowerEvent => ({id: `${type}${t}`, t, type, ...f});
    const day = [ev(100, 'EMERGENCY'), ev(101.2, 'INCIDENT', {incident: 'a'}), ev(300, 'DOCKING_RETRY')];
    expect(incidentOf(day[0], day)).toBe('a');
    expect(incidentOf(day[1], day)).toBe('a');
    expect(incidentOf(day[2], day)).toBeUndefined();
  });

  it('opens one for a problem, with its INCIDENT, and not for an emergency let go', () => {
    demo.trigger({id: 'e1', type: 'EMERGENCY', t: now, emergency: true, reason: 1});
    demo.trigger({id: 'e2', type: 'EMERGENCY', t: now, emergency: false, reason: 0});
    demo.trigger({id: 'e3', type: 'GPS', t: now, available: false});
    expect(emitted.map((e) => [e.type, e.reason])).toEqual([
      ['INCIDENT', 'CRASH'],
      ['INCIDENT', 'EMERGENCY'],
    ]);
  });

  it('downloads in pieces once packed, checked piece by piece and as a whole', async () => {
    const [crash] = methods['incidents.list'](undefined) as {id: string}[];
    const got: number[] = [];
    vi.useFakeTimers();
    const download = downloadIncident(crash.id, false, (done) => got.push(done));
    await vi.runAllTimersAsync();
    const bytes = await download;
    vi.useRealTimers();
    expect(bytes.length).toBe(300000);
    expect(got).toEqual([262144, 300000]);
    expect(new TextDecoder().decode(bytes.subarray(0, 20))).toContain(crash.id.slice(0, 10));
  });
});
