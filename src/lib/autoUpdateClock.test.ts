import {describe, expect, it, vi} from 'vitest';

// the container's answer and the time it says it is
const net = vi.hoisted(() => ({now: null as number | null, status: {} as Record<string, string>}));
vi.mock('./updates', () => ({
  containerFetch: async () =>
    new Response(JSON.stringify({conf: {}, requested: false, status: net.status, log: []}), {
      headers: {'content-type': 'application/json', ...(net.now ? {'X-Now': String(net.now)} : {})},
    }),
}));

const {loadUpdate, mowerNow, selfInfo, updaterAlive} = await import('./autoUpdate');

describe("the updater's times by the mower's clock", () => {
  const phone = () => Date.now() / 1000;

  it("count with how far the container's clock is off", async () => {
    // this phone runs ten minutes ahead of the mower
    net.now = Math.round(phone() - 600);
    net.status = {alive: String(net.now - 30)};
    const s = (await loadUpdate())!;
    expect(s.skew).toBeCloseTo(-600, -1);
    expect(mowerNow(s)).toBeCloseTo(net.now, -1);
    expect(updaterAlive(s)).toBe(true);
    // restarting since a minute by the mower's clock
    expect(selfInfo({...s, status: {updater_running: 'abc 2026-11-01', updater: `restarting ${net.now - 60}`}})?.restarting).toBe(net.now - 60);
  });

  it("are this device's with a container that doesn't say", async () => {
    net.now = null;
    net.status = {alive: String(Math.round(phone() - 30))};
    const s = (await loadUpdate())!;
    expect(s.skew).toBe(0);
    expect(updaterAlive(s)).toBe(true);
  });
});
