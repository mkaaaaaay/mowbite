import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {chargeSamples, drainSamples, parseBattery, trend} from './battery';

describe('battery', () => {
  const cycles = parseBattery('charge 100 6000 98.3 24.10 28.00\nrun 6000 7100 30.0 28.00 26.50\nrun 7100 7200 2 26.5 26.4\ncharge 7200 7500 5 26.4 28\nbad line\n');
  it('reads what battery.sh writes', () => {
    expect(cycles).toHaveLength(4);
    expect(cycles[0]).toEqual({kind: 'charge', start: 100, end: 6000, minutes: 98.3, from: 24.1, to: 28});
  });
  it('leaves out top ups and short drives', () => {
    expect(chargeSamples(cycles)).toEqual([{t: 6000e3, v: 98.3}]);
    expect(drainSamples(cycles)).toEqual([{t: 7100e3, v: 3}]);
  });
  it('shows a trend only after some weeks', () => {
    const day = 86400e3;
    const s = Array.from({length: 60}, (_, i) => ({t: i * day, v: 100 - i / 2}));
    expect(trend(s.slice(0, 20), 20 * day)).toBeNull();
    const t = trend(s, 60 * day)!;
    expect(t.first).toBeGreaterThan(t.last);
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
