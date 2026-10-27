import {describe, expect, it, vi} from 'vitest';
import {leftoverAreas, leftoverPaths, leftoversHandedOut, readLeftovers} from './leftovers';

const rpc = vi.hoisted(() => ({lines: [] as {t: number; msg: string}[], asked: [] as unknown[], areas: {} as Record<string, unknown>}));
vi.mock('./rpc', () => ({
  rpcMethods: async () => new Set(['planner.log', 'planner.leftovers']),
  callRpc: async (method: string, params: unknown) => {
    rpc.asked.push([method, params]);
    return method === 'planner.leftovers' ? {areas: rpc.areas} : {lines: rpc.lines};
  },
}));

describe('readLeftovers', () => {
  it('sums what every area has left and keeps the messages', () => {
    const r = readLeftovers({
      file: 'track_7.bin',
      armed: 0,
      areas: {
        a: {paths: [{}, {}], left_m2: 0.07, stats: {leftovers: {left_m2: 0.07, pieces: 1, passes: 2}}},
        b: {paths: [], message: 'nothing left', stats: {leftovers: {left_m2: 0, pieces: 0, passes: 0}}},
        c: {paths: [], message: 'most of the area is left', stats: null},
      },
    });
    expect(r.m2).toBeCloseTo(0.07);
    expect(r.passes).toBe(2);
    expect(r.armed).toBe(0);
    expect(r.file).toBe('track_7.bin');
    expect(r.areas.map((a) => [a.id, a.passes, a.message])).toEqual([
      ['a', 2, undefined],
      ['b', 0, 'nothing left'],
      ['c', 0, 'most of the area is left'],
    ]);
  });

  it('takes the reason an area is left out, and the planner from before that mows such an area whole', () => {
    const r = readLeftovers({
      areas: {
        a: {paths: [], left_m2: 48.2, reason: 'most_left', message: 'most of the area is left (48.2 of 50.1 m2): left out, mow it on its own'},
        b: {paths: [], left_m2: 0.01, reason: 'nothing_left', message: 'nothing left to mow where the mower gets to (0.01 m2 left)'},
        c: {paths: [], left_m2: 48.2, message: 'most of the area is left (48.2 of 50.1 m2): a mow of its own, not leftovers'},
      },
    });
    expect(r.areas.map((a) => [a.id, a.reason, a.whole])).toEqual([
      ['a', 'most_left', undefined],
      ['b', 'nothing_left', undefined],
      ['c', undefined, true],
    ]);
    expect(r.m2).toBe(0);
  });

  it('takes an answer with nothing in it', () => {
    expect(readLeftovers({})).toEqual({areas: [], m2: 0, passes: 0, armed: 0});
  });
});

describe('leftovers handed out', () => {
  const lines = [
    {t: 100, msg: 'MowBite Planner: leftovers armed for 900 s: g 0.06 m2 in 2 passes'},
    {t: 110, msg: 'MowBite Planner: area f, 2 paths, 7995 poses, 524 m, lanes at 153.0 deg, kept from before'},
    {t: 120, msg: 'MowBite Planner: area g, the leftovers: 1 paths, 5 m, 2 passes'},
  ];

  it('takes the areas the planner gave the leftover passes, not the ones only armed or planned', () => {
    expect([...leftoverAreas(lines)]).toEqual(['g']);
  });

  it('asks the planner log from a moment before the area started', async () => {
    rpc.lines = lines;
    expect(await leftoversHandedOut('g', 120.05)).toBe(true);
    expect(rpc.asked.at(-1)).toEqual(['planner.log', {since: 110.05}]);
    expect(await leftoversHandedOut('f', 110.05)).toBe(false);
  });
});


describe('leftover passes', () => {
  it("asks the planner for the area's passes of that mow and reads them like a plan", async () => {
    rpc.areas = {
      a: {area_id: 'a', paths: [{is_outline: false, points: [[0, 0], [2, 0]], pose_index: [0, 4]}], left_m2: 0.3},
    };
    const paths = await leftoverPaths('job1', 'a');
    expect(rpc.asked.at(-1)).toEqual(['planner.leftovers', {job_id: 'job1', area_id: 'a'}]);
    expect(paths).toEqual([{outline: false, points: [{x: 0, y: 0}, {x: 2, y: 0}], index: [0, 4]}]);
  });

  it('gives none for an area without passes', async () => {
    rpc.areas = {b: {area_id: 'b', paths: [], message: 'most of the area is left'}};
    expect(await leftoverPaths('job1', 'b')).toBeNull();
  });
});
