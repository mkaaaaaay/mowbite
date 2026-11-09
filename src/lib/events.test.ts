import {describe, expect, it, vi} from 'vitest';
import {clock} from './dates';
import {setLangChoice} from './i18n';
import {
  chargeConfirmed,
  describe as describeEvent,
  emergencyFlags,
  emergencyText,
  explain,
  groupRuns,
  homeReason,
  noteworthy,
  parseEvent,
  rawLine,
  reasonText,
  refusalReason,
  resetRefusedText,
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
    // MowBite OS's names
    expect(outcome('BATTERY_CRITICAL')).toBe('battery');
    expect(outcome('BATTERY_HOT')).toBe('battery_hot');
    expect(outcome('DARK')).toBe('dark');
    expect(outcome('MANUAL')).toBe('paused');
  });

  it("says when MowBite OS gave up docking because no current came, it stays on the contacts", () => {
    const runs = groupRuns(
      [
        ev(0, 'STATE', {state: 'UNDOCKING'}),
        ev(20, 'STATE', {state: 'MOWING'}),
        ev(30, 'STATE', {state: 'DOCKING'}),
        ev(40, 'DOCKING_FAILED', {reason: 'NO_CHARGE_CURRENT', attempts: 3, current: 0.01, limit: 0.3}),
        ev(41, 'STATE', {state: 'IDLE'}),
      ],
      false,
    );
    expect(runs[0].kind === 'run' && runs[0].run.outcome).toBe('no_charge');
  });
});

describe('heading home and charging on MowBite OS', () => {
  const os = (type: string, extra: Partial<MowerEvent> = {}) => describeEvent(ev(0, type, extra), undefined, true).text;

  it('says why it goes home with its numbers', () => {
    expect(os('DOCKING', {reason: 'MANUAL'})).toBe('Sent home');
    expect(os('DOCKING', {reason: 'BATTERY_LOW', battery_voltage: 24.13, limit: 24.5})).toBe('Heading home to charge: battery low (24.1 V)');
    expect(os('DOCKING', {reason: 'BATTERY_CRITICAL', battery_voltage: 20.94, limit: 21})).toBe('Heading home to charge: battery critically low (20.9 V)');
    expect(os('DOCKING', {reason: 'MOTOR_HOT', temperature: 71.2, limit: 70})).toBe('Heading home: mow motor too hot (71 °C, the limit is 70 °C)');
    expect(os('DOCKING', {reason: 'BATTERY_HOT', temperature: 56, limit: 55})).toBe('Heading home: battery too hot (56 °C, the limit is 55 °C)');
    expect(os('DOCKING', {reason: 'RAIN'})).toBe('Heading home: rain');
    expect(os('DOCKING', {reason: 'DARK', sun_elevation: -1.1, limit: -0.833})).toBe('Heading home: the sun has set');
    expect(noteworthy(ev(0, 'DOCKING', {reason: 'DARK', severity: 'info'}), undefined, true)).toBe(true);
    expect(noteworthy(ev(0, 'DOCKING', {reason: 'MANUAL', severity: 'info'}), undefined, true)).toBe(false);
  });

  it('says why a start was turned down or it stayed out, without a way home', () => {
    expect(os('MOWING_REFUSED', {reason: 'MOTOR_HOT', temperature: 52, limit: 40})).toBe(
      'Mowing not started: mow motor still too hot (52 °C, it has to cool down to 40 °C)',
    );
    expect(os('BATTERY_LOW', {battery_voltage: 22.44, limit: 23})).toBe("Battery low (22.4 V), it can't go home and stays where it is");
    const rain = ev(0, 'STATE', {state: 'PAUSED', reason: 'RAIN', severity: 'info', resume: 'user'});
    expect(describeEvent(rain, undefined, true)).toEqual({text: 'Paused: rain', severity: 'info'});
    expect(explain(rain, undefined, undefined, true)).toContain("can't go home by itself");
    expect(explain(ev(0, 'STATE', {state: 'PAUSED', reason: 'RAIN', resume: 'auto'}), undefined, undefined, true)).toBe('It goes on by itself once that is over.');
  });

  it("doesn't count tries it never made, nor a position 999 m off", () => {
    expect(os('DOCKING_FAILED', {reason: 'NO_HEADING'})).toBe('Docking failed (heading not known yet)');
    expect(os('DOCKING_FAILED', {reason: 'POSITION_ACCURACY', accuracy: 999, limit: 0.1})).toBe('Docking failed (no position)');
    expect(os('DOCKING_FAILED', {reason: 'approach_failed', attempts: 3})).toBe('Docking failed after 3 tries (approach failed)');
  });

  it('says in the dock without current "not charging"', () => {
    expect(os('DOCKING_FAILED', {reason: 'NO_CHARGE_CURRENT', attempts: 3, current: 0.01, limit: 0.3})).toBe(
      'Docking failed after 3 tries (on the contacts but not charging)',
    );
    const hint = explain(ev(0, 'DOCKING_FAILED', {reason: 'NO_CHARGE_CURRENT', attempts: 3, current: 0.01, limit: 0.3}), undefined, undefined, true)!;
    expect(hint).toContain('only 0.01 A came, at least 0.30 A');
    expect(hint).toContain('stays on the contacts');
    expect(os('CHARGING_LOST', {reason: 'NO_CHARGE_CURRENT', battery_percentage: 64, current: 0, limit: 0.3})).toBe(
      'Not charging (64 %): in the dock, but no charge current (0.00 A, at least 0.30 A expected)',
    );
    expect(os('CHARGING_LOST', {reason: 'NO_DOCK_CONTACT', battery_percentage: 64})).toBe('Not charging (64 %): off the charging contacts');
  });

  it('charges only once DOCKED is newer than what leaves it unconfirmed', () => {
    expect(chargeConfirmed([])).toBeNull();
    expect(chargeConfirmed([ev(10, 'DOCKED'), ev(5, 'BOOTED')])).toBe(true);
    expect(chargeConfirmed([ev(5, 'DOCKED'), ev(10, 'BOOTED')])).toBe(false);
    expect(chargeConfirmed([ev(5, 'DOCKED'), ev(10, 'STATE', {state: 'IDLE'}), ev(20, 'CHARGING_LOST', {reason: 'NO_CHARGE_CURRENT'})])).toBe(false);
    expect(chargeConfirmed([ev(5, 'DOCKED'), ev(10, 'STATE', {state: 'UNDOCKING'})])).toBe(false);
    expect(chargeConfirmed([ev(5, 'DOCKED'), ev(10, 'STATE', {state: 'AREA_RECORDING'}), ev(20, 'STATE', {state: 'IDLE'})])).toBe(true);
    expect(chargeConfirmed([ev(5, 'DOCKING_FAILED', {reason: 'NO_CHARGE_CURRENT'}), ev(30, 'DOCKED')])).toBe(true);
    // seen off the contacts after it
    expect(chargeConfirmed([ev(5, 'DOCKED')], 8)).toBe(false);
    expect(chargeConfirmed([ev(5, 'DOCKED')], 3)).toBe(true);
    expect(chargeConfirmed([], 3)).toBe(false);
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
    // only what holds it, no reason of its own
    expect(describeEvent(ev(1, 'EMERGENCY', {emergency: true, reason: '1'})).text).toBe('Emergency stop (code 1)');
    expect(explain(ev(1, 'EMERGENCY', {emergency: true, reason: '1024'}))).toContain('mower_spinup_timeout');
    expect(explain(ev(1, 'EMERGENCY', {emergency: true, reason: '128'}))).toContain('ROS log');
    expect(explain(ev(1, 'EMERGENCY', {emergency: true, reason: '33'}))).toBe('Stop button, lift, tilt or a bumper. It has to be released and reset before it drives again.');
    // the board's own reasons each with their own help, the stop button's words only for what was set off at the mower
    const help = (reason: number) => explain(ev(1, 'EMERGENCY', {emergency: true, reason: String(reason + 1)}));
    expect(help(2)).toMatch(/^The board's inputs/);
    expect(help(64)).toMatch(/^The board heard nothing from the mower's software/);
    expect(help(256)).toMatch(/^A part of the board's firmware wasn't ready/);
    expect(help(2048)).toMatch(/^The mow motor turned outside its allowed speed/);
    expect(help(4096)).toMatch(/^The board's firmware doesn't fit/);
    for (const bit of [2, 3, 4, 5, 9]) expect(help(2 ** bit)).toMatch(/^Stop button, lift, tilt or a bumper/);
    expect(help(0)).toBeUndefined();
  });

  it("reads MowBite OS's own bits, all 32 of them, one without a name as BIT_<n>", () => {
    // as the YardForce's driver latches a wheel turning against the command
    expect(emergencyFlags(262145)).toEqual(['LATCH', 'WHEEL_RUNAWAY']);
    expect(emergencyFlags(2 ** 13 + 2 ** 14 + 2 ** 16 + 2 ** 17 + 2 ** 19 + 2 ** 20)).toEqual([
      'TILT',
      'FENCE',
      'IMU_TIMEOUT',
      'MOWER_NOT_STOPPED',
      'FOREIGN_HOST',
      'DRIVER_STALL',
    ]);
    expect(emergencyFlags(2 ** 15 + 1)).toEqual(['LATCH', 'STUCK']);
    expect(emergencyFlags(2 ** 22 + 1)).toEqual(['LATCH', 'BIT_22']);
    expect(emergencyFlags(2 ** 31 + 32)).toEqual(['COLLISION', 'BIT_31']);
    expect(emergencyFlags(String(2 ** 32 - 1))).toHaveLength(32);
  });

  it('says a bit without a name next to the others, it never drops out', () => {
    expect(emergencyText(['LATCH', 'COLLISION', 'BIT_22'])).toBe('bumper, bit 22');
    expect(emergencyText(['LATCH', 'BIT_22'])).toBe('bit 22');
    expect(emergencyText(['LATCH', 'WHEEL_RUNAWAY'])).toBe('wheel turning against the command');
    // what MowBite OS's log line says for a bit it has no name for
    expect(emergencyText(['UNKNOWN'])).toBe('unknown reason');
    expect(describeEvent(ev(1, 'EMERGENCY', {emergency: true, reason: String(2 ** 22 + 32 + 1)})).text).toBe('Emergency stop: bumper, bit 22');
    expect(describeEvent(ev(1, 'EMERGENCY', {emergency: true, reason: '65536'})).text).toBe('Emergency stop: no data from the IMU');
  });

  it("helps with MowBite OS's own reasons, not with the stop button's words", () => {
    const stop = (reason: number, os = true) => explain(ev(1, 'EMERGENCY', {emergency: true, reason: String(reason)}), undefined, undefined, os);
    expect(stop(2 ** 18 + 1)).toMatch(/^A wheel turned against the drive command/);
    expect(stop(2 ** 16)).toMatch(/^The IMU's data stopped coming/);
    expect(stop(2 ** 13 + 1)).toMatch(/below its release angle\.$/);
    expect(stop(2 ** 19 + 1)).toMatch(/OpenMower still running next to MowBite OS/);
    // a sentence or two each, the bits that came together
    expect(stop(2 ** 20 + 2 ** 17 + 1)).toBe(
      'The blade was switched off but kept turning faster than allowed. Let it run down, then check that the mow motor stops when told to. ' +
        'The hardware driver hung for too long, so it stopped to be safe. Once can be a load peak, if it happens again the log from that moment says more.',
    );
    // set from above on MowBite OS, the driver's own reasons have bits of their own there
    expect(stop(129)).toMatch(/^Something above the board latched it/);
    expect(stop(129, false)).toMatch(/^OpenMower stopped the mower itself/);
    expect(stop(2 ** 15 + 1)).toMatch(/^The wheels turned, but by the GPS/);
    expect(stop(2 ** 22 + 1)).toMatch(/^A reason MowBite doesn't know yet/);
    expect(stop(2 ** 21 + 1)).toMatch(/the activity says what happened\.$/);
  });

  it('in german', () => {
    vi.stubGlobal('document', {documentElement: {lang: 'en'}});
    setLangChoice('de');
    try {
      expect(describeEvent(ev(1, 'EMERGENCY', {emergency: true, reason: String(2 ** 18 + 2 ** 22 + 1)})).text).toBe('Notaus: Rad dreht gegen den Befehl, Bit 22');
      expect(emergencyText(['LATCH', 'TILT', 'LIFT'])).toBe('zu stark geneigt, angehoben');
    } finally {
      setLangChoice('en');
      vi.unstubAllGlobals();
    }
  });
});

describe('a reset of the emergency stop MowBite OS turned down', () => {
  const refused = (extra: Partial<MowerEvent>) => ev(1, 'EMERGENCY_RESET_REFUSED', {resume: 'user', message: 'english text', ...extra});

  it('says why with its numbers, still tilted only a warning', () => {
    expect(describeEvent(refused({reason: 'STILL_TILTED', angle: 34.4, limit: 26, severity: 'warning'}), undefined, true)).toEqual({
      text: 'Emergency stop not reset: still tilted (34°, less than 26° needed)',
      severity: 'warning',
    });
    expect(describeEvent(refused({reason: 'STILL_TILTED'})).severity).toBe('warning');
    expect(describeEvent(refused({reason: 'TILT_UNKNOWN', seconds: 2.04, severity: 'error'}), undefined, true)).toEqual({
      text: 'Emergency stop not reset: tilt unknown, no data from the IMU for 2.0 s',
      severity: 'error',
    });
    expect(describeEvent(refused({reason: 'TILT_UNKNOWN'})).text).toBe('Emergency stop not reset: tilt unknown, no data from the IMU');
    expect(describeEvent(refused({reason: 'FOREIGN_HOST'})).text).toBe('Emergency stop not reset: another computer is talking to the board');
    expect(describeEvent(refused({reason: 'DRIVER_MISSING'})).text).toBe('Emergency stop not reset: the hardware driver is not running');
    expect(describeEvent(refused({reason: 'SAFETY_MISSING'})).text).toBe('Emergency stop not reset: the safety filter is not running');
    expect(describeEvent(refused({reason: 'NO_ANSWER'}))).toEqual({text: 'Emergency stop not reset: no answer in time', severity: 'error'});
    // one it doesn't know yet by the mower's words
    expect(describeEvent(refused({reason: 'SOMETHING_NEW'})).text).toBe('Emergency stop not reset: english text');
    expect(noteworthy(refused({reason: 'STILL_TILTED', severity: 'warning'}), undefined, true)).toBe(true);
  });

  it('says what to do and, where it is reset, in a few words', () => {
    expect(explain(refused({reason: 'STILL_TILTED', angle: 34, limit: 26}))).toBe('Stand it level, then reset it again.');
    expect(explain(refused({reason: 'TILT_UNKNOWN'}))).toMatch(/check the IMU/);
    expect(explain(refused({reason: 'FOREIGN_HOST'}))).toMatch(/^Stop the other computer or program first/);
    expect(explain(refused({reason: 'NO_ANSWER'}))).toMatch(/^A part of MowBite OS didn't answer/);
    expect(explain(refused({reason: 'RESTART_HOLD_STAYS'}))).toMatch(/^The mower couldn't delete its hold/);
    expect(resetRefusedText(refused({reason: 'STILL_TILTED', angle: 34, limit: 26}))).toBe('Not reset: still tilted (34°, less than 26° needed)');
    expect(resetRefusedText(refused({reason: ''}))).toBe('Not reset');
  });

  it('in german', () => {
    vi.stubGlobal('document', {documentElement: {lang: 'en'}});
    setLangChoice('de');
    try {
      expect(describeEvent(refused({reason: 'STILL_TILTED', angle: 34.4, limit: 26})).text).toBe('Notaus nicht zurückgesetzt: noch geneigt (34°, weniger als 26° nötig)');
      expect(describeEvent(refused({reason: 'TILT_UNKNOWN', seconds: 2.04})).text).toBe(
        'Notaus nicht zurückgesetzt: Neigung unbekannt, seit 2,0 s keine Daten von der IMU',
      );
      expect(resetRefusedText(refused({reason: 'FOREIGN_HOST'}))).toBe('Nicht zurückgesetzt: ein anderer Rechner spricht mit der Platine');
      expect(explain(refused({reason: 'STILL_TILTED'}))).toBe('Gerade hinstellen, dann noch einmal zurücksetzen.');
    } finally {
      setLangChoice('en');
      vi.unstubAllGlobals();
    }
  });
});

describe('recording an area (MowBite OS)', () => {
  const refused = (action: string, reason: string) => ev(0, 'RECORDING_REFUSED', {action, reason, x: 1, y: 2});

  it('says which step was refused and why, as a warning', () => {
    expect(describeEvent(refused('stop_recording', 'Cannot close the ring: the line crosses itself'))).toEqual({
      text: 'Line not closed: the line crosses itself',
      severity: 'warning',
    });
    expect(describeEvent(refused('finish_mowing_area', 'Cannot close the ring: a ring needs at least 3 points, it has 2')).text).toBe(
      "Mowing area not saved: a line needs at least 3 points, it has 2",
    );
    expect(describeEvent(refused('point', 'Position accuracy 0.30 m, points need 0.10 m or better')).text).toBe(
      'No points recorded: position accurate to 0.30 m, points need 0.10 m or better',
    );
    expect(explain(refused('point', 'x'))).toMatch(/no points/);
    expect(explain(refused('record_dock', 'x'))).toMatch(/stays open/);
  });

  it('keeps a reason or step it does not know as it came', () => {
    expect(describeEvent(refused('start_area_recording', 'Map server not answering')).text).toBe("Recording mode didn't start: Map server not answering");
    expect(describeEvent(refused('something_new', '')).text).toBe('Recording step refused');
    expect(describeEvent(ev(0, 'RECORDING_REFUSED')).text).toBe('Recording step refused');
  });

  it('puts the reasons and numbers in german', () => {
    vi.stubGlobal('document', {documentElement: {lang: 'en'}});
    setLangChoice('de');
    try {
      expect(describeEvent(refused('stop_recording', 'Cannot close the ring: it encloses only 0.03 m², at least 0.05 needed')).text).toBe(
        'Linie nicht geschlossen: sie umschließt nur 0,03 m², mindestens 0,05 m² nötig',
      );
      expect(refusalReason('Position accuracy 0.30 m, the docking station needs 0.10 m or better')).toBe(
        'Position auf 0,30 m genau, die Ladestation braucht 0,10 m oder besser',
      );
      expect(refusalReason('Position accuracy nan m, points need 0.10 m or better')).toBe('Position auf ? m genau, Punkte brauchen 0,10 m oder besser');
      expect(refusalReason('Only 0.12 m from the first point, at least 0.30 m needed for the heading')).toBe(
        'nur 0,12 m vom ersten Punkt, für die Richtung sind mindestens 0,30 m nötig',
      );
      expect(refusalReason('The map does not fit the datum in use')).toBe('die Karte passt nicht zum verwendeten Bezugspunkt');
      expect(describeEvent(ev(0, 'AREA_RECORDED', {area_type: 'mow', area_m2: 123.4, obstacles: 2, points: 80})).text).toBe(
        'Mähfläche aufgenommen (123 m², 2 Hindernisse)',
      );
    } finally {
      setLangChoice('en');
      vi.unstubAllGlobals();
    }
  });

  it('tells what was recorded', () => {
    expect(describeEvent(ev(0, 'AREA_RECORDED', {area_type: 'nav', area_m2: 4.25, obstacles: 0})).text).toBe('Navigation area recorded (4.3 m²)');
    expect(describeEvent(ev(0, 'AREA_RECORDED', {area_type: 'mow', area_m2: 50, obstacles: 1})).text).toBe('Mowing area recorded (50 m², 1 obstacle)');
    expect(describeEvent(ev(0, 'AREA_RECORDED')).text).toBe('Mowing area recorded');
    expect(describeEvent(ev(0, 'DOCK_RECORDED', {dock_id: 'd1', heading: 1.2}))).toEqual({text: 'Docking station recorded', severity: 'info'});
  });

  it('leaves them out of runs, recording mode is no run', () => {
    const day = [ev(10, 'STATE', {state: 'AREA_RECORDING'}), refused('stop_recording', 'x'), ev(20, 'AREA_RECORDED', {area_m2: 10}), ev(30, 'STATE', {state: 'IDLE'})];
    expect(groupRuns(day, false).map((e) => e.kind)).toEqual(['event', 'event', 'event', 'event']);
    expect(noteworthy(refused('point', 'x'))).toBe(true);
  });

  it('reads an event as it comes live', () => {
    expect(parseEvent('{"id":"a","t":5,"type":"RECORDING_REFUSED","action":"collect_point","reason":"No position"}')).toMatchObject({
      id: 'a',
      t: 5,
      action: 'collect_point',
    });
    expect(parseEvent('not json')).toBeNull();
    expect(parseEvent('{"t":5}')).toBeNull();
    expect(parseEvent('null')).toBeNull();
  });
});

describe('runs on MowBite OS', () => {
  // it doesn't dock yet: mowing, then idle where it stands
  const day = [
    ev(100, 'STATE', {state: 'MOWING'}),
    ev(110, 'AREA', {area_name: 'Front'}),
    ev(120, 'BLADES', {enabled: true}),
    ev(700, 'BLADES', {enabled: false}),
    ev(710, 'STATE', {state: 'IDLE'}),
    ev(900, 'GPS', {available: false}),
  ];
  const runs = (events: MowerEvent[], os: boolean) => groupRuns(events, true, 2000, os).flatMap((e) => (e.kind === 'run' ? [e.run] : []));

  it('ends a run idle on the lawn, what comes after stays loose', () => {
    const entries = groupRuns(day, true, 2000, true);
    expect(entries.map((e) => e.kind)).toEqual(['run', 'event']);
    expect(runs(day, true)[0]).toMatchObject({start: 100, end: 710, bladeSeconds: 580, outcome: 'stopped', areas: ['Front']});
  });

  it('says finished when the job was done', () => {
    const done = [...day.slice(0, 4), ev(705, 'JOB_COMPLETE'), day[4]];
    expect(runs(done, true)[0].outcome).toBe('done');
  });

  it('leaves the next start a run of its own', () => {
    expect(runs([...day, ev(1000, 'STATE', {state: 'MOWING'}), ev(1100, 'STATE', {state: 'IDLE'})], true).map((r) => [r.start, r.end])).toEqual([
      [100, 710],
      [1000, 1100],
    ]);
  });

  it('ends it the usual way once it docks', () => {
    const docking = [
      ev(100, 'STATE', {state: 'UNDOCKING'}),
      ev(110, 'STATE', {state: 'MOWING'}),
      ev(400, 'STATE', {state: 'IDLE'}),
      ev(500, 'STATE', {state: 'DOCKING'}),
      ev(600, 'DOCKED'),
    ];
    expect(runs(docking, true).map((r) => [r.start, r.end, r.outcome])).toEqual([[100, 600, 'returned']]);
  });

  it('keeps OpenMower as it was: idle in the middle goes on until docked', () => {
    expect(runs(day, false)).toHaveLength(1);
    expect(runs(day, false)[0]).toMatchObject({end: 900, outcome: 'running'});
  });
});

describe('reasons as fixed names (MowBite OS)', () => {
  const os = (type: string, extra: Partial<MowerEvent>) => ev(0, type, {severity: 'error', resume: 'user', message: 'english text', ...extra});

  it('says them in words with their numbers, the english text only for a name it does not know', () => {
    expect(describeEvent(os('MOWING_REFUSED', {reason: 'BATTERY_LOW', battery_voltage: 22.14, limit: 23}), undefined, true)).toEqual({
      text: 'Mowing not started: battery low (22.1 V, at least 23.0 V needed)',
      severity: 'error',
    });
    expect(describeEvent(os('MOWING_REFUSED', {reason: 'POSITION_ACCURACY', accuracy: 0.351, limit: 0.2})).text).toBe(
      'Mowing not started: position accurate to 0.35 m, 0.20 m or better needed',
    );
    expect(describeEvent(os('STATE', {state: 'PAUSED', reason: 'POSITION_ACCURACY', accuracy: 0.124, limit: 0.1})).text).toBe(
      'Paused: position accurate to 0.12 m, 0.10 m or better needed',
    );
    expect(describeEvent(os('STATE', {state: 'PAUSED', reason: 'POSITION_ACCURACY'})).text).toBe('Paused: position not accurate enough');
    expect(describeEvent(os('MOWING_REFUSED', {reason: 'NO_HEADING'})).text).toBe('Mowing not started: heading not known yet');
    expect(describeEvent(os('DRIVE_REFUSED', {reason: 'NO_SAFETY_MEASUREMENT'})).text).toBe(
      'Drive not started: safety not yet verified on this platform, mowing and driving are blocked',
    );
    expect(describeEvent(os('MOWING_REFUSED', {reason: 'BUSY', state: 'MOWING'})).text).toBe('Mowing not started: busy: Mowing');
    expect(describeEvent(os('DRIVE_REFUSED', {reason: 'MAP_MISMATCH', datum_state: 'unbound'})).text).toBe(
      'Drive not started: the map has no reference point recorded',
    );
    expect(describeEvent(os('MOWING_REFUSED', {reason: 'SOMETHING_NEW'})).text).toBe('Mowing not started: english text');
    expect(describeEvent(ev(0, 'MOWING_REFUSED', {reason: 'SOMETHING_NEW'})).text).toBe('Mowing not started: something new');
    expect(reasonText(os('X', {reason: 'NO_POSITION'}))).toBe('no position');
    expect(reasonText(os('CALIBRATION_FAILED', {reason: 'TIMEOUT'}))).toBe('took too long');
    expect(reasonText(ev(0, 'DOCKING_FAILED', {reason: 'TIMEOUT'}))).toBe('not getting on, maybe stuck');
    // free text from before stays as it came
    expect(describeEvent(ev(0, 'MOWING_REFUSED', {reason: 'No position from the localization'})).text).toBe(
      'Mowing not started: No position from the localization',
    );
  });

  it('takes how bad it is from the event on MowBite OS only', () => {
    const paused = os('STATE', {state: 'PAUSED', reason: 'POSE_LOST', severity: 'warning', resume: 'auto'});
    expect(describeEvent(paused, 'MOWING', true)).toEqual({text: 'Paused: position lost', severity: 'warning'});
    expect(describeEvent(os('STATE', {state: 'PAUSED', reason: 'CROSS_TRACK'}), 'MOWING', true).severity).toBe('error');
    // without system.info saying so, or without the field, its own
    expect(describeEvent(os('STATE', {state: 'PAUSED', reason: 'CROSS_TRACK'}), 'MOWING').severity).toBe('warning');
    expect(describeEvent(ev(0, 'STATE', {state: 'PAUSED', reason: 'MANUAL'}), 'MOWING', true)).toEqual({text: 'Paused', severity: 'info'});
    expect(describeEvent(os('EMERGENCY', {emergency: false, reason: '0', severity: 'info'}), undefined, true).severity).toBe('info');
    expect(describeEvent(os('AREA_SKIPPED', {reason: 'MANUAL', severity: 'bogus'}), undefined, true).severity).toBe('info');
    expect(noteworthy(os('STATE', {state: 'PAUSED', reason: 'MANUAL', severity: 'info'}), 'MOWING', true)).toBe(false);
  });

  it('says whether it goes on by itself', () => {
    expect(explain(os('STATE', {state: 'PAUSED', reason: 'HEADING', resume: 'auto'}), 'MOWING', undefined, true)).toMatch(/by itself/);
    expect(explain(os('STATE', {state: 'PAUSED', reason: 'TIMEOUT', resume: 'user'}), 'MOWING', undefined, true)).toMatch(/until you continue/);
    expect(explain(os('STATE', {state: 'PAUSED', reason: 'MANUAL', resume: 'user'}), 'MOWING', undefined, true)).toBeUndefined();
    expect(explain(os('STATE', {state: 'PAUSED', reason: 'TIMEOUT', resume: 'user'}), 'MOWING')).toBeUndefined();
  });

  it('tells drives, jumps and the map', () => {
    expect(describeEvent(os('DRIVE', {phase: 'start', severity: 'info'})).text).toBe('Driving to a point');
    expect(describeEvent(os('DRIVE', {phase: 'end', arrived: true, reason: 'DONE', severity: 'info'}))).toEqual({text: 'Arrived', severity: 'info'});
    expect(describeEvent(os('DRIVE', {phase: 'end', arrived: true, reason: 'ALREADY_THERE'})).text).toBe('Already there');
    expect(describeEvent(os('DRIVE', {phase: 'end', arrived: false, reason: 'STOPPED'}))).toEqual({text: 'Drive ended: stopped', severity: 'info'});
    expect(describeEvent(os('DRIVE', {phase: 'end', arrived: false, reason: 'TRANSIT_FAILED'}), undefined, true)).toEqual({
      text: 'Drive ended: no way there could be planned',
      severity: 'error',
    });
    expect(describeEvent(os('POSITION_JUMP', {reason: 'GAP', distance: 0.4})).text).toBe('Position jumped 0.40 m: back on GPS after a gap');
    expect(describeEvent(os('MAP_DATUM', {state: 'mismatch', reason: 'MAP_MISMATCH'}))).toEqual({
      text: "No mowing: the map doesn't fit the reference point in use",
      severity: 'error',
    });
  });

  it('refusals while recording as before, with the names', () => {
    const refused = (action: string, extra: Partial<MowerEvent>) => describeEvent(os('RECORDING_REFUSED', {action, ...extra})).text;
    expect(refused('finish_mowing_area', {reason: 'RING_FEW_POINTS', points: 2, limit: 3})).toBe(
      "Mowing area not saved: a line needs at least 3 points, it has 2",
    );
    expect(refused('stop_recording', {reason: 'RING_CROSSES_ITSELF'})).toBe('Line not closed: the line crosses itself');
    expect(refused('point', {reason: 'POSITION_ACCURACY', accuracy: null, limit: 0.1})).toBe(
      'No points recorded: position accurate to ? m, points need 0.10 m or better',
    );
    expect(refused('record_dock', {reason: 'DOCK_TOO_CLOSE', distance: 0.123, limit: 0.3})).toBe(
      'Docking station not recorded: only 0.12 m from the first point, the direction needs at least 0.30 m',
    );
    expect(refused('finish_navigation_area', {reason: 'SAVE_FAILED', code: 'TOO_LARGE'})).toBe('Navigation area not saved: saving failed: the map got too large');
    expect(refused('finish_navigation_area', {reason: 'SAVE_FAILED', code: 'WHATEVER', message: 'disk on fire'})).toBe('Navigation area not saved: disk on fire');
  });

  it('tells sizes set and leftovers ready to mow (MowBite OS)', () => {
    const small = os('GEOMETRY_CHANGED', {reason: 'BELOW_DEFAULT', severity: 'warning', changed: ['robot_width', 'robot_front'], below_default: ['robot_width']});
    expect(describeEvent(small)).toEqual({
      text: "Sizes changed: smaller than from the factory, the planner's body check works with the smaller outline",
      severity: 'warning',
    });
    expect(explain(small)).toBe('Set smaller than from the factory: Width.');
    expect(describeEvent(ev(0, 'GEOMETRY_CHANGED', {changed: ['mower_width'], below_default: [], severity: 'info'}), undefined, true)).toEqual({
      text: 'Sizes changed',
      severity: 'info',
    });
    expect(explain(ev(0, 'GEOMETRY_CHANGED', {below_default: []}))).toBeUndefined();
    expect(describeEvent(ev(0, 'LEFTOVERS_ARMED', {area_m2: 3.4, job_id: 'j'})).text).toBe('Leftovers ready to mow (3 m²)');
  });

  it('says until when an update holds it (MowBite OS)', () => {
    const until = 1793754213;
    expect(describeEvent(os('MOWING_REFUSED', {reason: 'HOLD', until, severity: 'info'}), undefined, true)).toEqual({
      text: `Mowing not started: update running until ${clock(until)}`,
      severity: 'info',
    });
    expect(describeEvent(os('DRIVE_REFUSED', {reason: 'HOLD'})).text).toBe('Drive not started: update running');
    expect(describeEvent(os('RECORDING_REFUSED', {action: 'start_area_recording', reason: 'HOLD', until})).text).toBe(
      `Recording mode didn't start: update running until ${clock(until)}`,
    );
    expect(reasonText(os('X', {reason: 'HOLD', until: 0}))).toBe('update running');
  });

  it('in german', () => {
    vi.stubGlobal('document', {documentElement: {lang: 'en'}});
    setLangChoice('de');
    try {
      expect(describeEvent(os('MOWING_REFUSED', {reason: 'BATTERY_LOW', battery_voltage: 22.14, limit: 23})).text).toBe(
        'Mähen nicht gestartet: Akku niedrig (22,1 V, mindestens 23,0 V nötig)',
      );
      expect(describeEvent(os('STATE', {state: 'PAUSED', reason: 'OUTSIDE'})).text).toBe('Pausiert: außerhalb des befahrbaren Bereichs');
      expect(describeEvent(os('STATE', {state: 'PAUSED', reason: 'POSITION_ACCURACY', accuracy: 0.124, limit: 0.1})).text).toBe(
        'Pausiert: Position auf 0,12 m genau, nötig sind 0,10 m oder besser',
      );
      expect(describeEvent(os('DRIVE_REFUSED', {reason: 'NO_HEADING'})).text).toBe('Fahrt nicht gestartet: Fahrtrichtung noch unbekannt');
      expect(describeEvent(os('MOWING_REFUSED', {reason: 'NO_SAFETY_MEASUREMENT'})).text).toBe(
        'Mähen nicht gestartet: Sicherheit auf dieser Plattform noch nicht nachgemessen, Mähen und Fahren sind gesperrt',
      );
      expect(describeEvent(os('MOWING_REFUSED', {reason: 'SOMETHING_NEW'})).text).toBe('Mähen nicht gestartet: english text');
      expect(describeEvent(os('MOWING_REFUSED', {reason: 'HOLD', until: 1793754213})).text).toBe(
        `Mähen nicht gestartet: Update läuft bis ${clock(1793754213)}`,
      );
    } finally {
      setLangChoice('en');
      vi.unstubAllGlobals();
    }
  });
});

describe('MowBite OS started again without its own stop', () => {
  const restart = (reason: string, hold: boolean, extra: Partial<MowerEvent> = {}) =>
    ev(1, 'UNEXPECTED_RESTART', {reason, hold, state_before: hold ? 'MOWING' : 'IDLE', message: 'english text', ...extra});

  it('says the cause and whether it holds', () => {
    expect(describeEvent(restart('POWER_LOSS', true))).toEqual({text: 'Held after an unexpected restart: interrupted while working', severity: 'error'});
    expect(describeEvent(restart('POWER_LOSS', false))).toEqual({text: 'Restarted unexpectedly: power cut or reset', severity: 'warning'});
    expect(describeEvent(restart('OS_CRASH', false, {severity: 'warning'}), undefined, true).text).toBe('Restarted unexpectedly: MowBite OS crashed');
    expect(describeEvent(restart('KERNEL_CRASH', true)).text).toBe('Held after an unexpected restart: the kernel crashed');
    expect(emergencyText(emergencyFlags(2 ** 21 + 1))).toBe('unexpected restart');
  });

  it('says what to do, a cut while working held on purpose', () => {
    expect(explain(restart('POWER_LOSS', true))).toMatch(/That's on purpose, not a fault\. Look at the mower and around it, then reset the emergency stop\.$/);
    expect(explain(restart('POWER_LOSS', false))).toMatch(/It was idle, so nothing is held and it goes on by itself\.$/);
    expect(explain(restart('OS_CRASH', true))).toMatch(/It was working, so it doesn't drive or mow until it's reset\./);
    expect(explain(restart('KERNEL_CRASH', true, {detail: 'Kernel panic - not syncing: RCU Stall'}))).toMatch(
      /The kernel said: "Kernel panic - not syncing: RCU Stall"\. It doesn't drive or mow until it's reset, whatever it did before\./,
    );
    // a hold from an earlier restart stays after a cut in idle
    expect(explain(restart('POWER_LOSS', true, {state_before: 'IDLE'}))).toMatch(/It still waits for the reset after an earlier restart\./);
  });

  it('in german', () => {
    vi.stubGlobal('document', {documentElement: {lang: 'en'}});
    setLangChoice('de');
    try {
      expect(describeEvent(restart('POWER_LOSS', true)).text).toBe('Gesperrt nach unerwartetem Neustart: Unterbrechung während der Arbeit');
      expect(explain(restart('POWER_LOSS', true))).toMatch(/Das ist Absicht, kein Fehler\./);
    } finally {
      setLangChoice('en');
      vi.unstubAllGlobals();
    }
  });
});
