import {beforeEach, describe, expect, it, vi} from 'vitest';

// what the container got posted and what it gives back for ?id=
const net = vi.hoisted(() => ({posted: '', stored: ''}));
vi.mock('./mowers', () => ({
  apiBase: () => '',
  isDemo: () => false,
  keptOs: () => false,
  mowerFetch: async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') net.posted = String(init.body);
    return new Response(init?.method === 'POST' ? '{"id":"1"}' : net.stored, {headers: {'content-type': 'application/json'}});
  },
}));
const datum = vi.hoisted(() => ({now: undefined as {lat: number; lon: number} | undefined}));
vi.mock('@/hooks/useMowerParams', () => ({knownDatum: () => datum.now}));

const {datumWarning, loadBackup, parseMapFile, saveBackup, withDatum} = await import('./backups');

const map = {areas: [{id: 'a', properties: {type: 'mow'}, outline: [{x: 0, y: 0}, {x: 4, y: 0}, {x: 4, y: 4}]}], docking_stations: []};
const here = {lat: 52.4735, lon: 13.4035};

describe('the datum with a backup or a file', () => {
  beforeEach(() => {
    datum.now = here;
  });

  it('goes into a backup next to the map', async () => {
    await saveBackup(map, 'x', false);
    expect(JSON.parse(net.posted).datum).toEqual(here);
  });

  it('is left out while the mower has none', async () => {
    datum.now = undefined;
    await saveBackup(map, 'x', false);
    expect(JSON.parse(net.posted)).not.toHaveProperty('datum');
  });

  it('comes back with a backup, not as part of its map', async () => {
    net.stored = JSON.stringify(withDatum(map, here));
    const b = await loadBackup('1');
    expect(b.datum).toEqual(here);
    expect(b.map).not.toHaveProperty('datum');
    expect(b.map.areas[0].outline).toHaveLength(3);
  });

  it('is missing from an older backup or file', async () => {
    net.stored = JSON.stringify(map);
    expect((await loadBackup('1')).datum).toBeUndefined();
    expect(parseMapFile(JSON.stringify(map)).datum).toBeUndefined();
  });

  it('comes with a map file, not as part of its map', () => {
    const r = parseMapFile(JSON.stringify(withDatum(map, here)));
    expect(r.datum).toEqual(here);
    expect(r.map).not.toHaveProperty('datum');
  });
});

describe('datumWarning', () => {
  it('says nothing for the same datum or one not known', () => {
    expect(datumWarning(here, here)).toBeNull();
    expect(datumWarning(here, {lat: here.lat + 1e-8, lon: here.lon})).toBeNull();
    expect(datumWarning(undefined, undefined)).toBeNull();
  });

  it('warns of another datum with how far off it is', () => {
    // about 11 m north
    expect(datumWarning({lat: here.lat + 0.0001, lon: here.lon}, here)).toMatch(/another reference point.* 11 m away/);
  });

  it('warns of a map without one', () => {
    expect(datumWarning(undefined, here)).toMatch(/no reference point/);
  });
});
