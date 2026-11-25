import {beforeEach, describe, expect, it, vi} from 'vitest';

const mower = vi.hoisted(() => ({
  methods: new Set<string>(),
  info: {} as unknown,
  asked: [] as string[],
  events: [] as ((payload: Buffer) => void)[],
  changed: [] as (() => void)[],
  unknown: false,
  again: [] as (() => void)[],
}));
vi.mock('./rpc', () => ({
  rpcMethods: async () => mower.methods,
  onMethodsChanged: (l: () => void) => void mower.changed.push(l),
  methodsUnknown: () => mower.unknown,
  // the next try waits in again until the test runs it
  askUntilAnswered: <T>(ask: () => Promise<T>, got: (v: T) => void, unsure: (v: T) => boolean) => {
    const go = () => void ask().then((v) => (unsure(v) ? mower.again.push(go) : got(v)));
    go();
    return () => {};
  },
  callRpc: async (method: string) => {
    mower.asked.push(method);
    if (mower.info instanceof Error) throw mower.info;
    return method === 'system.info' ? mower.info : {released: true};
  },
}));
vi.mock('./mqttClient', () => ({onTopic: (_topic: string, h: (payload: Buffer) => void) => void mower.events.push(h)}));

const NOTE = {from: 8, to: 7, backup: 'before-rollback-8', backup_of: 1795000000, t: 1795300000, confirm: true};
const settled = () => new Promise((r) => setTimeout(r));
const say = (e: object) => mower.events.forEach((h) => h(Buffer.from(JSON.stringify({id: 'e', t: 1, type: 'DATA_ROLLBACK', ...e}))));

async function watch() {
  vi.resetModules();
  const store = await import('./dataRollback');
  store.subscribeRollback(() => {});
  await settled();
  return store;
}

describe("the way back of MowBite OS's data to an older backup", () => {
  beforeEach(() => {
    Object.assign(mower, {methods: new Set(['system.info', 'data.rollback.confirm']), info: {name: 'mowbite-os', data_rollback: NOTE}, asked: [], events: [], changed: [], unknown: false, again: []});
  });

  it('reads the note from system.info, none on a mower without data.rollback.confirm', async () => {
    expect((await watch()).rollbackNow()).toEqual(NOTE);
    mower.methods = new Set(['system.info']);
    mower.asked = [];
    expect((await watch()).rollbackNow()).toBeNull();
    expect(mower.asked).toEqual([]);
  });

  it('reads again until the mower could say, not on one without the methods', async () => {
    mower.info = new Error('timeout');
    const store = await watch();
    expect(store.rollbackNow()).toBeNull();
    mower.info = {name: 'mowbite-os', data_rollback: NOTE};
    mower.again.splice(0).forEach((go) => go());
    await settled();
    expect(store.rollbackNow()).toEqual(NOTE);
    expect(mower.again).toEqual([]);
    mower.methods = null as unknown as Set<string>;
    mower.unknown = true;
    await watch();
    expect(mower.again).toHaveLength(1);
    mower.unknown = false;
    mower.again = [];
    await watch();
    expect(mower.again).toEqual([]);
  });

  it('takes null, a missing one and anything else for none', async () => {
    for (const data_rollback of [null, undefined, 'yes', {confirm: true}]) {
      mower.info = {name: 'mowbite-os', data_rollback};
      expect((await watch()).rollbackNow()).toBeNull();
    }
  });

  it('is gone once confirmed, here or on another phone', async () => {
    const here = await watch();
    await here.confirmRollback();
    expect(mower.asked).toEqual(['system.info', 'data.rollback.confirm']);
    expect(here.rollbackNow()).toBeNull();
    const other = await watch();
    say({what: 'confirmed'});
    expect(other.rollbackNow()).toBeNull();
  });

  it('keeps the note when the mower turns the confirmation down', async () => {
    const store = await watch();
    mower.info = new Error('timeout');
    await expect(store.confirmRollback()).rejects.toThrow('timeout');
    expect(store.rollbackNow()).toEqual(NOTE);
  });

  it('reads again when the mower says it went back, and when its methods change', async () => {
    mower.info = {name: 'mowbite-os', data_rollback: null};
    const store = await watch();
    expect(store.rollbackNow()).toBeNull();
    mower.info = {name: 'mowbite-os', data_rollback: {...NOTE, confirm: false}};
    say({what: 'restored', confirm: false});
    await settled();
    expect(store.rollbackNow()).toMatchObject({confirm: false});
    mower.info = {name: 'mowbite-os', data_rollback: NOTE};
    mower.changed.forEach((l) => l());
    await settled();
    expect(store.rollbackNow()).toEqual(NOTE);
  });
});
