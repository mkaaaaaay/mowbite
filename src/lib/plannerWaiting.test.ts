import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// a planner busy planning: its answer to planner.settings comes when the test says
const fake = vi.hoisted(() => ({
  calls: [] as {method: string; resolve: (v: unknown) => void; reject: (e: unknown) => void}[],
  listed: true,
  // what rpc.methods said so far (undefined: no answer yet), and who waits for its answer
  known: null as Set<string> | null | undefined,
  waiting: [] as (() => void)[],
  // who hears a new list of methods, whether MowBite OS runs on the mower and "method not found" means its planner
  // is gone for now
  heard: [] as ((m: Set<string> | null) => void)[],
  os: false,
  gone: false,
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
    knownMethods: () => fake.known,
    askUntilAnswered: (_ask: unknown, got: () => void) => {
      fake.waiting.push(got);
      return () => void fake.waiting.splice(fake.waiting.indexOf(got), 1);
    },
    onMethodsChanged: (l: (m: Set<string> | null) => void) => {
      fake.heard.push(l);
      return () => {};
    },
  };
});
vi.mock('./mowerOs', async (real) => ({
  ...(await real<typeof import('./mowerOs')>()),
  runsMowbiteOs: () => fake.os,
  providerGone: (e: {code?: unknown}) => fake.gone && e.code === -32601,
}));
vi.mock('./settings', () => ({
  settingsStore: {subscribe: () => () => {}, snapshot: () => ({}), serverSnapshot: () => ({})},
  syncSettings: async () => {},
  saveSettings: () => {},
}));

const settings = {settings: {mower_width: {value: 0.18, default: 0.18, stored: false, type: 'number', settable: true}}};

async function fresh() {
  vi.resetModules();
  fake.calls = [];
  fake.heard = [];
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

  it('waits for a change as long as the planner plans, sent once', async () => {
    const m = await fresh();
    const load = m.loadPlannerSettings();
    fake.calls[0].resolve(settings);
    await load;
    expect(m.plannerWaiting()).toBeNull();

    const saving = m.savePlannerSettings({body_fit: true});
    expect(m.plannerWaiting()).toEqual({since: expect.any(Number), what: 'save'});
    fake.calls[1].reject(new m.RpcError('planner.settings.set', 'timeout', 'timed out'));
    await expect(saving).rejects.toThrow('timed out');
    expect(fake.calls.map((c) => c.method)).toEqual(['planner.settings', 'planner.settings.set']);
    expect(m.plannerWaiting()).toBeNull();

    const again = m.savePlannerSettings({body_fit: true});
    fake.calls[2].resolve(settings);
    await again;
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

describe('asking the planner until it answers', () => {
  beforeEach(() => {
    fake.listed = true;
    fake.known = null;
    fake.waiting = [];
    fake.os = false;
    fake.gone = false;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks again at once after no answer, 15 s after an error, no more once it answered', async () => {
    const m = await fresh();
    let failed = 0;
    const stop = m.askPlanner(() => failed++);
    expect(fake.calls).toHaveLength(1);
    fake.calls[0].reject(new m.RpcError('planner.settings', 'timeout', 'timed out'));
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.calls).toHaveLength(2);
    fake.calls[1].reject(new m.RpcError('planner.settings', -32000, 'busy'));
    await vi.advanceTimersByTimeAsync(14000);
    expect(fake.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.calls).toHaveLength(3);
    expect(failed).toBe(2);
    fake.calls[2].resolve(settings);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fake.calls).toHaveLength(3);
    stop();
  });

  it('asks a mower that answered no call at all again once it tells its methods, not every minute', async () => {
    fake.known = undefined;
    const m = await fresh();
    const stop = m.askPlanner();
    fake.calls[0].reject(new m.RpcError('planner.settings', 'timeout', 'timed out'));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fake.calls).toHaveLength(1);
    expect(fake.waiting).toHaveLength(1);
    fake.known = new Set(['planner.settings']);
    fake.waiting[0]();
    expect(fake.calls).toHaveLength(2);
    stop();
  });

  it('takes a mower that has no such method as one without the planner and asks no more', async () => {
    const m = await fresh();
    const stop = m.askPlanner();
    fake.calls[0].reject(new m.RpcError('planner.settings', -32601, 'Method not found'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(m.plannerSettings()).toBeNull();
    expect(fake.calls).toHaveLength(1);
    stop();
  });

  it("asks again when MowBite OS's planner is only gone for now", async () => {
    fake.gone = true;
    const m = await fresh();
    const stop = m.askPlanner();
    fake.calls[0].reject(new m.RpcError('planner.settings', -32601, 'The node that answers "planner.settings" is gone'));
    await vi.advanceTimersByTimeAsync(14000);
    expect(m.plannerSettings()).toBeUndefined();
    expect(fake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.calls).toHaveLength(2);
    fake.calls[1].resolve(settings);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.plannerSettings()?.settings.mower_width.value).toBe(0.18);
    stop();
  });

  it('asks a planner MowBite OS lists only later until it answers, without a reload', async () => {
    fake.os = true;
    const m = await fresh();
    const stop = m.askPlanner();
    fake.calls[0].reject(new m.RpcError('planner.settings', -32601, 'Method not found'));
    await vi.advanceTimersByTimeAsync(1);
    expect(m.plannerSettings()).toBeNull();
    // other methods came: nothing to ask
    fake.heard.forEach((l) => l(new Set(['camera.list'])));
    expect(fake.calls).toHaveLength(1);
    fake.heard.forEach((l) => l(new Set(['camera.list', 'planner.settings'])));
    expect(fake.calls).toHaveLength(2);
    expect(m.plannerSettings()).toBeUndefined();
    // busy with its first plan: asked again like on a first load, another new list in between asks nothing more
    fake.calls[1].reject(new m.RpcError('planner.settings', 'timeout', 'timed out'));
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.calls).toHaveLength(3);
    fake.heard.forEach((l) => l(new Set(['planner.settings'])));
    expect(fake.calls).toHaveLength(3);
    fake.calls[2].resolve(settings);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.plannerSettings()?.settings.mower_width.value).toBe(0.18);
    // one that's known is left alone
    fake.heard.forEach((l) => l(new Set(['planner.settings'])));
    await vi.advanceTimersByTimeAsync(60000);
    expect(fake.calls).toHaveLength(3);
    stop();
  });

  it('leaves OpenMower as it was: no planner when the page loaded, none until it loads again', async () => {
    const m = await fresh();
    const stop = m.askPlanner();
    fake.calls[0].reject(new m.RpcError('planner.settings', -32601, 'Method not found'));
    await vi.advanceTimersByTimeAsync(1);
    fake.heard.forEach((l) => l(new Set(['planner.settings'])));
    await vi.advanceTimersByTimeAsync(60000);
    expect(fake.calls).toHaveLength(1);
    expect(m.plannerSettings()).toBeNull();
    stop();
  });

  it('stopped, it neither asks nor waits any more', async () => {
    fake.known = undefined;
    const m = await fresh();
    const stop = m.askPlanner();
    fake.calls[0].reject(new m.RpcError('planner.settings', 'timeout', 'timed out'));
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.waiting).toHaveLength(1);
    stop();
    expect(fake.waiting).toHaveLength(0);
    const other = m.askPlanner();
    fake.calls[1].reject(new m.RpcError('planner.settings', -32000, 'busy'));
    await vi.advanceTimersByTimeAsync(1);
    other();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fake.calls).toHaveLength(2);
  });
});
