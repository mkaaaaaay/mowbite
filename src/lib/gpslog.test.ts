import {describe, expect, it} from 'vitest';
import {gpsBefore, readGpsLog} from './gpslog';

const log = (rows: [number, number | null][]) =>
  readGpsLog(rows.map(([t, acc]) => `${t} MOWING 1.000 2.000 ${acc === null ? '999.000' : acc}`).join('\n'));

describe('gps log', () => {
  it('reads the lines and skips broken ones', () => {
    const s = readGpsLog('100.5 MOWING 1.250 -2.500 0.018\nnonsense\n101.5 DOCKING 1.3 -2.5 999.000\n');
    expect(s).toEqual([
      {t: 100.5, state: 'MOWING', x: 1.25, y: -2.5, acc: 0.018},
      {t: 101.5, state: 'DOCKING', x: 1.3, y: -2.5, acc: null},
    ]);
  });

  it('a fix the whole time', () => {
    const s = log(Array.from({length: 61}, (_, i) => [1000 + i, 0.02] as [number, number]));
    const b = gpsBefore(s, 1060)!;
    expect(b.at).toEqual({acc: 0.02, quality: 'fix'});
    expect(b.worst).toBe(0.02);
    expect(b.noFix).toBe(0);
    expect(b.covered).toBe(60);
  });

  it('counts the seconds without a fix and without gps', () => {
    const rows: [number, number | null][] = [];
    for (let i = 0; i <= 60; i++) rows.push([1000 + i, i >= 40 && i < 50 ? 0.3 : i >= 50 && i < 55 ? null : 0.02]);
    const b = gpsBefore(log(rows), 1060)!;
    expect(b.noFix).toBe(15);
    expect(b.none).toBe(5);
    expect(b.worst).toBeNull();
    expect(b.at?.quality).toBe('fix');
  });

  it('gaps count at most 2 s, nothing near the moment is no answer for it', () => {
    const b = gpsBefore(log([[1000, 0.5], [1050, 0.02]]), 1060)!;
    expect(b.covered).toBe(4);
    expect(b.noFix).toBe(2);
    expect(b.at).toBeUndefined();
    expect(gpsBefore(log([[1000, 0.02]]), 2000)).toBeNull();
  });

  it('leaves out the dock approach without gps', () => {
    const s = readGpsLog(
      Array.from({length: 61}, (_, i) => `${1000 + i} DOCKING 1 2 ${i < 40 ? '0.020' : '999.000'}`).join('\n'),
    );
    const b = gpsBefore(s, 1060)!;
    expect(b.dockOff).toBe(true);
    expect(b.at).toBeUndefined();
    expect(b.noFix).toBe(0);
    expect(b.worst).toBe(0.02);
  });

  it('counts an accuracy repeated while mowing as no gps: OpenMower took no position any more', () => {
    // a good fix up to 1052, then the last accuracy repeated while it drives on, 999 from 1062. a bump at 1060
    const rows = Array.from({length: 63}, (_, i) => {
      const t = 1000 + i;
      const acc = t < 1052 ? (0.015 + (i % 3) * 0.002).toFixed(3) : t < 1062 ? '0.019' : '999.000';
      return `${t} MOWING ${(i * 0.3).toFixed(2)} 2 ${acc}`;
    });
    const b = gpsBefore(readGpsLog(rows.join('\n')), 1060)!;
    expect(b.dockOff).toBe(false);
    expect(b.at?.quality).toBe('none');
    // the first of the repeated ones may still be a position taken
    expect(b.none).toBe(7);
    expect(b.noFix).toBe(b.none);
    expect(b.worst).toBeNull();
  });

  it('marks an accuracy that stays the same while the mower drives on', () => {
    const s = readGpsLog([0, 1, 2, 3, 4, 5].map((i) => `${i} DOCKING ${i * 0.1} 0 ${i < 5 ? '0.050' : '0.040'} -40 0.1 0`).join('\n'));
    expect(s.map((x) => !!x.stale)).toEqual([false, true, true, true, true, false]);
    expect(s[0].vCharge).toBe(0.1);
    // standing still it's just the same, and a good fix while mowing may stay at 2 cm
    expect(readGpsLog([0, 1, 2, 3, 4].map((i) => `${i} IDLE 0 0 0.050`).join('\n')).some((x) => x.stale)).toBe(false);
    expect(readGpsLog([0, 1, 2, 3, 4, 5].map((i) => `${i} MOWING ${i * 0.1} 0 0.020`).join('\n')).some((x) => x.stale)).toBe(false);
  });
});
