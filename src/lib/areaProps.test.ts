import {describe, expect, it, vi} from 'vitest';

const mower = vi.hoisted(() => ({answers: true}));
vi.mock('./rpc', async (real) => ({
  ...(await real<typeof import('./rpc')>()),
  rpcMethods: async () => new Set(['rpc.methods', 'map.area_properties', 'mowing.plan']),
  methodsUnknown: () => false,
  callRpc: async () => {
    if (!mower.answers) throw new Error('map.area_properties timed out');
    return ['mowable', 'mow_around', 'priority'];
  },
}));

const {areaProperties} = await import('./areaProps');

describe('areaProperties', () => {
  it('asks again after the mower once did not answer, the fallback is not kept', async () => {
    mower.answers = false;
    expect([...(await areaProperties())]).toEqual(['mowable']);
    mower.answers = true;
    expect([...(await areaProperties())]).toEqual(['mowable', 'mow_around', 'priority']);
  });

  it("isn't taken as the answer by a page that asks until it's sure, that one gets the mower's once it answers", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const {askAreaProperties} = await import('./areaProps');
    mower.answers = false;
    const got: string[][] = [];
    const stop = askAreaProperties((p) => got.push([...p]));
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual([]);
    mower.answers = true;
    await vi.advanceTimersByTimeAsync(15000);
    expect(got).toEqual([['mowable', 'mow_around', 'priority']]);
    stop();
    vi.useRealTimers();
  });
});
