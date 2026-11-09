import {beforeEach, describe, expect, it, vi} from 'vitest';
import {RpcError} from '@/lib/rpc';

const mower = vi.hoisted(() => ({
  methods: undefined as Set<string> | null | undefined,
  actions: [] as string[],
  calls: [] as {method: string; params: object; late?: (a: unknown) => void}[],
  answer: (() => Promise.resolve({})) as () => Promise<unknown>,
}));
vi.mock('@/lib/rpc', async (orig) => ({
  ...(await orig<typeof import('@/lib/rpc')>()),
  knownMethods: () => mower.methods,
  callCommand: (method: string, params: object, _ms: number, late?: (a: unknown) => void) => {
    mower.calls.push({method, params, late});
    return mower.answer();
  },
}));
vi.mock('@/lib/mqttClient', () => ({
  getMqttClient: () => ({publish: (_t: string, id: string) => mower.actions.push(id)}),
  withPrefix: (t: string) => t,
  topicStore: () => ({subscribe: () => () => {}, get: () => ({}), initial: () => ({})}),
}));

const {sendCommand, commandNote} = await import('./useMowerActions');
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('a command to the mower', () => {
  beforeEach(() => {
    mower.actions = [];
    mower.calls = [];
    mower.answer = () => Promise.resolve({state: 'MOWING', sub_state: ''});
  });

  it('goes out as the action on OpenMower, before rpc.methods came, and for a call the mower does not name', () => {
    mower.methods = undefined;
    sendCommand('mower_logic:idle/start_mowing');
    mower.methods = null;
    sendCommand('mower_logic:mowing/pause');
    mower.methods = new Set(['mowing.plan', 'mowing.pause']);
    sendCommand('mower_logic:idle/start_mowing');
    // one without a call at all
    sendCommand('mower_logic:area_recording/start_manual_mowing');
    expect(mower.actions).toEqual([
      'mower_logic:idle/start_mowing',
      'mower_logic:mowing/pause',
      'mower_logic:idle/start_mowing',
      'mower_logic:area_recording/start_manual_mowing',
    ]);
    expect(mower.calls).toEqual([]);
  });

  it('goes out as its call where MowBite OS names it, with client app and what it needs', () => {
    mower.methods = new Set(['mowing.start', 'mowing.skip_area', 'mowing.skip_path', 'recording.save', 'recording.auto_points']);
    sendCommand('mower_logic:idle/start_mowing');
    sendCommand('mower_logic:mowing/skip_area', {area: 2, path: 5});
    sendCommand('mower_logic:mowing/skip_path', {area: 2, path: 5});
    sendCommand('mower_logic:area_recording/finish_navigation_area');
    sendCommand('mower_logic:area_recording/auto_point_collecting_disable');
    expect(mower.actions).toEqual([]);
    expect(mower.calls.map((c) => [c.method, c.params])).toEqual([
      ['mowing.start', {client: 'app'}],
      ['mowing.skip_area', {client: 'app', area: 2}],
      ['mowing.skip_path', {client: 'app', path: 5}],
      ['recording.save', {client: 'app', type: 'nav'}],
      ['recording.auto_points', {client: 'app', enabled: false}],
    ]);
  });

  it('says why it was turned down, with the event it also went out as', async () => {
    mower.methods = new Set(['mowing.start', 'mowing.pause', 'mowing.reset_job']);
    mower.answer = () =>
      Promise.reject(
        new RpcError('mowing.start', -32600, 'held', {event: 'MOWING_REFUSED', reason: 'HOLD', severity: 'info', resume: 'user', event_id: 'e7'}),
      );
    sendCommand('mower_logic:idle/start_mowing');
    await settle();
    expect(commandNote()).toMatchObject({text: 'Mowing not started: update running', warn: false, event: 'MOWING_REFUSED', eventId: 'e7'});
    mower.answer = () =>
      Promise.reject(
        new RpcError('mowing.pause', -32600, 'wrong state', {event: 'COMMAND_REFUSED', reason: 'WRONG_STATE', severity: 'info', state: 'IDLE'}),
      );
    sendCommand('mower_logic:mowing/pause');
    await settle();
    expect(commandNote()).toMatchObject({text: "Not done: doesn't fit what the mower is doing now", eventId: undefined});
    mower.answer = () => Promise.reject(new RpcError('mowing.reset_job', 'timeout', 'mowing.reset_job timed out'));
    sendCommand('mower_logic:idle/reset_job');
    await settle();
    expect(commandNote()).toMatchObject({text: "The mower didn't answer (yet).", warn: true});
    // the answer a while after
    mower.calls[2].late?.({state: 'IDLE', sub_state: '', job_id: ''});
    expect(commandNote()?.text).toBe('The mower answered late: done after all.');
    mower.calls[2].late?.(new RpcError('mowing.reset_job', -32600, 'no job', {event: 'COMMAND_REFUSED', reason: 'NO_JOB', severity: 'info'}));
    expect(commandNote()?.text).toBe('Not done: there is no interrupted job');
    // a newer command sent meanwhile: the earlier one's late answer doesn't speak for it
    mower.answer = () => Promise.resolve({state: 'DOCKING', sub_state: ''});
    sendCommand('mower_logic:mowing/pause');
    await settle();
    mower.calls[2].late?.({state: 'IDLE', sub_state: '', job_id: ''});
    expect(commandNote()).toBeNull();
  });
});
