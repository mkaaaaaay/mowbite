import {describe, expect, it, vi} from 'vitest';
import {setLangChoice} from './i18n';
import {isNightTime, missedStart, nextStart, parseSchedule, posixTz, scheduleLogLine, serializeSchedule, type Schedule} from './schedule';

// the dates below are local times, so the same zone everywhere (github runs in UTC)
process.env.TZ = 'Europe/Berlin';

const plan = (days: number[], time: string, areas: string[] = []) => ({days, time, areas});
const schedule = (plans: Schedule['plans'], enabled = true): Schedule => ({
  enabled,
  minBattery: 50,
  skipRain: true,
  skipForecast: false,
  forecastHours: 2,
  skipCold: false,
  minTemp: 5,
  plans,
  tz: posixTz(),
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

  it("keeps the cold it doesn't start in", () => {
    const s = {...schedule([plan([1], '09:00')]), skipCold: true, minTemp: 8};
    const text = serializeSchedule(s);
    expect(text).toContain('skipcold 1\nmintemp 8\n');
    expect(parseSchedule(text)).toEqual(s);
    // a temperature not offered is the usual one
    expect(parseSchedule('skipcold 1\nmintemp 7\n').minTemp).toBe(5);
  });

  it('keeps end time and dark, with and without areas', () => {
    const s = schedule([{...plan([1], '09:00'), end: '19:00'}, {...plan([2], '21:00', ['a']), end: '23:30', dark: true}]);
    const text = serializeSchedule(s);
    expect(text).toContain('plan 1 09:00 end=19:00\n');
    expect(text).toContain('plan 2 21:00 a end=23:30 dark=1\n');
    expect(parseSchedule(text)).toEqual(s);
  });

  it('keeps sunset, fresh and a pause', () => {
    const s = {...schedule([{...plan([3], '10:00', ['a']), sunset: true, fresh: true}]), pause: {until: '2026-09-30', areas: ['a', 'b']}};
    const text = serializeSchedule(s);
    expect(text).toContain('plan 3 10:00 a sunset=1 fresh=1\n');
    const turned = schedule([{...plan([1], '09:00'), fresh: true, angle: 90}, {...plan([4], '09:00'), angle: -45}, {...plan([6], '09:00'), angle: 0}]);
    expect(serializeSchedule(turned)).toContain('plan 1 09:00 fresh=1 angle=90\nplan 4 09:00 angle=-45\nplan 6 09:00 angle=0\n');
    expect(parseSchedule(serializeSchedule(turned)).plans.map((p) => p.angle)).toEqual([90, -45, 0]);
    expect(parseSchedule('plan 1 09:00 angle=abc\n').plans[0]).toEqual({days: [1], time: '09:00', areas: ['angle=abc']});
    expect(text).toContain('pause 2026-09-30 a,b\n');
    expect(parseSchedule(text)).toEqual(s);
    expect(parseSchedule('pause 2026-09-30 all').pause).toEqual({until: '2026-09-30', areas: 'all'});
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

  it('plans confirmed night times too', () => {
    expect(nextStart(schedule([plan([1], '19:00')]), monday8)).toEqual(new Date(2026, 8, 28, 19, 0));
  });

  it('is nothing while switched off', () => {
    expect(nextStart(schedule([plan([1], '09:00')], false), monday8)).toBeNull();
  });
});

describe('isNightTime', () => {
  it('blocks 18:00 up to 05:59', () => {
    expect(['18:00', '23:59', '00:00', '05:59'].map((t) => isNightTime(t))).toEqual([true, true, true, true]);
    expect(['06:00', '12:00', '17:59'].map((t) => isNightTime(t))).toEqual([false, false, false]);
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

describe('isNightTime with sun times', () => {
  it('follows sunset and sunrise', () => {
    const sun = {rise: '05:00', set: '21:40'};
    expect(['21:40', '23:00', '04:59'].map((t) => isNightTime(t, sun))).toEqual([true, true, true]);
    expect(['05:00', '18:30', '21:39'].map((t) => isNightTime(t, sun))).toEqual([false, false, false]);
  });
  it('falls back to the fixed hours without them', () => {
    expect(isNightTime('18:30', null)).toBe(true);
  });
});

describe('nextStart and the dark', () => {
  const monday8 = new Date(2026, 8, 28, 8, 0);
  const sun = {rise: '07:00', set: '19:00'};
  it('leaves out a start in the dark the scheduler would skip', () => {
    const s = schedule([plan([1], '20:00'), plan([2], '10:00')]);
    expect(nextStart(s, monday8, sun)).toEqual(new Date(2026, 8, 29, 10, 0));
  });
  it('keeps it when it may mow in the dark', () => {
    const s = schedule([{...plan([1], '20:00'), dark: true}]);
    expect(nextStart(s, monday8, sun)).toEqual(new Date(2026, 8, 28, 20, 0));
  });
});

describe('nextStart and a pause', () => {
  const monday8 = new Date(2026, 8, 28, 8, 0);
  it('skips the paused days', () => {
    const s = {...schedule([plan([1, 2, 3], '10:00')]), pause: {until: '2026-09-29', areas: 'all' as const}};
    expect(nextStart(s, monday8)).toEqual(new Date(2026, 8, 30, 10, 0));
  });
  it('still starts when only some areas are paused', () => {
    const s = {...schedule([plan([1], '10:00')]), pause: {until: '2026-09-29', areas: ['a']}};
    expect(nextStart(s, monday8)).toEqual(new Date(2026, 8, 28, 10, 0));
  });
  it('leaves out a start whose areas are all paused, like the scheduler', () => {
    const s = {...schedule([plan([1, 2], '10:00', ['a'])]), pause: {until: '2026-09-28', areas: ['a']}};
    expect(nextStart(s, monday8, undefined, ['a', 'b'])).toEqual(new Date(2026, 8, 29, 10, 0));
    // without the areas it can't tell
    expect(nextStart(s, monday8)).toEqual(new Date(2026, 8, 28, 10, 0));
  });
  it('leaves out a start that picks only areas not mowed any more', () => {
    expect(nextStart(schedule([plan([1], '10:00', ['gone'])]), monday8, undefined, ['a', 'b'])).toBeNull();
  });
});

describe('the time zone', () => {
  it("keeps the one it was saved in, a phone elsewhere doesn't change it", () => {
    const s = parseSchedule('enabled 1\ntz <+08>-8\nplan 1 10:00\n');
    expect(s.tz).toBe('<+08>-8');
    expect(serializeSchedule(s)).toContain('tz <+08>-8\n');
    expect(serializeSchedule({...s, tz: undefined})).toContain(`tz ${posixTz()}\n`);
  });
});

describe('missedStart', () => {
  const now = 1_790_890_000;
  it('the last try when it was left out', () => {
    const log = [
      {t: now - 600, what: 'skip_forecast'},
      {t: now - 3600, what: 'started', detail: '100'},
    ];
    expect(missedStart(log, now)?.what).toBe('skip_forecast');
  });
  it('nothing when the last one started', () => {
    const log = [
      {t: now - 600, what: 'started'},
      {t: now - 3600, what: 'skip_rain'},
      {t: now - 300, what: 'skipped_area'},
    ];
    expect(missedStart(log, now)).toBeNull();
  });
  it('nothing after 12 hours, for a pause or when it was out already', () => {
    expect(missedStart([{t: now - 13 * 3600, what: 'skip_battery'}], now)).toBeNull();
    expect(missedStart([{t: now - 60, what: 'skip_paused'}], now)).toBeNull();
    expect(missedStart([{t: now - 60, what: 'skip_busy', detail: 'MOWING'}], now)).toBeNull();
  });
  it('a start the mower ignored counts', () => {
    expect(missedStart([{t: now - 60, what: 'start_failed'}], now)?.what).toBe('start_failed');
  });
});

describe('scheduleLogLine', () => {
  it('puts the detail in, a number with its decimals the way the language writes it', () => {
    expect(scheduleLogLine({t: 0, what: 'skip_cold', detail: '4.2'})).toBe('Not started, too cold (4.2 °C)');
    expect(scheduleLogLine({t: 0, what: 'waiting_battery', detail: '45'})).toBe('Waiting for the battery (45 %)');
    // tr() follows the language set, that marks the page with it
    vi.stubGlobal('document', {documentElement: {lang: 'en'}});
    setLangChoice('de');
    try {
      expect(scheduleLogLine({t: 0, what: 'skip_cold', detail: '-0.5'})).toBe('Nicht gestartet, zu kalt (-0,5 °C)');
      expect(scheduleLogLine({t: 0, what: 'waiting_battery', detail: '45'})).toBe('Wartet auf den Akku (45 %)');
    } finally {
      setLangChoice('en');
      vi.unstubAllGlobals();
    }
  });
});

describe('the leftovers in the log', () => {
  it('says why they weren\'t mowed, with the value behind the reason', () => {
    expect(scheduleLogLine({t: 0, what: 'leftovers_skip', detail: 'battery', more: '62'})).toBe('Leftovers not mowed, battery only at 62 % after six hours');
    expect(scheduleLogLine({t: 0, what: 'leftovers_skip', detail: 'cold', more: '3.5'})).toBe('Leftovers not mowed, too cold (3.5 °C)');
    expect(scheduleLogLine({t: 0, what: 'leftovers_skip', detail: 'end'})).toBe("Leftovers not mowed, the run's end time had come");
    expect(scheduleLogLine({t: 0, what: 'leftovers_skip', detail: 'MOWING'})).toBe("Leftovers not mowed, the mower wasn't ready");
    expect(scheduleLogLine({t: 0, what: 'leftovers_waiting_battery', detail: '40'})).toBe('Leftovers: waiting for the battery (40 %)');
  });
});
