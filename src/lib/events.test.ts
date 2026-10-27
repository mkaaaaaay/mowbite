import {describe, expect, it} from 'vitest';
import {
  describe as describeEvent,
  emergencyFlags,
  emergencyText,
  explain,
  groupRuns,
  homeReason,
  noteworthy,
  rawLine,
  type MowerEvent,
} from './events';

let id = 0;
const ev = (t: number, type: string, extra: Partial<MowerEvent> = {}): MowerEvent => ({id: String(id++), t, type, ...extra});

describe('groupRuns', () => {
  const day = [
    ev(0, 'BOOTED'),
    ev(100, 'STATE', {state: 'UNDOCKING'}),
    ev(110, 'UNDOCKED'),
    ev(120, 'STATE', {state: 'MOWING'}),
    ev(130, 'AREA', {area_name: 'Garden'}),
    ev(140, 'BLADES', {enabled: true}),
    ev(740, 'BLADES', {enabled: false}),
    ev(750, 'JOB_COMPLETE'),
    ev(800, 'DOCKED'),
    ev(900, 'SHUTDOWN'),
  ];

  it('makes one run from undocking to docking, the rest stays loose', () => {
    const entries = groupRuns(day, false);
    expect(entries.map((e) => e.kind)).toEqual(['event', 'run', 'event']);
    const run = entries[1].kind === 'run' ? entries[1].run : null;
    expect(run).toMatchObject({start: 100, end: 800, areas: ['Garden'], bladeSeconds: 600, outcome: 'done'});
  });

  it('shows a run that is still going as running', () => {
    const entries = groupRuns(day.slice(0, 6), true);
    const run = entries.find((e) => e.kind === 'run');
    expect(run?.kind === 'run' && run.run.outcome).toBe('running');
  });

  it('counts blade time up to the last event of an unfinished run', () => {
    const entries = groupRuns(day.slice(0, 6), false);
    const run = entries.find((e) => e.kind === 'run');
    expect(run?.kind === 'run' && run.run.bladeSeconds).toBe(0);
  });

  it('counts a run still going up to now, its blade time too', () => {
    const entries = groupRuns(day.slice(0, 6), true, 1000);
    const run = entries.find((e) => e.kind === 'run');
    expect(run?.kind === 'run' && run.run).toMatchObject({end: 1000, bladeSeconds: 860, outcome: 'running'});
  });

  it('ends a run where OpenMower started again, as interrupted', () => {
    const entries = groupRuns([...day.slice(1, 6), ev(500, 'BOOTED'), ev(600, 'STATE', {state: 'IDLE'})], true, 2000);
    const runs = entries.flatMap((e) => (e.kind === 'run' ? [e.run] : []));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({end: 140, bladeSeconds: 0, outcome: 'interrupted'});
    expect(groupRuns([...day.slice(1, 6), ev(500, 'SHUTDOWN')], false).find((e) => e.kind === 'run')).toMatchObject({
      run: {outcome: 'interrupted'},
    });
  });

  it('keeps a docking tried again in its run', () => {
    const entries = groupRuns(
      [
        ...day.slice(1, 8),
        ev(760, 'STATE', {state: 'DOCKING'}),
        ev(800, 'DOCKING_RETRY'),
        ev(801, 'STATE', {state: 'UNDOCKING'}),
        ev(820, 'STATE', {state: 'DOCKING'}),
        ev(860, 'DOCKED'),
      ],
      false,
    );
    const runs = entries.flatMap((e) => (e.kind === 'run' ? [e.run] : []));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({start: 100, end: 860, outcome: 'done'});
  });

  it('makes mowing by hand in recording mode a run of its own', () => {
    const entries = groupRuns(
      [
        ev(0, 'STATE', {state: 'AREA_RECORDING'}),
        ev(100, 'BLADES', {enabled: true}),
        ev(400, 'BLADES', {enabled: false}),
        ev(500, 'BLADES', {enabled: true}),
        ev(600, 'STATE', {state: 'IDLE'}),
      ],
      false,
    );
    const runs = entries.flatMap((e) => (e.kind === 'run' ? [e.run] : []));
    expect(runs.map((r) => [r.start, r.end, r.bladeSeconds, r.outcome])).toEqual([
      [100, 400, 300, 'manual'],
      [500, 600, 100, 'manual'],
    ]);
  });

  it('recognises a failed undock', () => {
    const entries = groupRuns(
      [ev(0, 'STATE', {state: 'UNDOCKING'}), ev(10, 'UNDOCKING_FAILED'), ev(20, 'STATE', {state: 'IDLE'})],
      false,
    );
    expect(entries[0].kind === 'run' && entries[0].run.outcome).toBe('undock_failed');
  });

  it('ends a run when docking failed, the next one starts when it leaves the dock again', () => {
    // docking gave up, the mower was put in the dock by hand (no DOCKED), it charged and went on mowing by itself
    const entries = groupRuns(
      [
        ev(0, 'STATE', {state: 'UNDOCKING'}),
        ev(10, 'STATE', {state: 'MOWING'}),
        ev(20, 'STATE', {state: 'DOCKING'}),
        ev(30, 'DOCKING_FAILED', {attempts: 4, reason: 'approach_failed'}),
        ev(31, 'STATE', {state: 'IDLE'}),
        ev(100, 'STATE', {state: 'UNDOCKING'}),
        ev(110, 'UNDOCKED'),
        ev(120, 'STATE', {state: 'MOWING'}),
        ev(130, 'AREA', {area_name: 'Back'}),
        ev(200, 'DOCKING', {reason: 'Battery average voltage low: 24.0 V'}),
        ev(210, 'STATE', {state: 'DOCKING'}),
        ev(300, 'DOCKING_FAILED', {attempts: 4, reason: 'dock_failed'}),
      ],
      false,
    );
    const runs = entries.flatMap((e) => (e.kind === 'run' ? [e.run] : []));
    expect(runs.map((r) => [r.start, r.end, r.outcome])).toEqual([
      [0, 31, 'dock_failed'],
      [100, 300, 'dock_failed'],
    ]);
    expect(runs[1].areas).toEqual(['Back']);
  });

  it('starts a new run on undocking even without an idle in between', () => {
    const entries = groupRuns(
      [ev(0, 'STATE', {state: 'UNDOCKING'}), ev(10, 'STATE', {state: 'MOWING'}), ev(50, 'STATE', {state: 'UNDOCKING'}), ev(60, 'STATE', {state: 'MOWING'})],
      false,
    );
    expect(entries.map((e) => (e.kind === 'run' ? e.run.start : null))).toEqual([0, 50]);
  });

  it('says why a run went home', () => {
    const home = (reason: string) =>
      groupRuns(
        [
          ev(0, 'STATE', {state: 'UNDOCKING'}),
          ev(10, 'UNDOCKED'),
          ev(20, 'STATE', {state: 'MOWING'}),
          ev(30, 'DOCKING', {reason}),
          ev(40, 'STATE', {state: 'DOCKING'}),
          ev(50, 'DOCKED'),
        ],
        false,
      )[0];
    const outcome = (reason: string) => {
      const e = home(reason);
      return e.kind === 'run' ? e.run.outcome : null;
    };
    expect(outcome('Battery average voltage low: 24.2 V')).toBe('battery');
    expect(outcome('Battery voltage critical: 23.1 V')).toBe('battery');
    expect(outcome('Rain detected')).toBe('rain');
    expect(outcome('Mow motor over temp: 71 °C')).toBe('hot');
    expect(outcome('Manual pause')).toBe('paused');
    expect(outcome('something new')).toBe('returned');
  });
});

describe('events', () => {
  it('reads the reasons for heading home', () => {
    expect(homeReason(undefined)).toBeNull();
    expect(homeReason('Battery average voltage low: 24.2 V')).toBe('battery');
    expect(describeEvent({id: '1', t: 0, type: 'DOCKING', reason: 'Battery average voltage low: 24.24 V'}).text).toContain('24.2');
  });

  it('shows a trip home for the battery but not a pause in the summary', () => {
    expect(noteworthy({id: '1', t: 0, type: 'DOCKING', reason: 'Rain detected'})).toBe(true);
    expect(noteworthy({id: '2', t: 0, type: 'DOCKING', reason: 'Manual pause'})).toBe(false);
    expect(noteworthy({id: '3', t: 0, type: 'BLADES', enabled: true})).toBe(false);
  });

  it('knows a mow motor that does not start and a full charge', () => {
    expect(describeEvent({id: '1', t: 0, type: 'MOW_MOTOR_SPINUP_FAILED'}).severity).toBe('error');
    expect(describeEvent({id: '2', t: 0, type: 'FULLY_CHARGED', battery_voltage: 28.42}).text).toContain('28.4');
  });
});

describe('sent home in the middle of a path', () => {
  const run = (navAt: number, dockingAt: number) =>
    groupRuns(
      [
        ev(100, 'STATE', {state: 'UNDOCKING'}),
        ev(110, 'STATE', {state: 'MOWING'}),
        ev(navAt, 'NAVIGATION_ERROR'),
        ev(dockingAt, 'STATE', {state: 'DOCKING'}),
        ev(dockingAt, 'BLADES', {enabled: false}),
        ev(dockingAt + 60, 'DOCKED'),
      ],
      false,
    );

  it("doesn't count the navigation error OpenMower reports with it as a problem", () => {
    const [entry] = run(200, 200);
    expect(entry.kind).toBe('run');
    if (entry.kind !== 'run') return;
    expect(entry.run.problems).toBe(0);
    const nav = entry.run.events.find((e) => e.type === 'NAVIGATION_ERROR')!;
    expect(describeEvent(nav).severity).toBe('info');
    expect(noteworthy(nav)).toBe(false);
  });

  it('still counts a real one, the docking long after it', () => {
    const [entry] = run(200, 260);
    expect(entry.kind === 'run' && entry.run.problems).toBe(1);
  });

  it('keeps the raw line as OpenMower wrote it', () => {
    const [entry] = run(200, 200);
    const nav = entry.kind === 'run' ? entry.run.events.find((e) => e.type === 'NAVIGATION_ERROR')! : null;
    expect(rawLine(nav!)).not.toContain('sentHome');
  });
});

describe('emergency stop reasons', () => {
  it('reads the bits mower_logic sends', () => {
    expect(emergencyFlags(128)).toEqual(['HIGH_LEVEL']);
    // MOWER_RPM_TIMEOUT, as the spinup check sends it, with what the firmware adds
    expect(emergencyFlags('1153')).toEqual(['LATCH', 'HIGH_LEVEL', 'MOWER_RPM_TIMEOUT']);
    expect(emergencyFlags(0)).toEqual([]);
    expect(emergencyFlags(undefined)).toEqual([]);
  });

  it('puts them in words, the telling one where two say the same', () => {
    expect(emergencyText(['LATCH', 'COLLISION', 'COLLISION_MULTIPLE', 'LIFT_MULTIPLE'])).toBe('bumper (several at once), lifted (several sensors)');
    expect(emergencyText(['HIGH_LEVEL', 'MOWER_RPM_TIMEOUT'])).toBe("mow motor didn't reach its speed");
    expect(emergencyText(['LATCH'])).toBe('');
    expect(emergencyText(['SOMETHING_NEW'])).toBe('something new');
  });

  it('names them in the activity instead of a code', () => {
    expect(describeEvent(ev(1, 'EMERGENCY', {emergency: true, reason: '1024'})).text).toBe("Emergency stop: mow motor didn't reach its speed");
    expect(describeEvent(ev(1, 'EMERGENCY', {emergency: true, reason: '128'})).text).toBe('Emergency stop: stopped by OpenMower');
    expect(describeEvent(ev(1, 'EMERGENCY', {emergency: true, reason: '0'})).text).toBe('Emergency stop');
    expect(describeEvent(ev(1, 'EMERGENCY', {emergency: true, reason: '65536'})).text).toBe('Emergency stop (code 65536)');
    expect(explain(ev(1, 'EMERGENCY', {emergency: true, reason: '1024'}))).toContain('mower_spinup_timeout');
    expect(explain(ev(1, 'EMERGENCY', {emergency: true, reason: '128'}))).toContain('ROS log');
  });
});
