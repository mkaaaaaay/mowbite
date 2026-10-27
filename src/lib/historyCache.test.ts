import {afterEach, describe, expect, it, vi} from 'vitest';

const rpc = vi.hoisted(() => ({asked: 0}));
vi.mock('./rpc', () => ({
  callRpc: async () => {
    rpc.asked++;
    return [];
  },
}));

const {historyOf} = await import('./history');

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
    // asked once the day was over, that answer stays
    vi.setSystemTime(Date.UTC(2026, 9, 30, 9, 0));
    await historyOf('20261027');
    expect(rpc.asked).toBe(2);
  });
});
