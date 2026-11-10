import {describe, expect, it, vi} from 'vitest';

const mower = vi.hoisted(() => ({answers: true}));
vi.mock('./rpc', () => ({
  rpcMethods: async () => new Set(['rpc.methods', 'map.area_properties', 'mowing.plan']),
  methodsUnknown: () => false,
  askUntilAnswered: () => () => {},
  callRpc: async () => {
    if (!mower.answers) throw new Error('map.area_properties timed out');
    return ['mowable', 'mow_around', 'priority'];
  },
}));

const {areaProperties} = await import('./areaProps');

describe('areaProperties', () => {
  it('asks again after the mower once did not answer, the fallback is not kept', async () => {
    mower.answers = false;
    expect([...(await areaProperties())]).toEqual(['mowable']);
    mower.answers = true;
    expect([...(await areaProperties())]).toEqual(['mowable', 'mow_around', 'priority']);
  });
});
