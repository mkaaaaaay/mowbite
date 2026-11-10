import {beforeEach, describe, expect, it, vi} from 'vitest';

const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v), removeItem: (k: string) => stored.delete(k)});
vi.stubGlobal('window', {});

// the page loaded again: what's kept is read anew
const load = async () => {
  vi.resetModules();
  return import('./useMapPrefs');
};

describe('the map options', () => {
  beforeEach(() => stored.clear());

  it('are the same for every map, a layer switched off on one stays off when another switches one off', async () => {
    stored.set('mapHidden', JSON.stringify(['track']));
    const {mapPrefs, changeMapPrefs} = await load();
    const before = mapPrefs();
    changeMapPrefs.toggleLayer('obstacle');
    changeMapPrefs.toggleLayer('nav');
    expect([...mapPrefs().hidden].sort()).toEqual(['nav', 'obstacle', 'track']);
    expect(JSON.parse(stored.get('mapHidden')!).sort()).toEqual(['nav', 'obstacle', 'track']);
    // a change is a new snapshot, the one before stays as it was
    expect([...before.hidden]).toEqual(['track']);
    changeMapPrefs.toggleGrid();
    changeMapPrefs.toggleGrid();
    expect(mapPrefs().showGrid).toBe(true);
    expect(stored.get('mapGrid')).toBe('on');
  });

  it('keep the coverage for each mower, an older value for the whole device counts as off', async () => {
    stored.set('mapCoverage', 'gps');
    expect((await load()).mapPrefs().coverage).toBe('off');
    stored.set('appSettings', JSON.stringify({mowers: [{id: 't', name: 'Tron', host: 't'}]}));
    stored.set('mower', 't');
    const {mapPrefs, changeMapPrefs} = await load();
    changeMapPrefs.setCoverage('wifi');
    expect(mapPrefs().coverage).toBe('wifi');
    expect(stored.get('mapCoverage')).toBe('gps');
    expect((await load()).mapPrefs().coverage).toBe('wifi');
    stored.delete('mower');
    expect((await load()).mapPrefs().coverage).toBe('off');
  });
});
