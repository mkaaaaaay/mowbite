import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {PlannerSettings} from './mowerBody';

// the planner and the shared settings as the app sees them
const fake = vi.hoisted(() => ({
  planner: {} as Record<string, unknown>,
  sent: [] as Record<string, unknown>[],
  app: {} as Record<string, unknown>,
  synced: false,
  // saves that time out before one goes through
  failing: 0,
  // what runs on the mower: OpenMower, MowBite OS (system.info) or not known yet (no answer to rpc.methods)
  os: 'openmower' as 'openmower' | 'mowbite-os' | 'unknown',
}));
const answer = (): PlannerSettings => ({
  settings: Object.fromEntries(
    Object.entries(fake.planner).map(([k, value]) => [k, {value, default: null, stored: true, type: k === 'robot_outline' ? 'points' : 'number', settable: true}]),
  ),
});
vi.mock('./rpc', () => ({
  callRpc: async (method: string, params: Record<string, unknown>) => {
    if (method === 'system.info') return {name: 'mowbite-os', version: '0.1'};
    if (method === 'planner.settings.set') {
      if (fake.failing > 0 && fake.failing--) throw new Error('timeout');
      fake.sent.push(params);
      Object.assign(fake.planner, params);
    }
    return answer();
  },
  isMissingMethod: () => false,
  onMethodsChanged: () => () => {},
  methodsUnknown: () => fake.os === 'unknown',
  rpcMethods: async () => (fake.os === 'unknown' ? null : new Set(fake.os === 'mowbite-os' ? ['system.info'] : [])),
}));
vi.mock('./settings', () => ({
  settingsStore: {subscribe: () => () => {}, snapshot: () => fake.app, serverSnapshot: () => ({})},
  syncSettings: async () => {
    fake.synced = true;
  },
  saveSettings: (next: Record<string, unknown>) => {
    fake.app = next;
  },
}));

const NX = {robot_width: 0.41, robot_front: 0.43, robot_rear: 0.18, mower_width: 0.18, blade_ahead: 0.185, blade_offset: 0};

// a fresh app start: the planner asked for its settings, then whatever that set off
async function start() {
  vi.resetModules();
  const body = await import('./mowerBody');
  await body.loadPlannerSettings();
  await new Promise((r) => setTimeout(r, 0));
  return body;
}

describe('the outline given to the planner on its own', () => {
  beforeEach(() => {
    fake.planner = {...NX, robot_outline: null};
    fake.sent = [];
    fake.app = {};
    fake.synced = false;
    fake.failing = 0;
    fake.os = 'openmower';
  });

  it('gives none on MowBite OS, it holds the sizes itself', async () => {
    fake.os = 'mowbite-os';
    await start();
    expect(fake.sent).toEqual([]);
    expect(fake.app.autoOutline).toBeUndefined();
  });

  it('waits until it is known what runs on the mower', async () => {
    fake.os = 'unknown';
    const body = await start();
    expect(fake.sent).toEqual([]);
    // the answer came meanwhile: OpenMower
    fake.os = 'openmower';
    await body.loadPlannerSettings(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.sent).toHaveLength(1);
  });

  it("sends the model's outline 1 cm larger once the shared settings are in, and notes the model", async () => {
    const body = await start();
    const nx = body.MOWER_MODELS.find((m) => m.key === 'yf-nx')!;
    expect(fake.synced).toBe(true);
    expect(fake.sent).toEqual([{robot_outline: body.grownOutline(nx.outline!, body.OUTLINE_LEEWAY)}]);
    expect(fake.app.autoOutline).toBe('yf-nx');
    // once per start
    await body.loadPlannerSettings(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.sent).toHaveLength(1);
  });

  it('tries again with the next answer when the save failed', async () => {
    fake.failing = 1;
    const body = await start();
    expect(fake.sent).toEqual([]);
    await body.loadPlannerSettings(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.sent).toHaveLength(1);
    expect(fake.app.autoOutline).toBe('yf-nx');
  });

  it('leaves the rectangle when it is kept', async () => {
    fake.app = {keepRectangle: true};
    await start();
    expect(fake.sent).toEqual([]);
  });

  it('leaves an outline the planner has, and sizes that are no model', async () => {
    fake.planner.robot_outline = [
      [0.4, 0.1],
      [-0.1, 0.1],
      [-0.1, -0.1],
      [0.4, -0.1],
    ];
    await start();
    fake.planner = {...NX, robot_width: 0.42, robot_outline: null};
    await start();
    expect(fake.sent).toEqual([]);
  });

  it('leaves a planner that does not know outlines', async () => {
    fake.planner = {...NX};
    await start();
    expect(fake.sent).toEqual([]);
  });
});
