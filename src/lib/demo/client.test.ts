import {afterEach, describe, expect, it, vi} from 'vitest';
import {ACTION, TOPIC} from '../openmower';
import {demoClient} from './client';

// the demo's connection once its mower is there, and whether each list of actions it hands out offers pause (only while
// it mows)
async function connected() {
  vi.useFakeTimers();
  const client = demoClient();
  await vi.dynamicImportSettled();
  const pause: boolean[] = [];
  const heard = (topic: string, payload: Buffer) => {
    if (topic !== TOPIC.actions) return;
    const list: {action_id: string; enabled: number}[] = JSON.parse(payload.toString());
    pause.push(!!list.find((a) => a.action_id === ACTION.pause)?.enabled);
  };
  client.on('message', heard);
  return {client, pause};
}

describe('the demo mower as a connection', () => {
  afterEach(() => vi.useRealTimers());

  it('hands out the actions as they are right after subscribing', async () => {
    const {client, pause} = await connected();
    expect(client.connected).toBe(true);
    client.subscribe(TOPIC.actions);
    expect(pause).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(pause).toEqual([true]);
  });

  it('hands out on subscribing what the mower says by then, not what it said when asked', async () => {
    const {client, pause} = await connected();
    client.subscribe(TOPIC.actions);
    // sent home before the answer to the subscription is out
    client.publish(TOPIC.action, ACTION.goHome);
    expect(pause).toEqual([false]);
    vi.advanceTimersByTime(1);
    expect(pause).toEqual([false, false]);
  });
});
