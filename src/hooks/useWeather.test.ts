import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {watchWeather, type Weather} from './useWeather';

const EVERY = 20 * 60 * 1000;
const answer = {
  current: {temperature_2m: 18, weather_code: 1, is_day: 1, precipitation: 0},
  hourly: {time: [], precipitation: [], precipitation_probability: []},
  daily: {temperature_2m_max: [21], temperature_2m_min: [9]},
};

describe('the weather', () => {
  let online = true;
  let asked = 0;
  // how long an answer takes (ms)
  let slow = 0;
  const page = new EventTarget();
  const doc = Object.assign(new EventTarget(), {visibilityState: 'visible'});
  beforeEach(() => {
    vi.useFakeTimers();
    asked = 0;
    slow = 0;
    vi.stubGlobal('window', page);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('fetch', async () => {
      asked++;
      if (slow) await new Promise((r) => setTimeout(r, slow));
      if (!online) throw new Error('offline');
      return {ok: true, json: async () => answer};
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is asked again a minute after it failed, not only with the next 20 minutes', async () => {
    online = false;
    const seen: (Weather | null)[] = [];
    const stop = watchWeather(52.1, 9.1, (w) => seen.push(w));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([null]);
    online = true;
    await vi.advanceTimersByTimeAsync(60000);
    expect(asked).toBe(2);
    expect(seen.at(-1)?.temp).toBe(18);
    // the answer is kept for 20 minutes, a minute later it isn't asked again
    await vi.advanceTimersByTimeAsync(60000);
    expect(asked).toBe(2);
    stop();
  });

  it('is asked right away once the phone is online again or the page comes back, while there is none', async () => {
    online = false;
    const seen: (Weather | null)[] = [];
    const stop = watchWeather(52.2, 9.2, (w) => seen.push(w));
    await vi.advanceTimersByTimeAsync(0);
    online = true;
    page.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toBe(2);
    expect(seen.at(-1)?.temp).toBe(18);
    // with a fresh answer coming back doesn't ask
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toBe(2);
    stop();
    // ended: nothing asked any more
    page.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(EVERY);
    expect(asked).toBe(2);
  });

  it('is asked once for the watchers of a page, also when it is asked again after a failure', async () => {
    online = false;
    const seen: (Weather | null)[][] = [[], []];
    const stops = seen.map((s) => watchWeather(52.3, 9.3, (w) => s.push(w)));
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toBe(1);
    expect(seen).toEqual([[null], [null]]);
    online = true;
    await vi.advanceTimersByTimeAsync(60000);
    expect(asked).toBe(2);
    expect(seen.map((s) => s.at(-1)?.temp)).toEqual([18, 18]);
    stops.forEach((stop) => stop());
  });

  it('is asked again with every round, the answer of the round before is not taken for a fresh one', async () => {
    slow = 300;
    const stop = watchWeather(52.4, 9.4, () => {});
    await vi.advanceTimersByTimeAsync(slow);
    expect(asked).toBe(1);
    await vi.advanceTimersByTimeAsync(EVERY);
    expect(asked).toBe(2);
    await vi.advanceTimersByTimeAsync(EVERY);
    expect(asked).toBe(3);
    stop();
  });
});
