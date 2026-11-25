import {beforeEach, describe, expect, it, vi} from 'vitest';

const rpc = vi.hoisted(() => ({
  methods: new Set<string>() as Set<string> | null,
  unknown: false,
  answer: null as unknown,
  asked: [] as string[],
  heard: [] as ((m: Set<string> | null) => void)[],
}));
vi.mock('./rpc', async (real) => ({
  RpcError: (await real<typeof import('./rpc')>()).RpcError,
  isMissingMethod: (await real<typeof import('./rpc')>()).isMissingMethod,
  askUntilAnswered: (await real<typeof import('./rpc')>()).askUntilAnswered,
  rpcMethods: async () => rpc.methods,
  methodsUnknown: () => rpc.unknown,
  onMethodsChanged: (l: (m: Set<string> | null) => void) => {
    rpc.heard.push(l);
    return () => {};
  },
  callRpc: async (method: string) => {
    rpc.asked.push(method);
    if (rpc.answer instanceof Error) throw rpc.answer;
    return rpc.answer;
  },
}));

// what's noted for the mower looked at (mowers' noteOs)
const noted: boolean[] = [];
vi.mock('./mowers', async (real) => ({...(await real<typeof import('./mowers')>()), noteOs: (os: boolean) => noted.push(os)}));

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

describe('what the mower runs, noted for its port', () => {
  beforeEach(() => {
    noted.length = 0;
    rpc.unknown = false;
  });

  it('is MowBite OS once it said so, OpenMower when it has no system.info', async () => {
    rpc.methods = new Set(['system.info']);
    rpc.answer = {name: 'mowbite-os'};
    await (await load()).systemInfo();
    expect(noted).toEqual([true]);
    rpc.methods = new Set(['params.set']);
    await (await load()).systemInfo();
    expect(noted).toEqual([true, false]);
  });

  it('stays as it was while the mower gave no answer', async () => {
    rpc.methods = null;
    rpc.unknown = true;
    await (await load()).systemInfo();
    expect(noted).toEqual([]);
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

  it('is undecided while MowBite OS lists system.info but its node is not up yet', async () => {
    const {RpcError} = await import('./rpc');
    rpc.methods = new Set(['system.info']);
    rpc.answer = Object.assign(new RpcError('system.info', -32601, 'The node that answers "system.info" is gone'), {listed: true});
    const {systemInfo} = await load();
    expect(await systemInfo()).toBeUndefined();
    rpc.answer = {name: 'mowbite-os'};
    expect(await systemInfo()).toEqual({name: 'mowbite-os'});
  });

  it('asks again once system.info shows up in the list after it was taken for OpenMower', async () => {
    rpc.heard = [];
    rpc.methods = new Set(['params.set']);
    rpc.answer = {name: 'mowbite-os', api: 53};
    const os = await load();
    expect(await os.systemInfo()).toBeNull();
    rpc.methods = new Set(['params.set', 'system.info']);
    rpc.heard.forEach((l) => l(rpc.methods));
    await vi.waitFor(() => expect(os.runsMowbiteOs()).toBe(true));
  });
});

describe('MowBite OS back as another mower', () => {
  it('asks system.info anew and takes the new answer', async () => {
    rpc.methods = new Set(['system.info']);
    rpc.answer = {name: 'mowbite-os', platform: ''};
    const os = await load();
    expect((await os.systemInfo())?.platform).toBe('');
    rpc.answer = {name: 'mowbite-os', platform: 'airseekers_tron'};
    expect((await os.systemInfo())?.platform).toBe('');
    os.askSystemInfoAgain();
    await vi.waitFor(() => expect(os.knownSystemInfo()?.platform).toBe('airseekers_tron'));
  });
});

describe('"method not found" for a method the mower lists', () => {
  it('means a part gone for now on MowBite OS only, and only once it is known what runs there', async () => {
    rpc.methods = new Set(['system.info']);
    rpc.answer = {name: 'mowbite-os'};
    const os = await load();
    const {RpcError} = await import('./rpc');
    const listed = Object.assign(new RpcError('planner.plan', -32601, 'The node that answers "planner.plan" is gone'), {listed: true});
    expect(os.providerGone(listed)).toBe(false);
    await os.systemInfo();
    expect(os.providerGone(listed)).toBe(true);
    // one the app stopped itself, the list doesn't have it
    expect(os.providerGone(new RpcError('planner.plan', -32601, 'Method not found'))).toBe(false);
    expect(os.providerGone(new RpcError('planner.plan', 'timeout', 'timed out'))).toBe(false);
    expect(os.providerGone(new Error('gone'))).toBe(false);

    rpc.methods = new Set(['params.set']);
    const openMower = await load();
    await openMower.systemInfo();
    expect(openMower.providerGone(listed)).toBe(false);
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

describe('a docking test as a series', () => {
  it('only once it is known what runs on the mower, on MowBite OS from its api on', async () => {
    const {dockTestSeries} = await load();
    expect(dockTestSeries(undefined)).toBe(false);
    expect(dockTestSeries(null)).toBe(true);
    expect(dockTestSeries({name: 'mowbite-os'})).toBe(false);
    expect(dockTestSeries({name: 'mowbite-os', api: 36})).toBe(false);
    expect(dockTestSeries({name: 'mowbite-os', api: 37})).toBe(true);
  });
});

describe('the gesture for the setup WLAN', () => {
  it("is the mower's own from api 68, else a Tron's from api 64, none elsewhere", async () => {
    const {setupWifiGesture} = await load();
    const os = {name: 'mowbite-os', platform: 'airseekers_tron', api: 64};
    expect(setupWifiGesture({...os, setup_wifi_gesture: {button: 'on_ok', presses: 3, within_s: 4, open_s: 600}})).toEqual({button: 'on_ok', presses: 3, within_s: 4, open_s: 600});
    expect(setupWifiGesture({...os, api: 68, setup_wifi_gesture: null})).toBeNull();
    expect(setupWifiGesture({...os, setup_wifi_gesture: {button: null, presses: 0, within_s: 5, open_s: 600}})).toBeNull();
    expect(setupWifiGesture(os)).toEqual({button: 'on_ok', presses: 5, within_s: 5, open_s: 1800});
    expect(setupWifiGesture({...os, api: 63})).toBeNull();
    expect(setupWifiGesture({...os, platform: 'nx60i'})).toBeNull();
    expect(setupWifiGesture({name: 'openmower'})).toBeNull();
    expect(setupWifiGesture(null)).toBeNull();
  });
});
