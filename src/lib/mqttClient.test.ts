import {EventEmitter} from 'node:events';
import {afterEach, describe, expect, it, vi} from 'vitest';

describe('messages held while another page is drawn', () => {
  // stands in for the mqtt client (the demo's, so nothing connects)
  class FakeClient extends EventEmitter {
    connected = true;
    subscribe() {}
  }
  const load = async () => {
    vi.resetModules();
    const client = new FakeClient();
    vi.doMock('./demo/client', () => ({demoClient: () => client}));
    vi.doMock('./mowers', () => ({isDemo: () => true, selectedMower: () => null}));
    const m = await import('./mqttClient');
    const got: string[] = [];
    m.onTopic('state', (p) => got.push(p.toString()));
    m.onTopic('rpc/response', (p) => got.push(p.toString()));
    const send = (v: string, topic = 'state') => client.emit('message', topic, Buffer.from(v));
    return {m, got, send};
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('./demo/client');
    vi.doUnmock('./mowers');
  });

  it('hands them on in order once they are let go', async () => {
    const {m, got, send} = await load();
    send('1');
    m.holdMessages();
    send('2');
    send('3');
    expect(got).toEqual(['1']);
    m.passMessages();
    expect(got).toEqual(['1', '2', '3']);
    send('4');
    expect(got).toEqual(['1', '2', '3', '4']);
  });

  it('hands an rpc answer on at once', async () => {
    const {m, got, send} = await load();
    m.holdMessages();
    expect(m.messagesHeld()).toBe(true);
    send('1');
    send('answer', 'rpc/response');
    expect(got).toEqual(['answer']);
    m.passMessages();
    expect(m.messagesHeld()).toBe(false);
    expect(got).toEqual(['answer', '1']);
  });

  it('lets them go by itself after the time', async () => {
    vi.useFakeTimers();
    const {m, got, send} = await load();
    m.holdMessages(500);
    send('1');
    vi.advanceTimersByTime(499);
    expect(got).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(got).toEqual(['1']);
    // nothing held, nothing to let go
    m.passMessages();
    expect(got).toEqual(['1']);
  });
});

describe('MQTT 5 on MowBite OS', () => {
  // stands in for mqtt.js: the options it was made with, what a reconnect and a dropped socket do
  class FakeMqtt extends EventEmitter {
    connected = false;
    reconnects = 0;
    destroyed = 0;
    stream = {destroy: () => this.destroyed++, socket: null as EventTarget | null};
    constructor(public options: {protocolVersion?: number; clientId?: string}) {
      super();
      this.options.clientId = 'mqttjs_ab12';
    }
    subscribe() {}
    reconnect() {
      this.reconnects++;
    }
    // a new socket that opens or not (the network), the broker answers the CONNECT with a CONNACK or not at all
    async tryConnect(acked: boolean, opens = true) {
      const socket = Object.assign(new EventTarget(), {readyState: 0});
      this.stream.socket = socket;
      this.emit('reconnect');
      await Promise.resolve();
      if (!opens) return;
      socket.readyState = 1;
      socket.dispatchEvent(new Event('open'));
      if (acked) {
        this.connected = true;
        this.emit('connect');
      }
    }
    drop() {
      this.connected = false;
      this.emit('close');
    }
  }
  const stored = new Map<string, string>();
  const load = async () => {
    vi.resetModules();
    let made: FakeMqtt | null = null;
    vi.doMock('mqtt', () => ({default: {connect: (_url: string, o: {protocolVersion: number}) => (made = new FakeMqtt({...o}))}}));
    vi.doMock('./mowers', () => ({isDemo: () => false, selectedMower: () => null}));
    vi.stubGlobal('window', {location: {hostname: 'mower'}});
    vi.stubGlobal('document', {addEventListener() {}});
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => stored.set(k, v),
      removeItem: (k: string) => stored.delete(k),
    });
    const m = await import('./mqttClient');
    m.getMqttClient();
    return {m, c: made! as FakeMqtt};
  };

  afterEach(() => {
    vi.doUnmock('mqtt');
    vi.doUnmock('./mowers');
    vi.unstubAllGlobals();
  });

  it('connects with 3.1.1 until MowBite OS said mqtt 5, then from the next connection on, kept for that mower', async () => {
    stored.clear();
    let {m, c} = await load();
    expect(c.options.protocolVersion).toBe(4);
    await c.tryConnect(true);
    m.noteMqtt({mqtt: 5});
    // never under the running connection, mqtt.js reads it for every packet
    expect(c.options.protocolVersion).toBe(4);
    expect(m.mqtt5()).toBe(false);
    expect(c.reconnects + c.destroyed).toBe(0);
    c.drop();
    await c.tryConnect(true);
    expect(m.mqtt5()).toBe(true);
    expect(m.responseTopic()).toBe('rpc/response/mqttjs_ab12');
    // a page loaded later starts with it
    ({m, c} = await load());
    expect(c.options.protocolVersion).toBe(5);
    await c.tryConnect(true);
    // an older MowBite OS without mqtt in system.info: 3.1.1 from the next connection on
    m.noteMqtt({});
    expect(c.options.protocolVersion).toBe(5);
    c.drop();
    await c.tryConnect(true);
    expect(c.options.protocolVersion).toBe(4);
    expect(c.destroyed).toBe(0);
    expect(stored.size).toBe(0);
  });

  it('goes back to 3.1.1 at once on OpenMower', async () => {
    stored.clear();
    const {m, c} = await load();
    m.noteMqtt({mqtt: 5});
    c.drop();
    await c.tryConnect(true);
    expect(m.mqtt5()).toBe(true);
    m.noteMqtt('openmower');
    expect(c.destroyed).toBe(1);
    c.drop();
    await c.tryConnect(true);
    expect(c.options.protocolVersion).toBe(4);
    expect(stored.size).toBe(0);
  });

  it('goes back to 3.1.1 when the broker turns MQTT 5 down or closes twice after the CONNECT, not for the network', async () => {
    stored.clear();
    let {m, c} = await load();
    m.noteMqtt({mqtt: 5});
    // a CONNACK with an error: mqtt.js gives up, it's tried again with 3.1.1 once the socket is gone
    await c.tryConnect(false);
    c.emit('error', Object.assign(new Error('Connection refused: Unsupported protocol version'), {code: 132}));
    expect(c.reconnects).toBe(0);
    c.drop();
    expect(c.reconnects).toBe(1);
    await c.tryConnect(true);
    expect(c.options.protocolVersion).toBe(4);
    expect(stored.size).toBe(0);

    ({m, c} = await load());
    m.noteMqtt({mqtt: 5});
    // no network: the socket doesn't open, no CONNECT
    for (let i = 0; i < 3; i++) {
      await c.tryConnect(false, false);
      c.drop();
    }
    expect(c.options.protocolVersion).toBe(5);
    // closed after the CONNECT, once and again after one that worked: still 5
    await c.tryConnect(false);
    c.drop();
    await c.tryConnect(true);
    c.drop();
    await c.tryConnect(false);
    c.drop();
    expect(c.options.protocolVersion).toBe(5);
    await c.tryConnect(false);
    c.drop();
    await c.tryConnect(true);
    expect(c.options.protocolVersion).toBe(4);
    expect(stored.size).toBe(0);
  });
});
