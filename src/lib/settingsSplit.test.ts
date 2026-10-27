import {describe, expect, it, vi} from 'vitest';

// the page comes from mower a, the browser looks at mower b (http://b:8082)
const kept = vi.hoisted(() => ({
  a: {
    data: {
      mapStyle: 'garden',
      colors: {mower: '#111111'},
      mowers: [{id: 'b', name: 'B', host: 'b'}],
      mower: {width: 0.4},
      looks: {a1: 'tree'},
      imagery: {esriKey: 'key', offsets: {esri: [1, 2]}},
    } as Record<string, unknown>,
    posted: [] as Record<string, unknown>[],
  },
  b: {
    data: {mapStyle: 'plain', mower: {width: 0.6}, looks: {b1: 'pond'}, imagery: {offsets: {esri: [3, 4]}}, leftovers: {auto: true}} as Record<
      string,
      unknown
    >,
    posted: [] as Record<string, unknown>[],
  },
}));
vi.mock('./mowers', () => ({
  apiBase: () => 'http://b:8082',
  isDemo: () => false,
  mowerFetch: async (url: string, init?: RequestInit) => {
    const at = url.startsWith('http://b:8082') ? kept.b : kept.a;
    if (init?.method === 'POST') {
      at.data = JSON.parse(String(init.body));
      at.posted.push(at.data);
    }
    return new Response(JSON.stringify(at.data), {headers: {'content-type': 'application/json', 'X-Settings-Version': String(at.posted.length)}});
  },
}));
vi.mock('./native', () => ({isApp: () => false}));
vi.stubGlobal('localStorage', {getItem: () => null, setItem: () => {}});
vi.stubGlobal('document', {documentElement: {style: {setProperty: () => {}}}});

const {saveSettings, settingsStore, syncSettings} = await import('./settings');

describe('a browser looking at another mower than the one the page comes from', () => {
  it("takes that mower's own settings from it and the app's from home, and saves each where it came from", async () => {
    vi.useFakeTimers();
    await syncSettings();
    expect(settingsStore.snapshot()).toEqual({
      mapStyle: 'garden',
      colors: {mower: '#111111'},
      mowers: [{id: 'b', name: 'B', host: 'b'}],
      mower: {width: 0.6},
      looks: {b1: 'pond'},
      imagery: {esriKey: 'key', offsets: {esri: [3, 4]}},
      leftovers: {auto: true},
    });
    // b's sizes: only to b, its own map style stays
    saveSettings({...settingsStore.snapshot(), mower: {width: 0.7}});
    await vi.advanceTimersByTimeAsync(1000);
    expect(kept.a.posted).toEqual([]);
    expect(kept.b.posted.at(-1)).toMatchObject({mapStyle: 'plain', mower: {width: 0.7}, looks: {b1: 'pond'}});
    // a color: only home, a's own sizes and pictures stay
    saveSettings({...settingsStore.snapshot(), colors: {mower: '#222222'}});
    await vi.advanceTimersByTimeAsync(1000);
    expect(kept.b.posted).toHaveLength(1);
    expect(kept.a.posted.at(-1)).toEqual({
      mapStyle: 'garden',
      colors: {mower: '#222222'},
      mowers: [{id: 'b', name: 'B', host: 'b'}],
      mower: {width: 0.4},
      looks: {a1: 'tree'},
      imagery: {esriKey: 'key', offsets: {esri: [1, 2]}},
    });
    vi.useRealTimers();
  });
});
