import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync} from 'node:fs';
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
