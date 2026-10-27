import {afterEach, describe, expect, it, vi} from 'vitest';

const net = vi.hoisted(() => ({
  up: false,
  theirs: {mapStyle: 'plain', weather: true} as Record<string, unknown>,
  posted: [] as unknown[],
}));
vi.mock('./mowers', () => ({
  apiBase: () => '',
  isDemo: () => false,
  mowerFetch: async (_: string, init?: RequestInit) => {
    if (!net.up) throw new TypeError('Failed to fetch');
    if (init?.method === 'POST') {
      net.posted.push(JSON.parse(String(init.body)));
      return new Response('', {status: 200, headers: {'X-Settings-Version': '2'}});
    }
    return new Response(JSON.stringify(net.theirs), {headers: {'content-type': 'application/json', 'X-Settings-Version': '1'}});
  },
}));
vi.mock('./native', () => ({isApp: () => false}));
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => kept.set(k, v)});
vi.stubGlobal('document', {documentElement: {style: {setProperty: () => {}}}});

const {saveSettings, settingsStore, sharedSettings, syncSettings} = await import('./settings');

afterEach(() => vi.useRealTimers());

describe('settings with the mower out of reach at the start', () => {
  it('asks again later and puts what was changed meanwhile on top of the mower\'s', async () => {
    vi.useFakeTimers();
    await syncSettings();
    expect(sharedSettings()).toBe(false);
    saveSettings({...settingsStore.snapshot(), mapStyle: 'garden'});
    net.up = true;
    await vi.advanceTimersByTimeAsync(31000);
    expect(sharedSettings()).toBe(true);
    expect(settingsStore.snapshot()).toMatchObject({mapStyle: 'garden', weather: true});
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.posted.at(-1)).toMatchObject({mapStyle: 'garden', weather: true});
  });
});
