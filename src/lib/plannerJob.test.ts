import {EventEmitter} from 'node:events';
import {describe, expect, it, vi} from 'vitest';

// the planner's answer to the next call: a value, failed or none at all
let answer: Record<string, unknown> | 'fails' | 'never' = {};
const client = Object.assign(new EventEmitter(), {connected: true});
vi.mock('./mqttClient', async (orig) => ({...(await orig<typeof import('./mqttClient')>()), getMqttClient: () => client}));
vi.mock('./rpc', async (orig) => ({
  ...(await orig<typeof import('./rpc')>()),
  callRpc: () => (answer === 'never' ? new Promise(() => {}) : answer === 'fails' ? Promise.reject(new Error('no answer')) : Promise.resolve(answer)),
  rpcMethods: () => Promise.resolve(new Set<string>()),
  knownMethods: () => undefined,
  onMethodsChanged: () => () => {},
}));

const {jobOpen, jobOpenNow, resetPlannerAngle, savePlannerSettings} = await import('./mowerBody');

describe("a mow's plans held by the planner", () => {
  it('ask before a save only while the last answer says job_open', async () => {
    expect(jobOpen()).toBe(false);
    answer = {settings: {}, job_open: true};
    await savePlannerSettings({body_fit: true});
    expect(jobOpen()).toBe(true);
    answer = {settings: {}, job_open: false};
    await resetPlannerAngle();
    expect(jobOpen()).toBe(false);
  });

  it("aren't asked about with an older planner that doesn't say", async () => {
    answer = {settings: {}, job_open: true};
    await savePlannerSettings({body_fit: true});
    answer = {settings: {}};
    await savePlannerSettings({body_fit: false});
    expect(jobOpen()).toBe(false);
  });

  it('are read anew before asking', async () => {
    answer = {settings: {}, job_open: false};
    await savePlannerSettings({body_fit: true});
    answer = {settings: {}, job_open: true};
    expect(await jobOpenNow()).toBe(true);
    answer = {settings: {}, job_open: false};
    expect(await jobOpenNow()).toBe(false);
  });

  it("doesn't ask with an older planner whose read fails", async () => {
    answer = {settings: {}};
    await savePlannerSettings({body_fit: true});
    answer = 'fails';
    expect(await jobOpenNow()).toBe(false);
  });

  it('asks when the read fails or takes too long and the planner says job_open at all', async () => {
    answer = {settings: {}, job_open: false};
    await savePlannerSettings({body_fit: true});
    answer = 'fails';
    expect(await jobOpenNow()).toBe(true);
    vi.useFakeTimers();
    try {
      answer = 'never';
      const open = jobOpenNow();
      await vi.advanceTimersByTimeAsync(5000);
      expect(await open).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
