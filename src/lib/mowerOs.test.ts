import {beforeEach, describe, expect, it, vi} from 'vitest';

const rpc = vi.hoisted(() => ({methods: new Set<string>(), answer: null as unknown, asked: [] as string[]}));
vi.mock('./rpc', () => ({
  rpcMethods: async () => rpc.methods,
  methodsUnknown: () => false,
  callRpc: async (method: string) => {
    rpc.asked.push(method);
    return rpc.answer;
  },
}));

const load = async () => {
  vi.resetModules();
  return import('./mowerOs');
};

describe('systemInfo', () => {
  beforeEach(() => {
    rpc.asked = [];
  });

  it('knows MowBite OS by its name', async () => {
    rpc.methods = new Set(['rpc.methods', 'system.info']);
    rpc.answer = {name: 'mowbite-os', version: '0.3.0', platform: 'tron', schema: 2};
    const {systemInfo, isMowbiteOs} = await load();
    const info = await systemInfo();
    expect(info).toEqual({name: 'mowbite-os', version: '0.3.0', platform: 'tron', schema: 2});
    expect(isMowbiteOs(info)).toBe(true);
    // asked once
    await systemInfo();
    expect(rpc.asked).toEqual(['system.info']);
  });

  it("doesn't ask OpenMower, it has no system.info", async () => {
    rpc.methods = new Set(['rpc.methods', 'params.set']);
    const {systemInfo, isMowbiteOs} = await load();
    expect(await systemInfo()).toBeNull();
    expect(isMowbiteOs(null)).toBe(false);
    expect(rpc.asked).toEqual([]);
  });

  it('takes nothing else for MowBite OS', async () => {
    rpc.methods = new Set(['system.info']);
    rpc.answer = {version: '1'};
    const {systemInfo, isMowbiteOs} = await load();
    expect(await systemInfo()).toBeNull();
    expect(isMowbiteOs({name: 'openmower'})).toBe(false);
  });
});

describe('osSpacing', () => {
  it('is the blade less the overlap, the planner values that count', async () => {
    const {osSpacing} = await load();
    expect(osSpacing({mower_width: {value: 0.18}, overlap: {value: 0.15}})).toBeCloseTo(0.153);
    expect(osSpacing({mower_width: {value: 0.2}})).toBe(0.2);
    expect(osSpacing({overlap: {value: 0.1}})).toBeUndefined();
    expect(osSpacing(undefined)).toBeUndefined();
  });
});
