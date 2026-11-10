import {EventEmitter} from 'node:events';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {TOPIC} from '@/lib/openmower';
import type {MowerMap} from './useMowerMap';

// stands in for the mqtt client (the demo's, so nothing connects): the map comes on its topic as the broker hands it on
class FakeClient extends EventEmitter {
  connected = true;
  subscribe() {}
}
const load = async () => {
  vi.resetModules();
  const client = new FakeClient();
  vi.doMock('@/lib/demo/client', () => ({demoClient: () => client}));
  vi.doMock('@/lib/mowers', () => ({isDemo: () => true, selectedMower: () => null}));
  const {whenMowerHas} = await import('./useMowerMap');
  const send = (text: string) => client.emit('message', TOPIC.map, Buffer.from(text));
  return {whenMowerHas, send};
};

// a map as the editor sends it (outlines open) and as the mower writes it back: outlines closed, keys in its own order,
// active only when false
const square = (id: string, x: number): MowerMap['areas'][number] => ({
  id,
  properties: {name: id, type: 'mow', active: true},
  outline: [
    {x, y: 0},
    {x: x + 1, y: 0},
    {x: x + 1, y: 1},
    {x, y: 1},
  ],
});
const sent: MowerMap = {areas: [square('lawn', 0), square('bed', 2)], docking_stations: []};
const back = JSON.stringify({
  docking_stations: [],
  areas: sent.areas.map((a) => ({outline: [...a.outline, a.outline[0]], properties: {type: a.properties.type, name: a.properties.name}, id: a.id})),
});
// the one before, without the bed
const before = JSON.stringify({areas: [square('lawn', 0)], docking_stations: []});

describe('waiting until a map is on the mower', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/demo/client');
    vi.doUnmock('@/lib/mowers');
  });

  it('comes once the map is back from the mower, not for another one and not again', async () => {
    const {whenMowerHas, send} = await load();
    let n = 0;
    whenMowerHas(sent, () => n++);
    send(before);
    send(before);
    expect(n).toBe(0);
    send(back);
    expect(n).toBe(1);
    // the same map again (a reconnect), and after another one once more
    send(back);
    send(before);
    send(back);
    expect(n).toBe(1);
  });

  it('called off, it never comes', async () => {
    const {whenMowerHas, send} = await load();
    let n = 0;
    const off = whenMowerHas(sent, () => n++);
    send(before);
    off();
    send(back);
    expect(n).toBe(0);
  });

  it('comes at once for a map the mower has already, and only then', async () => {
    const {whenMowerHas, send} = await load();
    let first = 0;
    whenMowerHas(sent, () => first++);
    send(back);
    expect(first).toBe(1);
    let n = 0;
    const off = whenMowerHas(sent, () => n++);
    expect(n).toBe(1);
    send(before);
    send(back);
    off();
    expect(n).toBe(1);
    expect(first).toBe(1);
  });

  it('each one waiting comes, also when the one before takes itself off on the same message', async () => {
    const {whenMowerHas, send} = await load();
    const got: string[] = [];
    whenMowerHas(sent, () => got.push('save'));
    whenMowerHas(sent, () => got.push('restore'));
    send(back);
    expect(got).toEqual(['save', 'restore']);
  });
});
