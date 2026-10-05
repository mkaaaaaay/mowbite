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

  it('recognises a failed undock', () => {
    const entries = groupRuns(
      [ev(0, 'STATE', {state: 'UNDOCKING'}), ev(10, 'UNDOCKING_FAILED'), ev(20, 'STATE', {state: 'IDLE'})],
      false,
    );
    expect(entries[0].kind === 'run' && entries[0].run.outcome).toBe('undock_failed');
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
