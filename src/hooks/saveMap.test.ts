import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {sha256Js} from '@/lib/sha256';

const fake = vi.hoisted(() => ({
  calls: [] as {method: string; params: unknown[]; resolve: (v: unknown) => void; reject: (e: unknown) => void}[],
  hear: null as ((payload: Buffer) => void) | null,
  info: null as {name: string; api?: number} | null,
}));
vi.mock('@/lib/mqttClient', () => ({
  topicStore: <T,>(_topic: string, initial: T, parse: (payload: Buffer, prev: T) => T) => {
    let value = initial;
    const listeners = new Set<() => void>();
    fake.hear = (payload) => {
      value = parse(payload, value);
      listeners.forEach((l) => l());
    };
    return {
      subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
      get: () => value,
      initial: () => initial,
    };
  },
}));
vi.mock('@/lib/rpc', () => {
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
    callRpc: (method: string, params: unknown[]) => new Promise((resolve, reject) => fake.calls.push({method, params, resolve, reject})),
    mapChanged: (e: unknown) => e instanceof RpcError && e.code === -32001 && e.method === 'map.replace',
  };
});
vi.mock('@/lib/mowerOs', () => ({
  knownSystemInfo: () => fake.info,
  isMowbiteOs: (i: {name?: string} | null) => i?.name === 'MowBite OS',
}));

import {RpcError} from '@/lib/rpc';
import {saveMap, type MowerMap} from './useMowerMap';

const sq = [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}];
const mapOf = (name: string): MowerMap => ({areas: [{id: 'a', properties: {name}, outline: sq}], docking_stations: []});
const text = (m: MowerMap) => JSON.stringify({...m, areas: m.areas.map((a) => ({...a, outline: [...a.outline, a.outline[0]]}))});
const hear = (m: MowerMap) => fake.hear!(Buffer.from(text(m)));
const sent = async () => {
  await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
  return fake.calls[0];
};
const changed = () => new RpcError('map.replace', -32001, 'map changed meanwhile');

beforeEach(() => {
  fake.calls = [];
  fake.info = {name: 'MowBite OS', api: 53};
  hear(mapOf('read'));
});
afterEach(() => vi.useRealTimers());

describe('saveMap', () => {
  it("names the map last read on MowBite OS from api 53, OpenMower and older ones get the map alone", async () => {
    void saveMap(mapOf('mine'));
    const call = await sent();
    expect(call.method).toBe('map.replace');
    expect(call.params[1]).toEqual({expected_sha256: sha256Js(new TextEncoder().encode(text(mapOf('read'))))});
    for (const info of [{name: 'MowBite OS', api: 52}, null]) {
      fake.calls = [];
      fake.info = info;
      void saveMap(mapOf('mine'));
      expect((await sent()).params).toHaveLength(1);
    }
  });

  it('counts a map turned down as saved when the mower has it already, sent again after the connection dropped', async () => {
    const saving = saveMap(mapOf('mine'));
    const call = await sent();
    call.reject(changed());
    // the mower's map comes again after the reconnect, after the answer
    await Promise.resolve();
    hear(mapOf('mine'));
    await expect(saving).resolves.toBe('stored');
  });

  it('fails when another map was stored meanwhile', async () => {
    vi.useFakeTimers();
    const saving = saveMap(mapOf('mine'));
    const call = await sent();
    hear(mapOf('theirs'));
    call.reject(changed());
    const failed = expect(saving).rejects.toMatchObject({code: -32001});
    await vi.advanceTimersByTimeAsync(5000);
    await failed;
  });
});
