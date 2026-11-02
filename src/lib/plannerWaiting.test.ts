import {beforeEach, describe, expect, it, vi} from 'vitest';

// a planner busy planning: its answer to planner.settings comes when the test says
const fake = vi.hoisted(() => ({
  calls: [] as {resolve: (v: unknown) => void; reject: (e: unknown) => void}[],
  listed: true,
}));
vi.mock('./rpc', () => {
  class RpcError extends Error {
    constructor(
      public method: string,
      public code: number | 'timeout',
      message: string,
    ) {
      super(message);
    }
  }
  return {
    RpcError,
    callRpc: (method: string) =>
      method === 'planner.settings' ? new Promise((resolve, reject) => fake.calls.push({resolve, reject})) : Promise.reject(new Error(method)),
    isMissingMethod: (e: unknown) => e instanceof RpcError && e.code === -32601,
    rpcMethods: async () => new Set(fake.listed ? ['planner.settings'] : []),
  };
});
vi.mock('./settings', () => ({
  settingsStore: {subscribe: () => () => {}, snapshot: () => ({}), serverSnapshot: () => ({})},
  syncSettings: async () => {},
  saveSettings: () => {},
}));

const settings = {settings: {mower_width: {value: 0.18, default: 0.18, stored: false, type: 'number', settable: true}}};

async function fresh() {
  vi.resetModules();
  fake.calls = [];
  const body = await import('./mowerBody');
  const {RpcError} = await import('./rpc');
  return {...body, RpcError};
}

describe('waiting for a busy planner', () => {
  beforeEach(() => {
    fake.listed = true;
  });

  it('waits from the first question until the answer, also across questions that got none', async () => {
    const m = await fresh();
    expect(m.plannerWaiting()).toBeNull();
    const first = m.loadPlannerSettings().catch(() => null);
    await Promise.resolve();
    const since = m.plannerWaiting();
    expect(since).toEqual(expect.any(Number));

    fake.calls[0].reject(new m.RpcError('planner.settings', 'timeout', 'timed out'));
    await first;
    expect(m.plannerSettings()).toBeUndefined();
    expect(m.plannerWaiting()).toBe(since);

    const second = m.loadPlannerSettings();
    expect(m.plannerWaiting()).toBe(since);
    fake.calls[1].resolve(settings);
    await second;
    expect(m.plannerSettings()?.settings.mower_width.value).toBe(0.18);
    expect(m.plannerWaiting()).toBeNull();
  });

  it("doesn't wait on a mower that has no planner", async () => {
    fake.listed = false;
    const m = await fresh();
    void m.loadPlannerSettings().catch(() => null);
    await Promise.resolve();
    await Promise.resolve();
    expect(m.plannerWaiting()).toBeNull();
  });
});
