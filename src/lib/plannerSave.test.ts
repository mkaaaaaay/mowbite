import {EventEmitter} from 'node:events';
import {describe, expect, it, vi} from 'vitest';

// a connection that drops, and a planner that never answers
const client = Object.assign(new EventEmitter(), {connected: true});
const asked: string[] = [];
vi.mock('./mqttClient', async (orig) => ({...(await orig<typeof import('./mqttClient')>()), getMqttClient: () => client}));
vi.mock('./rpc', async (orig) => ({
  ...(await orig<typeof import('./rpc')>()),
  callRpc: (method: string) => {
    asked.push(method);
    return new Promise(() => {});
  },
  rpcMethods: () => Promise.resolve(new Set<string>()),
  knownMethods: () => undefined,
  onMethodsChanged: () => () => {},
}));

const {savePlannerSettings} = await import('./mowerBody');

describe("the planner's settings saved", () => {
  it("aren't taken as set once the connection drops before the answer, and are read again when it's back", async () => {
    const saving = savePlannerSettings({body_fit: true});
    client.emit('close');
    await expect(saving).rejects.toMatchObject({code: 'lost'});
    expect(asked).toEqual(['planner.settings.set']);
    client.emit('connect');
    expect(asked).toEqual(['planner.settings.set', 'planner.settings']);
  });
});
