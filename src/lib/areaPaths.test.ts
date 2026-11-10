import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {MowerMap} from '@/hooks/useMowerMap';

const rpc = vi.hoisted(() => ({asked: 0, answer: null as unknown, known: true}));
vi.mock('./rpc', () => ({
  // null: rpc.methods didn't answer in time
  rpcMethods: async () => (rpc.known ? new Set(['mowing.plan']) : null),
  callRpc: async () => {
    rpc.asked++;
    return rpc.answer;
  },
}));

const {mowerPaths} = await import('./areaPlan');

const pose = (x: number, y: number) => ({pose: {position: {x, y}}});
const map = {areas: [{id: 'a', properties: {type: 'mow'}, outline: [{x: 0, y: 0}, {x: 4, y: 0}, {x: 4, y: 4}]}]} as unknown as MowerMap;

beforeEach(() => {
  rpc.asked = 0;
  rpc.known = true;
  rpc.answer = {paths: [{is_outline: 0, path: {poses: [pose(0, 0), pose(1, 0)]}}]};
});

describe('mowerPaths', () => {
  it('asks once per area, again when the mower started on it after that', async () => {
    const now = Date.now() / 1000;
    expect(await mowerPaths('a', map, now - 60)).toHaveLength(1);
    await mowerPaths('a', map, now - 60);
    await mowerPaths('a', map);
    expect(rpc.asked).toBe(1);
    // a later run of the area: its plan can be another (the direction of a start time, the settings)
    await mowerPaths('a', map, now + 60);
    expect(rpc.asked).toBe(2);
  });

  it("asks again after the mower couldn't tell", async () => {
    const other = {areas: [{...map.areas[0], id: 'b'}]} as unknown as MowerMap;
    rpc.known = false;
    expect(await mowerPaths('b', other)).toBeNull();
    rpc.known = true;
    expect(await mowerPaths('b', other)).toHaveLength(1);
  });
});
