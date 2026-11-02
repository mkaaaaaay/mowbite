import {beforeEach, describe, expect, it, vi} from 'vitest';

// a planner busy planning: its answer to planner.settings comes when the test says
const fake = vi.hoisted(() => ({
  calls: [] as {method: string; resolve: (v: unknown) => void; reject: (e: unknown) => void}[],
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
    callRpc: (method: string) => new Promise((resolve, reject) => fake.calls.push({method, resolve, reject})),
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
    expect(since).toEqual({since: expect.any(Number), what: 'load'});

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

  it('waits for a change through the minutes the planner plans, sent again when a minute brought no answer', async () => {
    const m = await fresh();
    const load = m.loadPlannerSettings();
    fake.calls[0].resolve(settings);
    await load;
    expect(m.plannerWaiting()).toBeNull();

    const saving = m.savePlannerSettings({body_fit: true});
    expect(m.plannerWaiting()).toEqual({since: expect.any(Number), what: 'save'});
    fake.calls[1].reject(new m.RpcError('planner.settings.set', 'timeout', 'timed out'));
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.calls.map((c) => c.method)).toEqual(['planner.settings', 'planner.settings.set', 'planner.settings.set']);
    expect(m.plannerWaiting()?.what).toBe('save');

    fake.calls[2].resolve(settings);
    await saving;
    expect(m.plannerWaiting()).toBeNull();
  });

  it('gives up on a change the planner refuses', async () => {
    const m = await fresh();
    const load = m.loadPlannerSettings();
    fake.calls[0].resolve(settings);
    await load;
    const saving = m.savePlannerSettings({body_fit: 'yes'});
    fake.calls[1].reject(new m.RpcError('planner.settings.set', -32602, 'body_fit must be a boolean'));
    await expect(saving).rejects.toThrow('body_fit must be a boolean');
    expect(fake.calls).toHaveLength(2);
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
