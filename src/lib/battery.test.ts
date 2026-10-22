import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {chargeSamples, fullCharges, parseBattery, parseLevel} from './battery';

describe('battery', () => {
  const cycles = parseBattery(
    'charge 100 6000 98.3 24.10 28.00\nrun 6000 7100 30.0 28.00 26.50\nrun 7100 7200 2 26.5 26.4\ncharge 7200 7500 5 26.4 28\nbad line\n' +
      'charge 80000 83200 52.8 27.51 29.08\ncharge 90000 91900 31.2 27.78 29.09\n',
  );
  it('reads what battery.sh writes', () => {
    expect(cycles).toHaveLength(6);
    expect(cycles[0]).toEqual({kind: 'charge', start: 100, end: 6000, minutes: 98.3, from: 24.1, to: 28});
  });
  it('leaves out top ups', () => {
    expect(chargeSamples(cycles)).toEqual([{t: 6000e3, v: 98.3}]);
    expect(fullCharges(cycles).map((c) => c.from)).toEqual([24.1]);
  });
});

// docker/battery.awk with the awk of this machine, the container's busybox one reads it the same
describe('what the container writes', () => {
  const run = (input: string) => {
    const out = join(mkdtempSync(join(tmpdir(), 'battery-')), 'battery.log');
    spawnSync('awk', ['-f', 'docker/battery.awk'], {input, env: {...process.env, LC_ALL: 'C', OUT: out, STATE: ''}});
    return readFileSync(out, 'utf8');
  };
  const line = (t: number, id: string, v: string | number) => `${t} sensors/${id}/data ${v}\n`;
  // charged, then 20 min with the blade at the given rpm, then charging again
  const mow = (rpm: number) => {
    let input = line(0, 'om_v_battery', 28) + line(1, 'om_charge_current', 1) + line(100, 'om_charge_state', 'Done');
    for (let t = 200; t <= 1400; t += 10) input += line(t, 'om_mow_motor_rpm', rpm);
    return input + line(1500, 'om_v_battery', 25) + line(1501, 'om_charge_current', 1);
  };

  it('counts the blade time either way round', () => {
    expect(run(mow(2400))).toContain('run 100 1501 20.0 28.00 25.00');
    // randomize_mow_motor_direction: half the starts turn the other way
    expect(run(mow(-2400))).toContain('run 100 1501 20.0 28.00 25.00');
  });
});

// what the battery's capacity is read from: HEALTH, STATE across a restart and the traces of the charges
describe('battery health', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'battery-'));
  const awk = (d: string, input: string, env: Record<string, string> = {}) =>
    spawnSync('awk', ['-f', 'docker/battery.awk'], {
      input,
      env: {...process.env, LC_ALL: 'C', OUT: join(d, 'battery.log'), STATE: join(d, 'state'), HEALTH: join(d, 'health'), TRACES: d, ...env},
    });
  const health = (d: string) => readFileSync(join(d, 'health'), 'utf8').trim().split('\n');
  const field = (l: string, k: string) => l.split(' ').find((f) => f.startsWith(`${k}=`))?.slice(k.length + 1);
  const line = (t: number, id: string, v: string | number) => `${t} sensors/${id}/data ${v}\n`;
  const second = (t: number, a: number, v: number, vc: number, state: string) =>
    line(t, 'om_charge_current', a) + line(t, 'om_charge_state', state) + line(t + 0.1, 'om_v_battery', v) + line(t + 0.2, 'om_v_charge', vc);
  // 20 h at Done, then the charger tops up by itself: 7 min at 0.888 A, then the current falls to 0.25 A at 29.09 V
  const topUp = (from = 1000) => {
    let input = '';
    for (let t = from; t < from + 72000; t += 10) input += second(t, 0, 27.6 - (t - from + 1000) / 1e6, 31.9, 'Done');
    let ah = 0;
    let t = from + 72000;
    for (let s = 0; ; s++, t++) {
      const a = s < 420 ? 0.888 : 0.888 * Math.exp(-(s - 420) / 2000);
      if (a < 0.25) break;
      input += second(t, a, s < 420 ? 28.68 + s / 1000 : 29.09, 29.5, s < 420 ? 'Fast Charge (CC)' : 'Taper Charge (CV)');
      ah += a / 3600;
    }
    return {input: input + second(t, 0.2, 29.09, 29.5, 'Done'), ah, end: t};
  };
  // from 25 V at 0.888 A for 3 h, the dock's voltage too low from 1:30 to 1:40
  const deep = (from = 0, to = 3 * 3600 + 1) => {
    let input = '';
    if (!from) for (let t = 0; t < 120; t += 2) input += second(t, 0, 25, 31.9, 'Not Charging');
    for (let s = from; s < to; s++) {
      const t = 1000 + s;
      const v = s < 3 * 3600 ? 25.8 + s * 0.0003 : 29.09;
      input += second(t, s < 3 * 3600 ? 0.888 : 0.2, v, s >= 5400 && s < 6000 ? v - 1 : 31, s < 3 * 3600 ? 'Fast Charge (CC)' : 'Done');
    }
    return input;
  };

  it('counts the charge of a top up in the dock', () => {
    const d = dir();
    const {input, ah, end} = topUp();
    writeFileSync(join(d, 'cpu'), '64312\n');
    awk(d, input, {CPUT: join(d, 'cpu')});
    const [l] = health(d);
    expect(l.startsWith(`chg 73000 ${end} end=done prev=done rst=0 idle=20.00 off=0 blade=-1 `)).toBe(true);
    expect(field(l, 'cpu')).toBe('64.3');
    expect(Number(field(l, 'ah'))).toBeCloseTo(ah, 3);
    expect(field(l, 'icc')).toBe('0.888');
    expect(field(l, 'vcv')).toBe('29.090');
    expect(field(l, 'ccmin')).toBe('7.0');
    expect(field(l, 'q')).toBe('-');
    expect(field(l, 'sag')).toBe('0');
    // the cycles stay as they were
    expect(readFileSync(join(d, 'battery.log'), 'utf8')).toContain(`charge 73000 ${end} `);
  });

  it('counts the time from the last Done for each top up in a row', () => {
    const d = dir();
    const first = topUp();
    const second = topUp(first.end + 10);
    // one reading the charger couldn't take while at Done
    const at = first.end + 36000;
    const input = second.input.replace(`${at} sensors/om_charge_state/data Done\n`, `${at} sensors/om_charge_state/data Comms Error\n`);
    expect(input).not.toBe(second.input);
    awk(d, first.input + input);
    const [, l] = health(d);
    expect(l).toMatch(new RegExp(`^chg ${first.end + 72010} ${second.end} end=done prev=done rst=0 idle=20.00 off=0 `));
  });

  it('leaves out the dock once the mower drove off', () => {
    const d = dir();
    let input = deep(0, 1200);
    for (let t = 2200; t < 2400; t++) input += second(t, 0, 27, 0.1, 'Not Charging');
    awk(d, input);
    const [l] = health(d);
    expect(l).toMatch(/^chg 1000 2200 end=lost /);
    expect(field(l, 'sag')).toBe('0');
    expect(Number(field(l, 'sagmin'))).toBeGreaterThan(0.3);
  });

  it('starts the quarters again 10 minutes after a gap, from where it is then', () => {
    const d = dir();
    awk(d, deep(0, 4000) + deep(5000));
    const q = field(health(d)[0], 'q')!.split(',');
    // 27.00 and 27.25 passed in the gap, 600 s after it (27.48 V) it starts again
    const k = q.findIndex((m) => m.startsWith('27.48'));
    expect(q[k - 1]).toMatch(/^26\.75:/);
    expect(q[k]).toMatch(/^27\.48\d:\d\.\d{4}x$/);
    expect(q[k + 1]).toMatch(/^27\.50:/);
  });

  it('notes the charge at each quarter volt and marks where the dock sagged', () => {
    const d = dir();
    awk(d, deep());
    const [l] = health(d);
    expect(l).toMatch(/^chg 1000 11800 end=done prev=notcharging rst=0 idle=-1 off=-1 /);
    const q = field(l, 'q')!.split(',');
    // from 10 minutes on (25.98 V) to 29 V
    expect(q[0]).toMatch(/^25\.98\d:0\.14\d\d$/);
    expect(q.slice(1).map((m) => m.split(':')[0])).toEqual(Array.from({length: 13}, (_, k) => (26 + k / 4).toFixed(2)));
    // 0.888 A for the 833 s a quarter volt takes
    const ah = q.map((m) => parseFloat(m.split(':')[1]));
    expect(ah[2] - ah[1]).toBeCloseTo(0.2056, 3);
    // the sag from 27.42 to 27.6 V, its quarters marked
    expect(q.filter((m) => m.endsWith('x')).map((m) => m.split(':')[0])).toEqual(['27.50', '27.75']);
    expect(Number(field(l, 'sag'))).toBeGreaterThan(500);
    expect(Number(field(l, 'sagmin'))).toBeLessThan(0);
  });

  it('carries a charge over a restart and says what went missing', () => {
    const d = dir();
    awk(d, deep(0, 4000));
    awk(d, deep(4120));
    const [l] = health(d);
    expect(field(l, 'rst')).toBe('1');
    // the minute before the restart wasn't saved yet: the gap counts from the last save
    expect(Number(field(l, 'gsum'))).toBeGreaterThanOrEqual(120);
    expect(Number(field(l, 'ah'))).toBeLessThan(0.888 * 3 - 0.888 * 120 / 3600 + 0.001);
    expect(Number(field(l, 'ah'))).toBeGreaterThan(0.888 * 3 - 0.888 * 200 / 3600);
    // 27.00 V came in the gap: no quarter that wasn't seen
    expect(field(l, 'q')).not.toContain('27.00:');
  });

  it('carries a charge over from a state kept before there was any of this', () => {
    const d = dir();
    writeFileSync(join(d, 'state'), '0 0.00 0.0 1 1000 25.80\n');
    awk(d, deep(4120));
    const [l] = health(d);
    expect(l).toMatch(/^chg 1000 11800 end=done prev=unknown rst=1 idle=-1 off=-1 blade=-1 v0=- j1=- j30=- tm=- cpu=- /);
    expect(Number(field(l, 'gsum'))).toBeGreaterThanOrEqual(4120);
  });

  it('says so when it came up during a charge', () => {
    const d = dir();
    awk(d, deep(120));
    const [l] = health(d);
    expect(l).toMatch(/ rst=1 .* v0=- j1=- j30=- /);
  });

  it('ends the trace of a charger that hangs after 12 hours', () => {
    const d = dir();
    let input = deep(0, 600);
    for (let t = 1600; t < 1600 + 13 * 3600; t += 5) input += second(t, 0.888, 26, 31, 'Charger Not Found');
    awk(d, input);
    const state = readFileSync(join(d, 'state'), 'utf8');
    expect(state).not.toContain(' tr=');
    // what it sent again isn't counted
    expect(Number(/ c\.ah=([\d.]+)/.exec(state)![1])).toBeLessThan(0.888 * 600 / 3600 + 0.01);
    const lines = readFileSync(join(d, '1000.tsv'), 'utf8').trim().split('\n');
    expect(lines.at(-1)!.split(' ')[0]).toBe('44200.1');
  });

  // a night without power at the dock
  const dark = (from: number, to: number) => {
    let input = from ? '' : line(0, 'om_charge_state', 'Done');
    for (let t = from; t <= to; t += 5) {
      input += `${t} robot_state/json {"current_state":"IDLE","is_charging":0}\n` + line(t, 'om_charge_current', 0);
      input += line(t + 0.1, 'om_v_battery', 27.2 - t / 10000) + line(t + 0.2, 'om_v_charge', 0.2);
    }
    return input;
  };
  const back = line(4 * 3600 + 5, 'om_v_charge', 31.9) + line(4 * 3600 + 5.1, 'om_v_battery', 25.7);

  it('times the half volts while the dock has no power', () => {
    const d = dir();
    awk(d, dark(0, 4 * 3600) + back);
    expect(health(d)).toEqual(['dis 5 14400 why=power d=27.200:0,27.0:1995,26.5:6995,26.0:11995']);
  });

  it('goes on timing them over a restart', () => {
    const d = dir();
    awk(d, dark(0, 7200));
    // started again with the battery's voltage first, what came before it still unknown
    awk(d, line(7240.1, 'om_v_battery', 26.476) + dark(7245, 4 * 3600) + back);
    expect(health(d)).toEqual(['dis 5 14400 why=power d=27.200:0,27.0:1995,26.5:6995,26.0:11995']);
    // the end was saved, a restart now doesn't write it again
    awk(d, dark(14410, 14420));
    expect(health(d)).toHaveLength(1);
  });

  it('keeps a trace of each charge from a minute before to half an hour after', () => {
    const d = dir();
    awk(d, topUp().input + second(80000, 0, 28.3, 31.9, 'Done'));
    const lines = readFileSync(join(d, '73000.tsv'), 'utf8').trim().split('\n');
    // the last 60 readings before it
    expect(lines[0]).toBe('72400.1 0.000 27.528 31.900 done');
    // the first reading more than half an hour after Done is the last (the dock's voltage is the one before it)
    expect(lines.at(-1)).toBe('80000.1 0.000 28.300 29.500 done');
    // its end was saved, after a restart it isn't written to again
    awk(d, second(80010, 0, 28.3, 31.9, 'Done'));
    expect(readFileSync(join(d, '73000.tsv'), 'utf8').trim().split('\n')).toEqual(lines);
  });
});

// how full the battery is (LEVEL), against the drive on 15.10. OpenMower's percentage fell from 100 to about 88 there
describe('battery level', () => {
  const infos = `0 sensor_infos/json [{"sensor_id":"om_v_charge","has_min_max":1,"min_value":0,"max_value":32},{"sensor_id":"om_v_battery","sensor_name":"V Battery","has_min_max":1,"min_value":24.5,"max_value":28.2}]\n`;
  const line = (t: number, id: string, v: string | number) => `${t} sensors/${id}/data ${v}\n`;
  // a second in the order the mower sends it: charger, battery, dock, then blade and robot state (quiet: those left out,
  // they stay as they were)
  type At = {a?: number; vc?: number; st?: string; rpm?: number; ma?: number; robot?: string; quiet?: boolean};
  const at = (t: number, v: number, o: At = {}) =>
    line(t, 'om_charge_current', o.a ?? 0) +
    line(t, 'om_charge_state', o.st ?? 'Not Charging') +
    line(t + 0.1, 'om_v_battery', v) +
    line(t + 0.2, 'om_v_charge', o.vc ?? 0.4) +
    (o.quiet
      ? ''
      : line(t + 0.3, 'om_mow_motor_rpm', o.rpm ?? 0) +
        line(t + 0.3, 'om_mow_motor_current', o.ma ?? 0) +
        `${t + 0.6} robot_state/json {"current_state":"${o.robot ?? 'IDLE'}","battery_percentage":0.5}\n`);
  const span = (from: number, to: number, v: (s: number) => number, o: At = {}, step = 1) => {
    let input = '';
    for (let t = from; t < to; t += step) input += at(t, v(t - from), o);
    return input;
  };
  const docked = {vc: 31.9, st: 'Done'};
  const mowing = {robot: 'MOWING', rpm: 2800, ma: 0.4};
  const cc = {a: 0.88, vc: 29.5, st: 'Fast Charge (CC)'};
  const limits = (empty: number, full: number) =>
    `0 sensor_infos/json [{"sensor_id":"om_v_battery","has_min_max":true,"min_value":${empty},"max_value":${full}}]\n`;
  const board = (b: string) => `0 params/json {"/ll/bind_ip":"0.0.0.0","/ll/board":"${b}","/ll/services/power/battery_full_voltage":28.2}\n`;
  const level = (input: string, d = mkdtempSync(join(tmpdir(), 'battery-')), state = '') => {
    spawnSync('awk', ['-f', 'docker/battery.awk'], {
      input,
      env: {...process.env, LC_ALL: 'C', OUT: join(d, 'battery.log'), STATE: state, LEVEL: join(d, 'level')},
    });
    try {
      const [t, pct, how] = readFileSync(join(d, 'level'), 'utf8').trim().split(' ');
      return {t: +t, pct: +pct, how};
    } catch {
      return null;
    }
  };

  it('needs OpenMower\'s empty and full voltage', () => {
    expect(level(span(0, 60, () => 27))).toBeNull();
  });

  it('is full a while after Done and goes down in the dock until the charger tops it up again', () => {
    expect(level(infos + span(1, 300, () => 28.06, docked))).toMatchObject({pct: 100, how: 'full'});
    // 20 h on, 27.51 V: what the top up gives back (0.56 Ah of the 2.6 Ah down to going home)
    const low = level(infos + span(1, 300, () => 27.51, docked))!;
    expect(low.pct).toBeGreaterThanOrEqual(77);
    expect(low.pct).toBeLessThanOrEqual(81);
  });

  it("doesn't jump when the mower drives off and the blade starts", () => {
    let input = infos + span(1, 300, () => 28.06, docked);
    input += span(300, 330, () => 27.88, {robot: 'UNDOCKING'});
    input += span(330, 450, () => 27.6, mowing);
    const out = level(input)!;
    expect(out.how).toBe('out');
    expect(out.pct).toBeGreaterThanOrEqual(99);
    // OpenMower's own from the same voltage
    expect(Math.round(((27.6 + 0.24 - 24.5) / 3.7) * 100)).toBe(90);
  });

  it("doesn't go up while not charging", () => {
    const d = mkdtempSync(join(tmpdir(), 'battery-'));
    const mown = infos + span(1, 600, () => 26.6, mowing);
    const before = level(mown, d)!.pct;
    // the blade stops on the way home, the voltage comes back by more than the blade took
    expect(level(mown + span(600, 900, () => 27.0, {robot: 'DOCKING'}), d)!.pct).toBe(before);
    expect(before).toBeGreaterThan(60);
    expect(before).toBeLessThan(70);
  });

  it('goes up while charging and is full at Done', () => {
    let input = infos + span(1, 120, () => 26.2, {vc: 31.9, st: 'Not Charging'});
    const start = level(input)!.pct;
    let last = start;
    // constant current from 27.4 to 29.08 V in 3 h, then the current falls to 0.25 A at constant voltage
    for (let s = 0; s < 3 * 3600; s += 1800) {
      input += span(120 + s, 120 + s + 1800, (k) => 27.4 + ((s + k) / (3 * 3600)) * 1.68, {a: 0.88, vc: 29.5, st: 'Fast Charge (CC)'}, 5);
      const now = level(input)!;
      expect(now.how).toBe('charging');
      expect(now.pct).toBeGreaterThanOrEqual(last);
      last = now.pct;
    }
    expect(last).toBeGreaterThan(78);
    expect(last).toBeLessThan(84);
    let t = 120 + 3 * 3600;
    for (let s = 0; 0.88 * Math.exp(-s / 2000) > 0.25; s += 5, t += 5) input += at(t, 29.08, {a: 0.88 * Math.exp(-s / 2000), vc: 29.5, st: 'Taper Charge (CV)'});
    const cv = level(input)!.pct;
    expect(cv).toBeGreaterThan(95);
    expect(level(input + span(t, t + 60, () => 28.27, docked))).toMatchObject({pct: 100, how: 'full'});
    expect(start).toBeLessThan(55);
  });

  it('is 0 where OpenMower sends the mower home', () => {
    // its 24.5 V empty on the battery's own reading, 0.24 V above the charger's
    expect(level(infos + span(1, 900, () => 24.26, mowing))!.pct).toBe(0);
    expect(level(infos + span(1, 900, () => 24.6, mowing))!.pct).toBeGreaterThan(3);
  });

  it('keeps it across a restart, after 10 minutes without it it starts from the voltage again', () => {
    const d = mkdtempSync(join(tmpdir(), 'battery-'));
    const state = join(d, 'state');
    const first = level(infos + span(1, 600, () => 26.6, mowing), d, state)!.pct;
    // back 5 minutes later, standing: the voltage came back, the level stays
    expect(level(infos + span(900, 1000, () => 27.4, {robot: 'IDLE'}), d, state)!.pct).toBe(first);
    // 20 minutes later it's read from the voltage
    expect(level(infos + span(2200, 2300, () => 27.4, {robot: 'IDLE'}), d, state)!.pct).toBeGreaterThan(first + 5);
  });

  it('comes up in the middle of a charge from the charge, not from the voltage the charger lifts', () => {
    // 27.65 V at 0.88 A is about 38 %, without the charger that voltage would be 84 %
    const now = level(infos + span(1, 300, () => 27.65, cc))!;
    expect(now.how).toBe('charging');
    expect(now.pct).toBeGreaterThan(33);
    expect(now.pct).toBeLessThan(43);
  });

  it('keeps what it showed when it comes back during the same charge', () => {
    const d = mkdtempSync(join(tmpdir(), 'battery-'));
    const state = join(d, 'state');
    const first = level(infos + span(1, 600, () => 26.9, mowing) + span(600, 1200, () => 28.3, cc), d, state)!;
    expect(first.how).toBe('charging');
    // 20 minutes later, the voltage at constant current reads less than what was shown
    expect(level(infos + span(2400, 2500, () => 28.5, cc), d, state)!.pct).toBeGreaterThanOrEqual(first.pct);
  });

  it("doesn't drop when the mower leaves after a short charge, nor jump when it docks again", () => {
    let input = infos + span(1, 900, () => 26.9, mowing) + span(900, 960, () => 27.2, {robot: 'DOCKING'});
    const home = level(input)!.pct;
    // 3 minutes at constant current, then off again: the voltage comes back higher than it was
    input += span(960, 1140, () => 28.3, cc);
    input += span(1140, 1300, () => 27.3, {robot: 'UNDOCKING'});
    const off = level(input)!.pct;
    expect(off).toBeGreaterThanOrEqual(home - 1);
    input += span(1300, 1360, () => 28.3, cc);
    expect(level(input)!.pct).toBeLessThanOrEqual(off + 1);
  });

  it('takes the blade by the current it draws', () => {
    const light = level(infos + span(1, 600, () => 26.6, mowing))!.pct;
    // thick grass: three times the current, 0.52 V lower
    const heavy = level(infos + span(1, 600, () => 26.08, {...mowing, ma: 1.2}))!.pct;
    expect(Math.abs(heavy - light)).toBeLessThanOrEqual(1);
  });

  it("isn't moved by 0 V while the charger isn't read yet", () => {
    const mown = infos + span(1, 600, () => 26.6, mowing);
    const before = level(mown)!.pct;
    expect(level(mown + span(600, 603, () => 0, mowing) + span(603, 700, () => 26.6, mowing))!.pct).toBe(before);
  });

  it("isn't worked out where it can't be: another board, OpenMower v1, no charge current", () => {
    const full = span(1, 120, () => 28.06, docked);
    expect(level(infos + board('YardForce') + full)).toMatchObject({pct: 100, how: 'full'});
    expect(level(infos + board('YardForce-V4') + full)).toMatchObject({pct: 100, how: 'full'});
    expect(level(infos + board('Worx') + full)).toBeNull();
    expect(level(infos + board('YardForce-V1') + full)).toBeNull();
    // v1's charger says N/A
    expect(level(infos + span(1, 120, () => 28.06, {vc: 31.9, st: 'N/A'}))).toBeNull();
    // ignore_charging_current: OpenMower leaves its sensor out
    expect(level(infos + full.replace(/^.*om_charge_current.*\n/gm, ''))).toBeNull();
  });

  it("counts the cells from the full voltage, nothing where the two voltages don't fit", () => {
    const at7 = (v: number) => (v / 7) * 10;
    expect(level(limits(35, 42) + span(1, 120, () => at7(28.06), docked))).toMatchObject({pct: 100, how: 'full'});
    expect(level(limits(35, 42) + span(1, 600, () => at7(26.6), mowing))!.pct).toBeLessThan(70);
    expect(level(limits(18.5, 20.5) + span(1, 120, () => (28.06 / 7) * 5, docked))).toMatchObject({pct: 100});
    // 24.5 and 25.9 V, 28 and 28.4 V: nothing, and the rest goes on
    for (const [empty, full] of [
      [24.5, 25.9],
      [28, 28.4],
    ]) {
      const d = mkdtempSync(join(tmpdir(), 'battery-'));
      const input = limits(empty, full) + span(1, 60, () => 26, cc) + line(60, 'om_charge_state', 'Done');
      expect(level(input, d)).toBeNull();
      expect(readFileSync(join(d, 'battery.log'), 'utf8')).toMatch(/^charge 2 60 /);
    }
  });

  it('takes a dock below 20 V as the dock', () => {
    expect(level(infos + span(1, 300, () => 27.65, {...cc, vc: 15}))).toMatchObject({how: 'charging'});
    expect(level(infos + span(1, 120, () => 28.06, {...docked, vc: 15}))).toMatchObject({pct: 100, how: 'full'});
  });

  it('goes down at Done as fast as the last time the mower stood there until the charger topped it up', () => {
    const d = mkdtempSync(join(tmpdir(), 'battery-'));
    const state = join(d, 'state');
    const done = (from: number, to: number, v: (s: number) => number) =>
      span(from, from + 60, v, docked) + span(from + 60, to, (s) => v(s + 60), {...docked, quiet: true}, 8);
    // 6 hours at Done, the voltage down from 28.27 to 27.6 V (about 82 %): 3 % an hour. then the charger tops up and is
    // done again, 5 minutes at constant current and 20 at constant voltage
    const h6 = 6 * 3600;
    let input = infos + done(1, h6, (s) => 28.27 - (0.67 * s) / h6);
    input += span(h6, h6 + 300, () => 28.3, cc, 5) + span(h6 + 300, h6 + 1500, () => 29.08, {a: 0.26, vc: 29.5, st: 'Taper Charge (CV)'}, 5);
    expect(level(input + done(h6 + 1500, h6 + 1620, () => 28.27), d, state)).toMatchObject({pct: 100, how: 'full'});
    // 3 hours on at Done the voltage still reads full, it went down by about 9 %
    const later = level(infos + done(h6 + 1620, 9.5 * 3600, () => 28.1), d, state)!;
    expect(later.how).toBe('full');
    expect(later.pct).toBeGreaterThan(87);
    expect(later.pct).toBeLessThan(95);
  });
});

describe('parseLevel', () => {
  it('takes it while fresh', () => {
    expect(parseLevel('1000 990 87 out\n')).toBe(87);
    expect(parseLevel('1000 870 87 out')).toBeNull();
    // battery.awk doesn't know yet, or an older container answering with the cycles
    expect(parseLevel('1000 \n')).toBeNull();
    expect(parseLevel('charge 100 6000 98.3 24.10 28.00\n')).toBeNull();
  });
});
