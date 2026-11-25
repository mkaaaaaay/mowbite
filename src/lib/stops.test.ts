import {describe, expect, it} from 'vitest';
import {perBladeHour, reasonsOf, stopReasonText, type StopWeek} from './stops';

const week = (reasons: StopWeek['reasons'], blade_h = 2): StopWeek => ({
  week: '2026-W48',
  start: 0,
  stops: reasons.reduce((n, r) => n + r.count, 0),
  unexplained: 0,
  standstills: 0,
  blade_h,
  reasons,
});

describe('the stop book', () => {
  it('names the reason of the event behind a stop, an emergency by its bit', () => {
    expect(stopReasonText('DOCKING/RAIN')).toBe('rain');
    expect(stopReasonText('EMERGENCY/COLLISION')).toBe('emergency stop: bumper');
    expect(stopReasonText('EMERGENCY/BIT_30')).toBe('emergency stop: bit 30');
    expect(stopReasonText('UNKNOWN')).toBe('no event told why');
    expect(stopReasonText('STANDSTILL')).toBe('stood still while busy');
    expect(stopReasonText('MARK')).toBe('marked by you');
    expect(stopReasonText('UNDOCKING_FAILED')).toBe('leaving the dock failed');
  });

  it('adds up the reasons of all weeks, most first', () => {
    const a = week([{reason: 'DOCKING/RAIN', class: 'cause', count: 1}, {reason: 'UNKNOWN', class: 'symptom', count: 1}]);
    const b = week([{reason: 'UNKNOWN', class: 'symptom', count: 2}]);
    expect(reasonsOf([a, b])).toEqual([
      {reason: 'UNKNOWN', class: 'symptom', count: 3},
      {reason: 'DOCKING/RAIN', class: 'cause', count: 1},
    ]);
    expect(a.reasons[1].count).toBe(1);
  });

  it('counts stops per blade hour, none for a week without mowing', () => {
    expect(perBladeHour(week([{reason: 'UNKNOWN', class: 'symptom', count: 3}], 1.5))).toBe(2);
    expect(perBladeHour(week([{reason: 'UNKNOWN', class: 'symptom', count: 1}], 0))).toBeNull();
  });
});
