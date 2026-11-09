import {afterEach, describe, expect, it, vi} from 'vitest';

// the page comes from mower a with its container, t is in the list without one (nothing answers there)
const net = vi.hoisted(() => ({
  selected: '',
  app: false,
  // t: nothing listens there, or a web server without MowBite
  t: 'down' as 'down' | 'other',
  tAsked: 0,
  a: {colors: {mower: '#111111'}, mowers: [{id: 't', name: 'Tron', host: 't'}], icons: {mower: 'punisher'}} as Record<string, unknown>,
  posted: [] as Record<string, unknown>[],
}));
vi.mock('./mowers', () => ({
  apiBase: () => (net.selected && !net.app ? 'http://t:8082' : ''),
  isDemo: () => false,
  readStored: (k: string) => JSON.parse(localStorage.getItem(k) ?? 'null'),
  leaveRemoved: () => {},
  selectedMowerId: () => net.selected,
  selectedMower: () => (net.selected ? {id: net.selected, name: net.selected, host: net.selected} : null),
  mowerFetch: async (url: string, init?: RequestInit) => {
    if (url.startsWith('http://t:8082')) {
      net.tAsked++;
      if (net.t === 'other') return new Response('not found', {status: 404});
    }
    if (url.startsWith('http://t:8082') || (net.app && net.selected === 't')) throw new TypeError('Failed to fetch');
    if (init?.method === 'POST') {
      net.a = JSON.parse(String(init.body));
      net.posted.push(net.a);
    }
    return new Response(JSON.stringify(net.a), {headers: {'content-type': 'application/json', 'X-Settings-Version': String(net.posted.length)}});
  },
}));
vi.mock('./native', () => ({isApp: () => net.app}));
const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v)});
vi.stubGlobal('document', {documentElement: {style: {setProperty: () => {}}}});

// a mower switch reloads the page
async function open(id: string) {
  vi.clearAllTimers();
  net.selected = id;
  vi.resetModules();
  const settings = await import('./settings');
  await settings.syncSettings();
  return settings;
}

afterEach(() => vi.useRealTimers());

describe('a mower without a container', () => {
  it('keeps its own icon on this device over a switch, the other mower keeps its own', async () => {
    vi.useFakeTimers();
    let s = await open('');
    expect(s.settingsStore.snapshot().icons).toEqual({mower: 'punisher'});

    s = await open('t');
    expect(s.settingsStore.snapshot()).toMatchObject({colors: {mower: '#111111'}});
    expect(s.settingsStore.snapshot().icons).toBeUndefined();
    s.saveSettings({...s.settingsStore.snapshot(), icons: {mower: 'tron'}, colors: {mower: '#222222'}});
    await vi.advanceTimersByTimeAsync(1000);
    // the color goes home, the icon stays with t
    expect(net.posted.at(-1)).toMatchObject({colors: {mower: '#222222'}, icons: {mower: 'punisher'}});

    s = await open('');
    expect(s.settingsStore.snapshot()).toMatchObject({colors: {mower: '#222222'}, icons: {mower: 'punisher'}});

    s = await open('t');
    expect(s.settingsStore.snapshot()).toMatchObject({colors: {mower: '#222222'}, icons: {mower: 'tron'}});
    // asked again a while later, it stays
    await vi.advanceTimersByTimeAsync(31000);
    expect(s.settingsStore.snapshot().icons).toEqual({mower: 'tron'});
    expect(net.posted.every((p) => JSON.stringify(p.icons) === JSON.stringify({mower: 'punisher'}))).toBe(true);
  });

  it('in the app keeps all of its own, the mower with a container takes its own from it', async () => {
    vi.useFakeTimers();
    stored.clear();
    net.app = true;
    net.a = {colors: {mower: '#111111'}, icons: {mower: 'punisher'}};
    net.posted = [];
    let s = await open('a');
    expect(s.settingsStore.snapshot().icons).toEqual({mower: 'punisher'});

    s = await open('t');
    expect(s.settingsStore.snapshot().icons).toBeUndefined();
    s.saveSettings({...s.settingsStore.snapshot(), icons: {mower: 'tron'}, colors: {mower: '#444444'}});
    await vi.advanceTimersByTimeAsync(1000);

    s = await open('a');
    expect(s.settingsStore.snapshot()).toMatchObject({icons: {mower: 'punisher'}, colors: {mower: '#111111'}});
    s = await open('t');
    expect(s.settingsStore.snapshot()).toMatchObject({icons: {mower: 'tron'}, colors: {mower: '#444444'}});
    expect(net.posted).toEqual([]);
    net.app = false;
  });

  it('settings saved before mowers had their own stay with the first mower looked at', async () => {
    stored.clear();
    stored.set('appSettings', JSON.stringify({colors: {mower: '#333333'}, icons: {mower: 'robot'}}));
    vi.resetModules();
    net.selected = 't';
    const s = await import('./settings');
    expect(s.settingsStore.snapshot()).toEqual({colors: {mower: '#333333'}, icons: {mower: 'robot'}});
  });

  it('is asked less and less often while nothing answers there, not again once it answered without settings', async () => {
    vi.useFakeTimers();
    net.tAsked = 0;
    await open('t');
    await vi.advanceTimersByTimeAsync(600000);
    // at the start, after 30 s, 1:30, 3:30 and 7:30
    expect(net.tAsked).toBe(5);

    net.t = 'other';
    net.tAsked = 0;
    await open('t');
    await vi.advanceTimersByTimeAsync(600000);
    expect(net.tAsked).toBe(1);
    net.t = 'down';
  });
});
