import {afterEach, describe, expect, it, vi} from 'vitest';

const rpc = vi.hoisted(() => ({asked: 0}));
vi.mock('./rpc', () => ({
  callRpc: async () => {
    rpc.asked++;
    return [];
  },
}));

const {forgetToday, historyOf} = await import('./history');

afterEach(() => vi.useRealTimers());

describe('a day file in the cache', () => {
  it('is asked for again after its day when it was read while still written, then kept', async () => {
    vi.useFakeTimers();
    // the evening of the 27th (UTC), the file is still written
    vi.setSystemTime(Date.UTC(2026, 9, 27, 20, 0));
    await historyOf('20261027');
    expect(rpc.asked).toBe(1);
    // the next day: the old answer misses the evening
    vi.setSystemTime(Date.UTC(2026, 9, 28, 9, 0));
    await historyOf('20261027');
    expect(rpc.asked).toBe(2);
    // a mower on a clock far west of UTC still wrote it then
    vi.setSystemTime(Date.UTC(2026, 9, 28, 13, 0));
    await historyOf('20261027');
    expect(rpc.asked).toBe(3);
    // asked once the day was over in every zone, that answer stays
    vi.setSystemTime(Date.UTC(2026, 9, 30, 9, 0));
    await historyOf('20261027');
    expect(rpc.asked).toBe(3);
  });

  it('is asked for again after something happened while a mower in any zone may write it', async () => {
    vi.useFakeTimers();
    // 23:30 UTC: the 29th far east of UTC, the 28th everywhere else
    vi.setSystemTime(Date.UTC(2026, 9, 28, 23, 30));
    const days = ['20261027', '20261028', '20261029'];
    for (const d of days) await historyOf(d);
    const before = rpc.asked;
    forgetToday();
    for (const d of days) await historyOf(d);
    expect(rpc.asked - before).toBe(2);
  });
});
