import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {PlanningProgress} from './plannerProgress';

// planner.plan answered when the test says, and the planner's progress topic as the test sets it
const fake = vi.hoisted(() => ({
  calls: [] as {resolve: (v: unknown) => void; reject: (e: unknown) => void}[],
  progress: null as unknown,
  listeners: new Set<() => void>(),
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
  return {RpcError, callRpc: () => new Promise((resolve, reject) => fake.calls.push({resolve, reject}))};
});
vi.mock('./mqttClient', () => ({
  topicStore: (_topic: string, initial: unknown) => ({
    subscribe: (l: () => void) => {
      fake.listeners.add(l);
      return () => fake.listeners.delete(l);
    },
    get: () => fake.progress,
    initial: () => initial,
  }),
}));

const now = () => Date.now() / 1000;
const planning = (p: Partial<PlanningProgress>): PlanningProgress => ({
  area_id: 'a',
  running: true,
  stage: 'route',
  done: 100,
  of: 1000,
  started: now(),
  elapsed_s: 1,
  estimate_s: null,
  error: null,
  ...p,
});
const tell = (p: PlanningProgress | null) => {
  fake.progress = p;
  fake.listeners.forEach((l) => l());
};
const settle = () => new Promise((r) => setTimeout(r, 0));

async function fresh() {
  vi.resetModules();
  fake.calls = [];
  fake.listeners.clear();
  fake.progress = null;
  const m = await import('./plannerProgress');
  const {RpcError} = await import('./rpc');
  const timeout = () => new RpcError('planner.plan', 'timeout', 'planner.plan timed out');
  return {...m, timeout};
}

describe('planner progress', () => {
  beforeEach(() => {
    fake.progress = null;
  });

  it('reads what the planner sends, nothing from a message without its area or start', async () => {
    const {readProgress} = await fresh();
    const p = readProgress(JSON.stringify({area_id: 'a', key: 'k', running: true, stage: 'route', done: 420, of: 1000, started: 5, elapsed_s: 3, estimate_s: null}));
    expect(p).toMatchObject({area_id: 'a', running: true, stage: 'route', done: 420, of: 1000, started: 5, estimate_s: null, error: null});
    expect(readProgress(JSON.stringify({running: true, started: 5}))).toBeNull();
    expect(readProgress(JSON.stringify({area_id: 'a'}))).toBeNull();
  });

  it("counts a planning of the area asked for: a running one always, a finished one only when it's newer", async () => {
    const {progressFor} = await fresh();
    const ask = {areaId: 'a', at: now()};
    expect(progressFor(planning({started: ask.at - 300}), ask)).not.toBeNull();
    expect(progressFor(planning({running: false, started: ask.at - 300}), ask)).toBeNull();
    expect(progressFor(planning({running: false, started: ask.at + 2}), ask)).not.toBeNull();
    expect(progressFor(planning({area_id: 'b'}), ask)).toBeNull();
    expect(progressFor(planning({}), {areaId: null, at: ask.at})).toBeNull();
  });

  it('waits beyond the 90 s while the planning moves on, then asks again for the plan it made', async () => {
    const m = await fresh();
    tell(planning({done: 100}));
    const plan = m.askPlan<{lanes: number}>({area_id: 'a'});
    expect(m.planAsked()).toMatchObject({areaId: 'a'});
    fake.calls[0].reject(m.timeout());
    await settle();
    tell(planning({done: 600}));
    expect(fake.calls).toHaveLength(1);
    tell(planning({running: false, stage: 'done', done: 1000}));
    await settle();
    expect(fake.calls).toHaveLength(2);
    fake.calls[1].resolve({lanes: 12});
    expect(await plan).toEqual({lanes: 12});
    expect(m.planAsked()).toBeNull();
  });

  it('fails after the 90 s as before without a planning running', async () => {
    const m = await fresh();
    tell(planning({running: false, started: now() - 600}));
    const plan = m.askPlan({area_id: 'a'});
    fake.calls[0].reject(m.timeout());
    await expect(plan).rejects.toThrow('timed out');
    expect(fake.calls).toHaveLength(1);
  });

  it('shows no plan worked out ahead', async () => {
    const m = await fresh();
    const plan = m.askPlan({area_id: 'a'}, false);
    expect(m.planAsked()).toBeNull();
    fake.calls[0].resolve({});
    await plan;
  });

  it('shows a plan waited for before it is asked like one asked for, from when the waiting began', async () => {
    const m = await fresh();
    const hide = m.showWait('a', now() - 30);
    expect(m.planAsked()).toMatchObject({areaId: 'a'});
    const plan = m.askPlan({area_id: 'a'});
    // the older one counts
    expect(m.planAsked()!.at).toBeLessThan(now() - 29);
    hide();
    expect(m.planAsked()!.at).toBeGreaterThan(now() - 2);
    fake.calls[0].resolve({});
    await plan;
    expect(m.planAsked()).toBeNull();
  });
});
