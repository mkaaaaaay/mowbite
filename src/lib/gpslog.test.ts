import {describe, expect, it} from 'vitest';
import {gpsBefore, gpsCsv, readGpsLog} from './gpslog';

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

  it('writes a csv', () => {
    expect(gpsCsv(log([[0, 0.02], [1, null]]))).toBe(
      'time,state,x,y,accuracy_m\n1970-01-01T00:00:00.000Z,MOWING,1.000,2.000,0.020\n1970-01-01T00:00:01.000Z,MOWING,1.000,2.000,\n',
    );
  });
});
