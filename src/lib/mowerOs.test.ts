import {beforeEach, describe, expect, it, vi} from 'vitest';

const rpc = vi.hoisted(() => ({methods: new Set<string>() as Set<string> | null, unknown: false, answer: null as unknown, asked: [] as string[]}));
vi.mock('./rpc', async (real) => ({
  RpcError: (await real<typeof import('./rpc')>()).RpcError,
  isMissingMethod: (await real<typeof import('./rpc')>()).isMissingMethod,
  rpcMethods: async () => rpc.methods,
  methodsUnknown: () => rpc.unknown,
  callRpc: async (method: string) => {
    rpc.asked.push(method);
    if (rpc.answer instanceof Error) throw rpc.answer;
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
    rpc.unknown = false;
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

describe('systemInfo without an answer', () => {
  it('is undecided after rpc.methods timed out and asks again', async () => {
    rpc.methods = null;
    rpc.unknown = true;
    const {systemInfo} = await load();
    expect(await systemInfo()).toBeUndefined();
    rpc.methods = new Set(['system.info']);
    rpc.unknown = false;
    rpc.answer = {name: 'mowbite-os', api: 4};
    expect(await systemInfo()).toEqual({name: 'mowbite-os', api: 4});
  });

  it('is undecided after system.info timed out, not OpenMower', async () => {
    const {RpcError} = await import('./rpc');
    rpc.asked = [];
    rpc.methods = new Set(['system.info']);
    rpc.answer = new RpcError('system.info', 'timeout', 'timed out');
    const {systemInfo} = await load();
    expect(await systemInfo()).toBeUndefined();
    rpc.answer = {name: 'mowbite-os'};
    expect(await systemInfo()).toEqual({name: 'mowbite-os'});
    expect(rpc.asked).toEqual(['system.info', 'system.info']);
  });

  it('is undecided after another error of system.info, OpenMower only when it has no such method', async () => {
    const {RpcError} = await import('./rpc');
    rpc.methods = new Set(['system.info']);
    rpc.answer = new RpcError('system.info', -32603, 'internal error');
    const {systemInfo} = await load();
    expect(await systemInfo()).toBeUndefined();
    rpc.answer = new Error('connection lost');
    expect(await systemInfo()).toBeUndefined();
    rpc.answer = new RpcError('system.info', -32601, 'method not found');
    expect(await systemInfo()).toBeNull();
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
