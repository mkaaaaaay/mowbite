import {describe, expect, it} from 'vitest';
import {gpsGrade, readCoverage, wifiGrade} from './coverage';

describe('coverage', () => {
  it('reads the squares of gpslog.cgi', () => {
    const c = readCoverage('-2 0 1 0 0 0.02 0 0 0\n-1 -1 4 1 1 0 2 -160 -81\nbroken\n0 0 0 0 0 0 0 0 0\n');
    expect(c).toEqual([
      {x: -1, y: 0, seconds: 1, noFix: 0, none: 0, worst: 0.02, wifi: null, wifiWorst: null},
      {x: -0.5, y: -0.5, seconds: 4, noFix: 1, none: 1, worst: 0, wifi: -80, wifiWorst: -81},
    ]);
  });

  it('grades gps by the time without a fix and wifi by its level', () => {
    const cell = (noFix: number, wifi: number | null) => ({x: 0, y: 0, seconds: 100, noFix, none: 0, worst: 0, wifi, wifiWorst: wifi});
    expect(gpsGrade(cell(5, null))).toBe('good');
    expect(gpsGrade(cell(20, null))).toBe('ok');
    expect(gpsGrade(cell(40, null))).toBe('bad');
    expect(wifiGrade(cell(0, -60))).toBe('good');
    expect(wifiGrade(cell(0, -72))).toBe('ok');
    expect(wifiGrade(cell(0, -81))).toBe('bad');
    expect(wifiGrade(cell(0, null))).toBeNull();
  });
});
