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
