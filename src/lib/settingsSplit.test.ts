import {describe, expect, it, vi} from 'vitest';

// the page comes from mower a, the browser looks at mower b (http://b:8082)
const kept = vi.hoisted(() => ({
  a: {
    data: {
      mapStyle: 'garden',
      colors: {mower: '#111111'},
      mowers: [{id: 'b', name: 'B', host: 'b'}],
      mower: {width: 0.4},
      icons: {mower: 'punisher'},
      garden: {sun: true},
      dashboard: {map: 'always', hidden: ['gps']},
      looks: {a1: 'tree'},
      imagery: {esriKey: 'key', offsets: {esri: [1, 2]}},
    } as Record<string, unknown>,
    posted: [] as Record<string, unknown>[],
  },
  b: {
    data: {
      mapStyle: 'plain',
      colors: {mower: '#999999'},
      mower: {width: 0.6},
      dashboard: {hidden: ['rain']},
      looks: {b1: 'pond'},
      imagery: {offsets: {esri: [3, 4]}},
      leftovers: {auto: true},
    } as Record<string, unknown>,
    posted: [] as Record<string, unknown>[],
  },
  base: 'http://b:8082',
}));
vi.mock('./mowers', () => ({
  apiBase: () => kept.base,
  isDemo: () => false,
  leaveRemoved: () => {},
  selectedMowerId: () => 'b',
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
      mapStyle: 'plain',
      colors: {mower: '#111111'},
      mowers: [{id: 'b', name: 'B', host: 'b'}],
      mower: {width: 0.6},
      dashboard: {map: 'always', hidden: ['rain']},
      looks: {b1: 'pond'},
      imagery: {esriKey: 'key', offsets: {esri: [3, 4]}},
      leftovers: {auto: true},
    });
    // b's sizes, icon, map style and dashboard values: only to b, the colors it has from before stay
    const now = settingsStore.snapshot();
    saveSettings({...now, mower: {width: 0.7}, icons: {mower: 'tron'}, mapStyle: 'garden', dashboard: {...now.dashboard, hidden: []}});
    await vi.advanceTimersByTimeAsync(1000);
    expect(kept.a.posted).toEqual([]);
    expect(kept.b.posted.at(-1)).toMatchObject({
      mapStyle: 'garden',
      colors: {mower: '#999999'},
      mower: {width: 0.7},
      icons: {mower: 'tron'},
      dashboard: {hidden: []},
      looks: {b1: 'pond'},
    });
    // a color: only home, a's own settings stay
    saveSettings({...settingsStore.snapshot(), colors: {mower: '#222222'}});
    await vi.advanceTimersByTimeAsync(1000);
    expect(kept.b.posted).toHaveLength(1);
    expect(kept.a.posted.at(-1)).toEqual({
      mapStyle: 'garden',
      colors: {mower: '#222222'},
      mowers: [{id: 'b', name: 'B', host: 'b'}],
      mower: {width: 0.4},
      icons: {mower: 'punisher'},
      garden: {sun: true},
      dashboard: {map: 'always', hidden: ['gps']},
      looks: {a1: 'tree'},
      imagery: {esriKey: 'key', offsets: {esri: [1, 2]}},
    });
    vi.useRealTimers();
  });

  it('saves b taken out of the list home with a\'s own settings, not b\'s', async () => {
    vi.useFakeTimers();
    // (the list without b: the selected mower is this one from now on)
    kept.base = '';
    saveSettings({...settingsStore.snapshot(), mowers: []});
    await vi.advanceTimersByTimeAsync(1000);
    expect(kept.b.posted).toHaveLength(1);
    expect(kept.a.posted.at(-1)).toMatchObject({mowers: [], mower: {width: 0.4}, icons: {mower: 'punisher'}, looks: {a1: 'tree'}});
    expect(kept.a.posted.at(-1)).not.toHaveProperty('leftovers');
    vi.useRealTimers();
  });
});
