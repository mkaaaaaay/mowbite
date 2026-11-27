import {beforeEach, describe, expect, it, vi} from 'vitest';
import {RpcError} from '@/lib/rpc';

const mower = vi.hoisted(() => ({
  methods: undefined as Set<string> | null | undefined,
  actions: [] as string[],
  connected: true,
  stale: false,
  misfit: null as string | null,
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
  getMqttClient: () => ({connected: mower.connected, publish: (_t: string, id: string) => mower.actions.push(id)}),
  withPrefix: (t: string) => t,
  topicStore: () => ({subscribe: () => () => {}, get: () => ({}), initial: () => ({})}),
}));

vi.mock('./useMowerState', () => ({liveNow: () => mower.connected && !mower.stale}));
const os = vi.hoisted(() => ({info: undefined as {name: string; api?: number} | undefined}));
vi.mock('@/lib/mowerOs', async (orig) => ({...(await orig<typeof import('@/lib/mowerOs')>()), knownSystemInfo: () => os.info}));
vi.mock('@/lib/osUpdate', () => ({runningMisfit: () => mower.misfit}));

const {sendCall, sendCommand, commandNote, heldUntil, lockedAfter, setsOff} = await import('./useMowerActions');
const {MOWBITE_OS, omActionId, ownActionId} = await import('@/lib/openmower');
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('a command to the mower', () => {
  beforeEach(() => {
    mower.actions = [];
    mower.calls = [];
    mower.connected = true;
    mower.stale = false;
    mower.misfit = null;
    mower.answer = () => Promise.resolve({state: 'MOWING', sub_state: ''});
    os.info = undefined;
  });

  it("goes out by MowBite OS's own id from api 70 on, one without an own id as it is", () => {
    mower.methods = null;
    os.info = {name: MOWBITE_OS, api: 69};
    sendCommand('mower_logic:idle/start_mowing');
    os.info = {name: MOWBITE_OS, api: 70};
    sendCommand('mower_logic:idle/start_mowing');
    sendCommand('mower_logic/reset_emergency');
    sendCommand('mower_logic:area_recording/finish_navigation_area');
    sendCommand('mower_logic:area_recording/auto_point_collecting_disable');
    sendCommand('mower_logic:area_recording/start_manual_mowing');
    os.info = {name: 'OpenMower', api: 70};
    sendCommand('mower_logic:mowing/pause');
    expect(mower.actions).toEqual([
      'mower_logic:idle/start_mowing',
      'mowing.start',
      'emergency.reset',
      'recording.save:nav',
      'recording.auto_points:off',
      'mower_logic:area_recording/start_manual_mowing',
      'mower_logic:mowing/pause',
    ]);
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
    // a continue turned down in the rain
    mower.methods.add('mowing.continue');
    mower.answer = () =>
      Promise.reject(new RpcError('mowing.continue', -32600, 'rain', {event: 'MOWING_REFUSED', reason: 'RAIN', severity: 'info', resume: 'user'}));
    sendCommand('mower_logic:mowing/continue');
    await settle();
    expect(commandNote()).toMatchObject({text: 'Not continued: rain', event: 'MOWING_REFUSED'});
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
    mower.calls[3].late?.({state: 'IDLE', sub_state: '', job_id: ''});
    expect(commandNote()?.text).toBe('The mower answered late: done after all.');
    mower.calls[3].late?.(new RpcError('mowing.reset_job', -32600, 'no job', {event: 'COMMAND_REFUSED', reason: 'NO_JOB', severity: 'info'}));
    expect(commandNote()?.text).toBe('Not done: there is no interrupted job');
    // a newer command sent meanwhile: the earlier one's late answer doesn't speak for it
    mower.answer = () => Promise.resolve({state: 'DOCKING', sub_state: ''});
    sendCommand('mower_logic:mowing/pause');
    await settle();
    mower.calls[3].late?.({state: 'IDLE', sub_state: '', job_id: ''});
    expect(commandNote()).toBeNull();
  });

  it('as the action takes the last answer away, and says when there is no connection', async () => {
    mower.methods = new Set(['mowing.pause']);
    mower.answer = () =>
      Promise.reject(new RpcError('mowing.pause', -32600, 'wrong state', {event: 'COMMAND_REFUSED', reason: 'WRONG_STATE', severity: 'info'}));
    sendCommand('mower_logic:mowing/pause');
    await settle();
    expect(commandNote()).not.toBeNull();
    sendCommand('mower_logic:area_recording/start_manual_mowing');
    expect(commandNote()).toBeNull();
    mower.connected = false;
    sendCommand('mower_logic:area_recording/start_manual_mowing');
    expect(commandNote()).toMatchObject({text: 'Not sent, no connection to the mower.', warn: true});
  });

  it('sends nothing that sets the mower or its blade off or lets go of the emergency stop without a current state', () => {
    const setOff = [
      'mower_logic:idle/start_mowing',
      'mower_logic:mowing/continue',
      'mower_logic:idle/start_area_recording',
      'mower_logic/reset_emergency',
      'mower_logic:area_recording/start_manual_mowing',
    ];
    const stops = ['mower_logic:mowing/pause', 'mower_logic:mowing/abort_mowing', 'mower_logic:area_recording/stop_manual_mowing'];
    mower.stale = true;
    for (const methods of [null, new Set(['mowing.start', 'mowing.continue', 'recording.start', 'emergency.reset', 'mowing.pause', 'mowing.abort'])]) {
      mower.methods = methods;
      mower.actions = [];
      mower.calls = [];
      for (const id of setOff) {
        sendCommand(id);
        expect(commandNote()).toMatchObject({text: "Not sent, the mower hasn't reported for a while.", warn: true});
      }
      sendCall('docking.test', {runs: 3});
      expect(mower.actions).toEqual([]);
      expect(mower.calls).toEqual([]);
      for (const id of stops) sendCommand(id);
      expect(mower.actions.length + mower.calls.length).toBe(stops.length);
    }
    mower.stale = false;
    sendCall('docking.test');
    expect(mower.calls.map((c) => c.method)).toContain('docking.test');
  });
  it('sends a mower idle off its station home only with a current state, and says why it stays', async () => {
    mower.methods = new Set(['docking.start', 'docking.abort']);
    mower.stale = true;
    sendCall('docking.start');
    expect(mower.calls).toEqual([]);
    expect(commandNote()).toMatchObject({text: "Not sent, the mower hasn't reported for a while.", warn: true});
    // stopping on the way goes all the same
    sendCommand('mower_logic:docking/abort_docking');
    expect(mower.calls.map((c) => c.method)).toEqual(['docking.abort']);
    mower.stale = false;
    mower.answer = () =>
      Promise.reject(new RpcError('docking.start', -32600, 'no dock', {event: 'DRIVE_REFUSED', reason: 'NO_DOCK', severity: 'warning', event_id: 'e9'}));
    sendCall('docking.start');
    await settle();
    expect(mower.calls[1]).toMatchObject({method: 'docking.start', params: {client: 'app'}});
    expect(commandNote()).toMatchObject({text: 'Not heading home: no docking station on the map', warn: true, event: 'DRIVE_REFUSED', eventId: 'e9'});
  });
  it('sends nothing that sets the mower off to a MowBite OS whose interface this app does not speak, stopping still goes', () => {
    mower.methods = new Set(['mowing.start', 'mowing.pause', 'emergency.reset']);
    mower.misfit = 'APP_API_BREAK';
    sendCommand('mower_logic:idle/start_mowing');
    sendCommand('mower_logic/reset_emergency');
    expect(mower.calls).toEqual([]);
    expect(commandNote()?.text).toMatch(/^Not sent\. This version of the app was built for another break of the interface/);
    sendCommand('mower_logic:mowing/pause');
    expect(mower.calls.map((c) => c.method)).toEqual(['mowing.pause']);
  });
});

describe('a tap on a command button', () => {
  const start = 'mower_logic:idle/start_mowing';
  const pause = 'mower_logic:mowing/pause';
  const resume = 'mower_logic:mowing/continue';
  const home = 'mower_logic:mowing/abort_mowing';
  const abortUndocking = 'mower_logic:undocking/abort_undocking';
  const record = 'mower_logic:idle/start_area_recording';

  it('holds back the same button and what sets the mower off', () => {
    for (const tapped of [start, pause, resume, home, abortUndocking]) {
      expect(lockedAfter(tapped, tapped)).toBe(true);
      expect(lockedAfter(tapped, start)).toBe(true);
      expect(lockedAfter(tapped, resume)).toBe(true);
      expect(lockedAfter(tapped, record)).toBe(true);
      expect(lockedAfter(tapped, 'docking.start')).toBe(true);
    }
  });

  it('never holds back stopping, pausing or going home after a tap on another one', () => {
    for (const [tapped, id] of [
      [start, pause],
      [start, home],
      [start, abortUndocking],
      [home, abortUndocking],
      [abortUndocking, home],
      [pause, home],
      [resume, home],
    ])
      expect(lockedAfter(tapped, id)).toBe(false);
  });

  it('holds back pause and continue for each other, they swap under the finger', () => {
    expect(lockedAfter(pause, resume)).toBe(true);
    expect(lockedAfter(resume, pause)).toBe(true);
  });

  // (held back for a moment after an emergency reset too: they take the reset button's place)
  it('knows what sets the mower off: starting, continuing and recording mode, nothing that stops it', () => {
    for (const id of [start, resume, record, 'docking.start']) expect(setsOff(id)).toBe(true);
    for (const id of [pause, home, abortUndocking, 'mower_logic/reset_emergency', 'mower_logic:mowing/skip_area']) expect(setsOff(id)).toBe(false);
  });
});

describe('the lock after a tap', () => {
  it('holds a moment after the tap, and again once the buttons change shortly after it', () => {
    expect(heldUntil(1000, 0)).toBe(2000);
    // pause tapped, continue shows up under the finger 1.2 s later: held another second from then
    expect(heldUntil(1000, 2200)).toBe(3200);
    // a change long after the tap didn't come of it
    expect(heldUntil(1000, 20000)).toBe(2000);
  });
});

describe("MowBite OS's own ids of the actions", () => {
  it('are read back as OpenMower\'s, whichever the bridge speaks', () => {
    for (const id of ['mower_logic:idle/start_mowing', 'mower_logic/reset_emergency', 'mower_logic:area_recording/finish_mowing_area'])
      expect(omActionId(ownActionId(id))).toBe(id);
    expect(ownActionId('mower_logic:area_recording/finish_mowing_area')).toBe('recording.save:mow');
    expect(omActionId('recording.auto_points:on')).toBe('mower_logic:area_recording/auto_point_collecting_enable');
    expect(omActionId('mower_logic:mowing/pause')).toBe('mower_logic:mowing/pause');
    expect(omActionId('something.new')).toBe('something.new');
  });
});
