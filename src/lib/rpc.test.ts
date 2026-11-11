import {EventEmitter} from 'node:events';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {clock} from './dates';
import {isMissingMethod, RpcError, unavailable} from './rpc';
import {answerError, holdText, rpcErrorText} from './rpcText';

describe('isMissingMethod', () => {
  it('spots the json-rpc "method not found" error only', () => {
    expect(isMissingMethod(new RpcError('map.replace', -32601, 'Method not found'))).toBe(true);
    expect(isMissingMethod(new RpcError('map.replace', 'timeout', 'timed out'))).toBe(false);
    expect(isMissingMethod(new Error('Method not found'))).toBe(false);
  });

  it('says it without blaming one software, the planner or MowBite OS may be the one', () => {
    expect(rpcErrorText(new RpcError('planner.settings', -32601, 'Method not found'))).toBe("Your mower's software doesn't offer this (planner.settings).");
  });
});

describe('a part of MowBite OS gone for now', () => {
  afterEach(() => {
    vi.doUnmock('./mowerOs');
    vi.resetModules();
  });

  it('is said as that, in a settings card too, not as something the mower lacks', async () => {
    vi.resetModules();
    vi.doMock('./mowerOs', () => ({providerGone: (e: {listed?: boolean}) => !!e.listed}));
    const {RpcError} = await import('./rpc');
    const {answerError, rpcErrorText} = await import('./rpcText');
    const gone = Object.assign(new RpcError('planner.settings.set', -32601, 'The node that answers "planner.settings.set" is gone'), {listed: true});
    const text = "A part of MowBite OS isn't running right now (planner.settings.set). Try again in a moment.";
    expect(rpcErrorText(gone)).toBe(text);
    expect(answerError(gone)).toBe(text);
    expect(rpcErrorText(new RpcError('planner.settings.set', -32601, 'Method not found'))).toBe(
      "Your mower's software doesn't offer this (planner.settings.set).",
    );
  });
});

describe('an update holding MowBite OS', () => {
  it('says until when for a change it turned down, other errors as before', () => {
    const until = 1793754213;
    expect(holdText(new RpcError('params.set', -32004, 'held', {reason: 'HOLD', until}))).toBe(`Update running until ${clock(until)}.`);
    expect(holdText(new RpcError('docking.start', -32600, 'held', {reason: 'HOLD'}))).toBe('Update running.');
    expect(holdText(new RpcError('params.set', -32602, 'bad', {reason: 'OUT_OF_RANGE'}))).toBeNull();
    expect(rpcErrorText(new RpcError('map.replace', -32004, 'held', {reason: 'HOLD', until}))).toBe(`Update running until ${clock(until)}.`);
    expect(answerError(new RpcError('planner.settings.set', -32004, 'held', {reason: 'HOLD', until}))).toBe(`Update running until ${clock(until)}.`);
    expect(answerError(new RpcError('planner.settings.set', -32602, 'robot_width out of range'))).toBe('robot_width out of range');
    expect(answerError(new RpcError('planner.settings.set', 'timeout', 'timed out'))).toBe('The mower did not answer.');
    // a refusal with its event in the data, in that event's words
    const noFile = {event: 'SOUND_REFUSED', reason: 'NO_FILE', message: 'english text', severity: 'warning'};
    expect(answerError(new RpcError('sound.play', -32600, 'english text', noFile))).toBe('Sound not played: the mower has no sound for this situation');
  });
});

describe('unavailable', () => {
  const known = new Set(['map.replace', 'events.history']);

  it('stops calls the mower said it does not have', () => {
    expect(unavailable(known, 'position.history')).toBe(true);
    expect(unavailable(known, 'map.replace')).toBe(false);
  });

  it('never blocks when the mower could not tell, nor rpc.methods and meta.* calls', () => {
    expect(unavailable(null, 'position.history')).toBe(false);
    expect(unavailable(known, 'rpc.methods')).toBe(false);
    expect(unavailable(known, 'meta.config.schema')).toBe(false);
  });
});

describe('calls while offline', () => {
  // stands in for the mqtt client: what gets published is kept, a subscribe is confirmed right away
  class FakeClient extends EventEmitter {
    connected = false;
    v5 = false;
    published: {method: string; id: string; params?: unknown}[] = [];
    // the response topic each request asked for, null without one
    asked: (string | null)[] = [];
    publish(_topic: string, payload: string, opts?: {properties?: {responseTopic?: string}}) {
      this.published.push(JSON.parse(payload));
      this.asked.push(opts?.properties?.responseTopic ?? null);
    }
    subscribe(_topic: string, cb?: () => void) {
      cb?.();
    }
    online() {
      this.connected = true;
      this.emit('connect');
    }
    offline() {
      this.connected = false;
      this.emit('close');
    }
  }

  let client: FakeClient;
  // a fresh rpc module per test, it asks rpc.methods only once per page load
  const load = async () => {
    vi.resetModules();
    vi.doMock('./mqttClient', () => ({
      getMqttClient: () => client,
      withPrefix: (t: string) => t,
      mqtt5: () => client.v5,
      responseTopic: () => 'rpc/response/me',
      onTopic: (topic: string, h: (p: Buffer, t: string) => void) => {
        client.on('message', (t: string, p: Buffer) => t === topic && h(p, t));
        return () => {};
      },
    }));
    return import('./rpc');
  };

  beforeEach(() => {
    client = new FakeClient();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.doUnmock('./mqttClient');
    vi.useRealTimers();
  });

  it('waits for the connection, then sends and takes the answer', async () => {
    const {rpcMethods} = await load();
    const methods = rpcMethods();
    expect(client.published).toEqual([]);
    client.online();
    expect(client.published.map((m) => m.method)).toEqual(['rpc.methods']);
    client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[0].id, result: ['map.replace']})));
    expect(await methods).toEqual(new Set(['map.replace']));
  });

  it('asks for the method list again a while after it got no answer', async () => {
    const {rpcMethods} = await load();
    const first = rpcMethods();
    await vi.advanceTimersByTimeAsync(6000);
    expect(await first).toBeNull();
    client.online();
    // right after, the failed answer still counts
    expect(await rpcMethods()).toBeNull();
    expect(client.published).toEqual([]);
    await vi.advanceTimersByTimeAsync(15000);
    const again = rpcMethods();
    expect(client.published.map((m) => m.method)).toEqual(['rpc.methods']);
    client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[0].id, result: ['mowing.plan']})));
    expect(await again).toEqual(new Set(['mowing.plan']));
  });

  it('asks until the mower answered and tells only the sure answer', async () => {
    const {askUntilAnswered, rpcMethods} = await load();
    const got: (Set<string> | null)[] = [];
    const stop = askUntilAnswered(rpcMethods, (m) => got.push(m));
    await vi.advanceTimersByTimeAsync(6000);
    expect(got).toEqual([]);
    client.online();
    await vi.advanceTimersByTimeAsync(15000);
    expect(client.published.map((m) => m.method)).toEqual(['rpc.methods']);
    client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[0].id, result: ['params.set']})));
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual([new Set(['params.set'])]);
    stop();
  });

  it('keeps a "method not found" from an older mower, that one is final', async () => {
    const {rpcMethods} = await load();
    client.online();
    const first = rpcMethods();
    client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[0].id, error: {code: -32601, message: 'Method not found'}})));
    expect(await first).toBeNull();
    await vi.advanceTimersByTimeAsync(60000);
    await rpcMethods();
    expect(client.published).toHaveLength(1);
  });

  it('notes "method not found" for a method the list names and asks the list again, a command too', async () => {
    const {callCommand, callRpc} = await load();
    client.online();
    const answer = (n: number, a: object) => client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[n].id, ...a})));
    const gone = {error: {code: -32601, message: 'The node that answers it is gone'}};
    const plan = callRpc('planner.plan', {});
    answer(0, {result: ['planner.plan', 'mowing.start']});
    await vi.advanceTimersByTimeAsync(0);
    answer(1, gone);
    await expect(plan).rejects.toMatchObject({code: -32601, listed: true});
    expect(client.published.map((m) => m.method)).toEqual(['rpc.methods', 'planner.plan', 'rpc.methods']);
    const start = callCommand('mowing.start', {}, 10000);
    answer(3, gone);
    await expect(start).rejects.toMatchObject({code: -32601, listed: true});
    // the new list doesn't have it any more: stopped here like any method the mower doesn't list
    answer(2, {result: ['mowing.start']});
    await vi.advanceTimersByTimeAsync(0);
    await expect(callRpc('planner.plan', {})).rejects.toMatchObject({code: -32601, listed: false});
    expect(client.published).toHaveLength(4);
  });

  it('reads the list again on each METHODS_CHANGED and tells the last answer, the list counts and not what the event names', async () => {
    const {knownMethods, onMethodsChanged, rpcMethods} = await load();
    client.online();
    const answer = (n: number, a: object) => client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[n].id, ...a})));
    const event = (e: object) => client.emit('message', 'events/json', Buffer.from(JSON.stringify(e)));
    const heard: (Set<string> | null)[] = [];
    onMethodsChanged((m) => heard.push(m));
    const first = rpcMethods();
    answer(0, {result: ['map.replace']});
    await first;
    // another event that only has the word in it
    event({type: 'UPDATE', message: 'METHODS_CHANGED'});
    expect(client.published).toHaveLength(1);
    // MowBite OS starting: its planner and its cameras come up seconds apart
    event({type: 'METHODS_CHANGED', added: ['planner.plan'], removed: []});
    event({type: 'METHODS_CHANGED', added: ['camera.list', 'camera.stream'], removed: []});
    expect(client.published.map((m) => m.method)).toEqual(['rpc.methods', 'rpc.methods', 'rpc.methods']);
    answer(1, {result: ['map.replace', 'planner.plan']});
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toEqual([]);
    answer(2, {result: ['map.replace', 'planner.plan', 'camera.list']});
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toEqual([new Set(['map.replace', 'planner.plan', 'camera.list'])]);
    expect(knownMethods()).toEqual(heard[0]);
  });

  it('reads the list again once the connection is back, not when it first comes', async () => {
    const {onMethodsChanged, rpcMethods} = await load();
    const answer = (n: number, a: object) => client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[n].id, ...a})));
    const heard: (Set<string> | null)[] = [];
    onMethodsChanged((m) => heard.push(m));
    client.online();
    expect(client.published).toEqual([]);
    const first = rpcMethods();
    answer(0, {result: ['map.replace', 'camera.list']});
    await first;
    client.offline();
    client.online();
    expect(client.published.map((m) => m.method)).toEqual(['rpc.methods', 'rpc.methods']);
    answer(1, {result: ['map.replace']});
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toEqual([new Set(['map.replace'])]);
  });

  it("doesn't ask the list at every such answer of a mower that goes on listing the method", async () => {
    const {callRpc} = await load();
    client.online();
    const answer = (n: number, a: object) => client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[n].id, ...a})));
    const gone = {error: {code: -32601, message: 'The node that answers it is gone'}};
    const methods = () => client.published.map((m) => m.method);
    const first = callRpc('camera.list');
    answer(0, {result: ['camera.list']});
    await vi.advanceTimersByTimeAsync(0);
    answer(1, gone);
    await expect(first).rejects.toMatchObject({listed: true});
    expect(methods()).toEqual(['rpc.methods', 'camera.list', 'rpc.methods']);
    answer(2, {result: ['camera.list']});
    await vi.advanceTimersByTimeAsync(0);
    const second = callRpc('camera.list');
    await vi.advanceTimersByTimeAsync(0);
    answer(3, gone);
    await expect(second).rejects.toMatchObject({listed: true});
    expect(methods()).toEqual(['rpc.methods', 'camera.list', 'rpc.methods', 'camera.list']);
    await vi.advanceTimersByTimeAsync(5000);
    const third = callRpc('camera.list');
    await vi.advanceTimersByTimeAsync(0);
    answer(4, gone);
    await expect(third).rejects.toMatchObject({listed: true});
    expect(methods()).toEqual(['rpc.methods', 'camera.list', 'rpc.methods', 'camera.list', 'camera.list', 'rpc.methods']);
  });

  it('takes "method not found" from a mower without a list as it comes', async () => {
    const {callRpc} = await load();
    client.online();
    const answer = (n: number, a: object) => client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[n].id, ...a})));
    const saved = callRpc('map.replace', [{}]);
    answer(0, {error: {code: -32601, message: 'Method not found'}});
    await vi.advanceTimersByTimeAsync(0);
    answer(1, {error: {code: -32601, message: 'Method not found'}});
    await expect(saved).rejects.toMatchObject({code: -32601, listed: false});
    expect(client.published).toHaveLength(2);
  });

  it('keeps what the mower adds to its error', async () => {
    const {callRpc} = await load();
    client.online();
    const answer = (n: number, a: object) => client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[n].id, ...a})));
    const held = callRpc('params.set', {params: {}});
    answer(0, {result: ['params.set', 'map.replace']});
    await vi.advanceTimersByTimeAsync(0);
    answer(1, {error: {code: -32004, message: 'held', data: {reason: 'HOLD', until: 1793754213}}});
    await expect(held).rejects.toMatchObject({code: -32004, data: {reason: 'HOLD', until: 1793754213}});
    const odd = callRpc('map.replace', [{}]);
    await vi.advanceTimersByTimeAsync(0);
    answer(2, {error: {code: -32602, message: 'bad', data: 'just text'}});
    await expect(odd).rejects.toMatchObject({code: -32602, data: undefined});
  });

  it('sends a map save again when the connection dropped before its answer, once, other calls not', async () => {
    const {callRpc} = await load();
    client.online();
    const answer = (n: number, a: object) => client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[n].id, ...a})));
    const saved = callRpc('map.replace', [{}], 60000);
    answer(0, {result: ['map.replace', 'planner.plan']});
    await vi.advanceTimersByTimeAsync(0);
    const plan = callRpc('planner.plan', [{}], 60000);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.published.map((m) => m.method)).toEqual(['rpc.methods', 'map.replace', 'planner.plan']);
    // gone the same second, two tries to connect fail before one gets through
    client.offline();
    client.emit('close');
    client.emit('close');
    client.online();
    expect(client.published.map((m) => m.method)).toEqual(['rpc.methods', 'map.replace', 'planner.plan', 'map.replace']);
    expect(client.published[3].id).toBe(client.published[1].id);
    answer(3, {result: 'saved'});
    expect(await saved).toBe('saved');
    // answered, a drop later on sends nothing more
    client.offline();
    client.online();
    expect(client.published).toHaveLength(4);
    answer(2, {result: 'plan'});
    expect(await plan).toBe('plan');
  });

  it("doesn't send a save again that timed out while the connection was gone", async () => {
    const {callRpc} = await load();
    client.online();
    const saved = callRpc('map.replace', [{}], 60000);
    client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[0].id, result: ['map.replace']})));
    await vi.advanceTimersByTimeAsync(0);
    client.offline();
    const failed = expect(saved).rejects.toMatchObject({code: 'timeout'});
    await vi.advanceTimersByTimeAsync(60000);
    await failed;
    client.online();
    expect(client.published.map((m) => m.method)).toEqual(['rpc.methods', 'map.replace']);
  });

  it('never sends a call that timed out before the connection came back', async () => {
    const {rpcMethods} = await load();
    const methods = rpcMethods();
    await vi.advanceTimersByTimeAsync(6000);
    expect(await methods).toBeNull();
    client.online();
    expect(client.published).toEqual([]);
  });

  it("doesn't take the answer to another phone's or tab's call as its own", async () => {
    const {rpcMethods} = await load();
    client.online();
    const methods = rpcMethods();
    const id = client.published[0].id;
    // another copy of the app, counting the same: only its own name differs
    client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: `other-${id.split('-').pop()}`, result: ['nothing']})));
    client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: '1', result: ['nothing']})));
    client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id, result: ['map.replace']})));
    expect(await methods).toEqual(new Set(['map.replace']));
    // and a fresh copy has another name
    const other = await load();
    void other.rpcMethods();
    expect(client.published[1].id.split('-')[0]).not.toBe(id.split('-')[0]);
  });

  it('sends a command only while connected, never again by itself, and still takes an answer that came late', async () => {
    const {callCommand, LATE_MS} = await load();
    await expect(callCommand('mowing.start', {client: 'app'}, 10000)).rejects.toMatchObject({code: 'timeout', message: 'offline'});
    client.online();
    expect(client.published).toEqual([]);
    const late: unknown[] = [];
    const start = callCommand('mowing.start', {client: 'app'}, 10000, (a) => late.push(a));
    const failed = expect(start).rejects.toMatchObject({code: 'timeout'});
    expect(client.published.map((m) => [m.method, m.params])).toEqual([['mowing.start', {client: 'app'}]]);
    client.offline();
    client.online();
    await vi.advanceTimersByTimeAsync(10000);
    await failed;
    expect(client.published).toHaveLength(1);
    client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[0].id, result: {state: 'UNDOCKING'}})));
    expect(late).toEqual([{state: 'UNDOCKING'}]);
    // a refusal late as well, a minute after its time no more
    const pause = callCommand('mowing.pause', {}, 10000, (a) => late.push(a));
    pause.catch(() => {});
    const skip = callCommand('mowing.skip_area', {}, 10000, (a) => late.push(a));
    skip.catch(() => {});
    await vi.advanceTimersByTimeAsync(10000);
    const refusal = {error: {code: -32600, message: 'refused', data: {event: 'COMMAND_REFUSED', reason: 'WRONG_STATE'}}};
    client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[1].id, ...refusal})));
    expect(late[1]).toMatchObject({code: -32600, data: {reason: 'WRONG_STATE'}});
    await vi.advanceTimersByTimeAsync(LATE_MS);
    client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[2].id, result: {}})));
    expect(late).toHaveLength(2);
  });

  it('with MQTT 5 asks for the answer on its own topic and takes it there, before on rpc/response', async () => {
    const {callRpc, rpcMethods} = await load();
    client.online();
    const methods = rpcMethods();
    expect(client.asked).toEqual([null]);
    client.emit('message', 'rpc/response', Buffer.from(JSON.stringify({id: client.published[0].id, result: ['map.replace']})));
    await methods;
    // made while offline, sent once connected again with MQTT 5
    client.offline();
    const saved = callRpc('map.replace', [{}]);
    await vi.advanceTimersByTimeAsync(0);
    client.v5 = true;
    client.online();
    expect(client.asked).toEqual([null, 'rpc/response/me']);
    client.emit('message', 'rpc/response/me', Buffer.from(JSON.stringify({id: client.published[1].id, result: 'saved'})));
    expect(await saved).toBe('saved');
  });
});
