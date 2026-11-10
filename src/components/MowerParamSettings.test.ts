import {readFileSync} from 'node:fs';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// docker/params.cgi: the file as the container keeps it, only lines its filter takes. getFail: it can't be read
const cgi = vi.hoisted(() => ({file: '', posts: 0, fail: false, getFail: false}));
// what was set on the mower
const sets = vi.hoisted(() => [] as Record<string, number | boolean>[]);
const FILTER = new RegExp(readFileSync(new URL('../../docker/params.cgi', import.meta.url), 'utf8').match(/grep -E '([^']+)'/)![1]);
vi.mock('@/lib/mowers', async (real) => ({
  ...(await real<typeof import('@/lib/mowers')>()),
  apiBase: () => '',
  mowerFetch: async (_url: string, init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, 5));
    if (init?.method === 'POST') {
      cgi.posts++;
      if (cgi.fail) return new Response('', {status: 500});
      cgi.file = String(init.body)
        .split('\n')
        .filter((l) => FILTER.test(l))
        .map((l) => l + '\n')
        .join('');
    } else if (cgi.getFail) return new Response('', {status: 500});
    return new Response(cgi.file, {headers: {'content-type': 'text/plain'}});
  },
}));
// the mower takes it as a float, like OpenMower's node
vi.mock('@/lib/rpc', async (real) => ({
  ...(await real<typeof import('@/lib/rpc')>()),
  callRpc: async (_method: string, p: {params: Record<string, number | boolean>}) => {
    sets.push(p.params);
    return Object.fromEntries(Object.entries(p.params).map(([k, v]) => [k, typeof v === 'number' ? Math.fround(v) : v]));
  },
}));
vi.mock('@/lib/mowerOs', async (real) => ({...(await real<typeof import('@/lib/mowerOs')>()), systemInfo: async () => null}));

const load = async () => {
  vi.resetModules();
  return import('./MowerParamSettings');
};
const line = (key: string) => cgi.file.split('\n').find((l) => l.startsWith(`/mower_logic/${key} `));

describe('a setting of the mower kept by the container', () => {
  beforeEach(() => {
    cgi.file = 'enabled 1\n/mower_logic/docking_approach_distance 1\n';
    cgi.posts = 0;
    cgi.fail = false;
    cgi.getFail = false;
  });

  it("is kept also when the container wasn't asked before, so it doesn't set the older one again", async () => {
    const {setOpenMowerParam} = await load();
    await setOpenMowerParam('docking_approach_distance', 1.5);
    expect(line('docking_approach_distance')).toBe('/mower_logic/docking_approach_distance 1.5');
  });

  it('is left alone while keeping is off', async () => {
    cgi.file = 'enabled 0\n/mower_logic/docking_approach_distance 1\n';
    const {setOpenMowerParam} = await load();
    await setOpenMowerParam('docking_approach_distance', 1.5);
    expect(cgi.posts).toBe(0);
  });

  it('keeps two changes right after another both', async () => {
    const {setOpenMowerParam} = await load();
    await Promise.all([setOpenMowerParam('gps_timeout', 15), setOpenMowerParam('docking_retry_count', 6)]);
    expect([line('gps_timeout'), line('docking_retry_count'), line('docking_approach_distance')]).toEqual([
      '/mower_logic/gps_timeout 15',
      '/mower_logic/docking_retry_count 6',
      '/mower_logic/docking_approach_distance 1',
    ]);
  });

  it('keeps one after another that the container turned down', async () => {
    const {setOpenMowerParam} = await load();
    cgi.fail = true;
    const first = setOpenMowerParam('gps_timeout', 15);
    await expect(first).rejects.toThrow();
    cgi.fail = false;
    await setOpenMowerParam('docking_retry_count', 6);
    expect(line('gps_timeout')).toBeUndefined();
    expect(line('docking_retry_count')).toBe('/mower_logic/docking_retry_count 6');
  });

  it('keeps what the mower took as the value set, not its float', async () => {
    const {setOpenMowerParam} = await load();
    await setOpenMowerParam('tool_width', 0.18);
    expect(line('tool_width')).toBe('/mower_logic/tool_width 0.18');
  });

  it("isn't kept when the container's file can't be read, what another device took out stays out; it's set on the mower all the same", async () => {
    const {setOpenMowerParam} = await load();
    await setOpenMowerParam('gps_timeout', 15);
    // another device: docking_approach_distance no longer kept
    cgi.file = 'enabled 1\n/mower_logic/gps_timeout 15\n';
    cgi.getFail = true;
    const posts = cgi.posts;
    await expect(setOpenMowerParam('docking_retry_count', 6)).rejects.toThrow("Set on the mower, but MowBite couldn't keep it");
    expect(cgi.posts).toBe(posts);
    expect(cgi.file).toBe('enabled 1\n/mower_logic/gps_timeout 15\n');
    expect(sets.at(-1)).toEqual({'/mower_logic/docking_retry_count': 6});
  });
});

describe('keeping switched on again', () => {
  beforeEach(() => {
    cgi.file = 'enabled 0\n/mower_logic/gps_timeout 20\n/mower_logic/docking_approach_distance 1\n';
    cgi.fail = false;
    cgi.getFail = false;
  });

  it("keeps the values the mower has now, not the ones from before, and none it hasn't told", async () => {
    const {switchKeeping} = await load();
    await switchKeeping(true, {'/mower_logic/gps_timeout': 15, '/mower_logic/tool_width': 0.2});
    expect(cgi.file).toBe('enabled 1\n/mower_logic/gps_timeout 15\n');
  });

  it("keeps nothing from before while the mower's values haven't come", async () => {
    const {switchKeeping} = await load();
    await switchKeeping(true, {});
    expect(cgi.file).toBe('enabled 1\n');
  });

  it('switched off leaves the values as they were', async () => {
    const {switchKeeping} = await load();
    cgi.file = 'enabled 1\n/mower_logic/gps_timeout 20\n';
    await switchKeeping(false, {'/mower_logic/gps_timeout': 15});
    expect(cgi.file).toBe('enabled 0\n/mower_logic/gps_timeout 20\n');
  });
});

describe('the folded line of a group', () => {
  it("leaves out a value it doesn't know", async () => {
    const {summary} = await load();
    expect(summary('auto', {'/mower_logic/rain_mode': 4, '/mower_logic/automatic_mode': 0})).toBe('starts by hand');
    expect(summary('auto', {'/mower_logic/rain_mode': 1, '/mower_logic/automatic_mode': 7})).toBe('Go home');
    expect(summary('auto', {'/mower_logic/rain_mode': 1, '/mower_logic/automatic_mode': 2})).toBe('Go home · automatic');
  });
});
