import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {amountsOf, parseStats, partUse, periodStart} from './stats';

describe('stats', () => {
  // a wednesday at noon, local time
  const now = new Date(2026, 9, 14, 12);
  const at = (d: Date) => d.getTime() / 1000;
  const stats = parseStats(
    [
      'since 1700000000',
      'total 36000.0 9000.5 1200.0 12',
      `hour ${at(new Date(2026, 9, 1, 10))} 3600.0 1000.0 50.0 1`,
      `hour ${at(new Date(2026, 9, 12, 9))} 1800.0 500.0 20.0 1`,
      `hour ${at(new Date(2026, 9, 14, 11))} 600.0 100.0 10.0 0`,
      'hour bad line',
      'maint blade 80 7200.0 1790000000',
      'maint clean 10 0 0',
    ].join('\n'),
  );

  it('reads what stats.cgi says', () => {
    expect(stats.since).toBe(1700000000);
    expect(stats.total).toEqual({blade: 36000, mowed: 9000.5, driven: 1200, runs: 12});
    expect(stats.hours).toHaveLength(3);
    expect(stats.parts).toEqual([
      {key: 'blade', dueHours: 80, baseBlade: 7200, doneAt: 1790000000},
      {key: 'clean', dueHours: 10, baseBlade: 0, doneAt: 0},
    ]);
  });

  it('starts the week on monday', () => {
    expect(new Date(periodStart('week', now))).toEqual(new Date(2026, 9, 12));
    expect(new Date(periodStart('month', now))).toEqual(new Date(2026, 9, 1));
    expect(new Date(periodStart('year', now))).toEqual(new Date(2026, 0, 1));
  });

  it('sums the hours of a period', () => {
    expect(amountsOf(stats, 'week', now)).toEqual({blade: 2400, mowed: 600, driven: 30, runs: 1});
    expect(amountsOf(stats, 'month', now).blade).toBe(6000);
    expect(amountsOf(stats, 'total', now)).toBe(stats.total);
  });

  it('counts the blade hours since a part was done', () => {
    expect(partUse(stats, stats.parts[0])).toEqual({seconds: 28800, fraction: 0.1, due: false});
    expect(partUse(stats, stats.parts[1]).due).toBe(true);
  });
});

// docker/stats.awk with the awk of this machine, the container's busybox one reads it the same
describe('what the container counts', () => {
  const run = (input: string, state = '') => {
    const dir = mkdtempSync(join(tmpdir(), 'stats-'));
    const env = {...process.env, LC_ALL: 'C', HOURS: join(dir, 'hours'), STATE: join(dir, 'state')};
    if (state) writeFileSync(env.STATE, state);
    spawnSync('awk', ['-f', 'docker/stats.awk'], {input, env});
    const read = (f: string) => {
      try {
        return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean);
      } catch {
        return [];
      }
    };
    return {hours: read(env.HOURS), state: read(env.STATE)[0]?.split(' ').map(Number)};
  };
  const pose = (t: number, state: string, x: number) =>
    `${t} robot_state/json {"current_state":"${state}","is_charging":0,"pose":{"heading":0,"pos_accuracy":0.02,"x":${x},"y":0}}\n`;
  const rpm = (t: number, v: number) => `${t} sensors/om_mow_motor_rpm/data ${v}\n`;
  // an hour starts at 3600, idle in the dock, then 100 s mowing at 0.5 m/s into the next hour, 10 s home without blade
  const day = () => {
    let input = pose(3500, 'IDLE', 0) + rpm(3500, 0);
    let x = 0;
    for (let t = 3550; t < 3650; t++, x += 0.5) input += pose(t, 'MOWING', x) + rpm(t, -2800);
    for (let t = 3650; t <= 3660; t++, x -= 0.5) input += pose(t, 'DOCKING', x) + rpm(t, 0);
    return input + pose(7300, 'IDLE', x);
  };

  it('counts blade time, distance and runs per hour', () => {
    const {hours, state} = run(day());
    expect(hours).toEqual(['0 49.0 24.5 0.0 1', '3600 51.0 25.5 5.0 0']);
    // since, then the totals, then the hour going on (empty)
    expect(state.slice(0, 5)).toEqual([3500, 100, 50, 5, 1]);
    expect(state.slice(5)).toEqual([7200, 0, 0, 0, 0]);
  });

  it("doesn't count a jump of the position", () => {
    const {state} = run(pose(100, 'IDLE', 0) + pose(101, 'MOWING', 0) + pose(102, 'MOWING', 30) + pose(103, 'MOWING', 30.5));
    expect(state.slice(1, 5)).toEqual([0, 0, 0.5, 1]);
  });

  it('goes on from what it kept before a restart', () => {
    const {hours, state} = run(rpm(4000, 2800) + rpm(4010, 2800) + rpm(7300, 0), '100 600.0 10.0 2.0 3 3600 60.0 1.0 0.0 1\n');
    expect(hours).toEqual(['3600 70.0 1.0 0.0 1']);
    expect(state.slice(0, 5)).toEqual([100, 610, 10, 2, 3]);
  });
});
