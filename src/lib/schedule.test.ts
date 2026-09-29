import {describe, expect, it} from 'vitest';
import {nextStart, parseSchedule, posixTz, serializeSchedule, type Schedule} from './schedule';

// the dates below are local times, so the same zone everywhere (github runs in UTC)
process.env.TZ = 'Europe/Berlin';

const plan = (days: number[], time: string, areas: string[] = []) => ({days, time, areas});
const schedule = (plans: Schedule['plans'], enabled = true): Schedule => ({
  enabled,
  minBattery: 50,
  skipRain: true,
  skipForecast: false,
  forecastHours: 2,
  plans,
});

describe('parse / serialize', () => {
  it('reads back what it writes', () => {
    const s = schedule([plan([1, 3, 5], '09:00'), plan([6], '14:30', ['a', 'b'])]);
    expect(parseSchedule(serializeSchedule(s))).toEqual(s);
  });

  it('writes the lines the scheduler script expects', () => {
    const text = serializeSchedule(schedule([plan([5, 1], '09:00', ['x'])]), {lat: 52.2512, lon: 10.5634});
    expect(text).toContain('enabled 1\n');
    expect(text).toContain('forecasthours 2\n');
    expect(text).toContain('pos 52.25 10.56\n');
    expect(text).toContain('plan 1,5 09:00 x\n');
    expect(text).toMatch(/^tz \S+$/m);
  });

  it('keeps the end time, with and without areas', () => {
    const s = schedule([{...plan([1], '09:00'), end: '19:00'}, {...plan([2], '21:00', ['a']), end: '23:30'}]);
    const text = serializeSchedule(s);
    expect(text).toContain('plan 1 09:00 end=19:00\n');
    expect(text).toContain('plan 2 21:00 a end=23:30\n');
    expect(parseSchedule(text)).toEqual(s);
  });

  it('ignores dark=1 from older files instead of taking it for areas', () => {
    expect(parseSchedule('plan 2 21:00 a end=23:30 dark=1').plans).toEqual([{...plan([2], '21:00', ['a']), end: '23:30'}]);
    expect(parseSchedule('plan 2 21:00 dark=1').plans).toEqual([plan([2], '21:00')]);
  });

  it('drops start times without a day', () => {
    expect(serializeSchedule(schedule([plan([], '09:00')]))).not.toContain('plan');
  });

  it('falls back to defaults for missing lines', () => {
    const s = parseSchedule('plan 2 07:15');
    expect(s.enabled).toBe(false);
    expect(s.forecastHours).toBe(1);
    expect(s.plans).toEqual([plan([2], '07:15')]);
  });
});

describe('nextStart', () => {
  // a monday, 08:00 local time
  const monday8 = new Date(2026, 8, 28, 8, 0);

  it('finds a start later the same day', () => {
    expect(nextStart(schedule([plan([1], '09:00')]), monday8)).toEqual(new Date(2026, 8, 28, 9, 0));
  });

  it('skips a time that has already passed to the next week', () => {
    expect(nextStart(schedule([plan([1], '07:00')]), monday8)).toEqual(new Date(2026, 9, 5, 7, 0));
  });

  it('takes the earliest of several plans', () => {
    const s = schedule([plan([3], '10:00'), plan([2], '17:00')]);
    expect(nextStart(s, monday8)).toEqual(new Date(2026, 8, 29, 17, 0));
  });

  it('plans evening and night times like any other', () => {
    expect(nextStart(schedule([plan([1], '19:00')]), monday8)).toEqual(new Date(2026, 8, 28, 19, 0));
  });

  it('is nothing while switched off', () => {
    expect(nextStart(schedule([plan([1], '09:00')], false), monday8)).toBeNull();
  });
});

describe('posixTz', () => {
  it("describes the browser's zone with its daylight saving rule", () => {
    expect(posixTz()).toBe('<+0100>-1<+0200>-2,M3.5.0/2,M10.5.0/3');
  });

  it('leaves the rule out where there is no daylight saving', () => {
    process.env.TZ = 'Asia/Tokyo';
    try {
      expect(posixTz()).toBe('<+0900>-9');
    } finally {
      process.env.TZ = 'Europe/Berlin';
    }
  });
});

