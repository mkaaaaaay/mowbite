import {beforeEach, describe, expect, it, vi} from 'vitest';

// keep: the list's X-Backups-Keep, when asked with GET and net.list; os: what the mower runs (keptOs)
const net = vi.hoisted(() => ({status: 200, list: false, keep: null as string | null, os: false as boolean | null}));
vi.mock('./mowers', () => ({
  apiBase: () => '',
  isDemo: () => false,
  keptOs: () => net.os,
  mowerFetch: async (_url: string, init?: RequestInit) =>
    net.list && init?.method !== 'POST'
      ? new Response('[]', {headers: {'content-type': 'application/json', ...(net.keep ? {'X-Backups-Keep': net.keep} : {})}})
      : new Response('', {status: net.status}),
}));

const {backupFirst, deleteBackup, keepOf, listBackups, parseMapFile, saveBackup} = await import('./backups');
const {forget} = await import('./fresh');

describe('deleteBackup', () => {
  beforeEach(() => {
    net.list = false;
    net.os = false;
  });

  it('is done when the container says so', async () => {
    net.status = 200;
    await expect(deleteBackup('a')).resolves.toBeUndefined();
  });

  it('fails when the container refuses it', async () => {
    net.status = 500;
    await expect(deleteBackup('a')).rejects.toThrow('error 500');
  });

  it('names the container only on OpenMower', async () => {
    net.status = 500;
    await expect(deleteBackup('a')).rejects.toThrow('container');
    for (const os of [true, null]) {
      net.os = os;
      await expect(deleteBackup('a')).rejects.toThrow(/^The mower answered with error 500\.$/);
    }
  });
});

describe('backupFirst', () => {
  beforeEach(() => {
    net.list = false;
  });
  const map = {areas: [], docking_stations: []} as never;

  it('goes without one where no container keeps backups', async () => {
    forget('backups');
    net.status = 404;
    await expect(backupFirst(map, 'before saving')).resolves.toBe(false);
  });

  it('fails when the container did not take it', async () => {
    forget('backups');
    net.status = 500;
    await expect(backupFirst(map, 'before saving')).rejects.toThrow('error 500');
  });
});

describe('parseMapFile', () => {
  const area = {id: 'x', properties: {type: 'mow'}, outline: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}]};
  const dock = {id: 'd', position: {x: 2, y: 2}, heading: 1};

  it('takes a map and fills in what it can do without', () => {
    expect(parseMapFile(JSON.stringify({areas: [{...area, properties: undefined}]}))).toEqual({
      map: {areas: [{...area, properties: {}}], docking_stations: []},
      left: [],
    });
  });

  it('refuses points and docking stations that are no numbers', () => {
    const bad = (m: object) => () => parseMapFile(JSON.stringify(m));
    expect(bad({areas: [{...area, outline: [{x: 'a', y: null}, {x: 1, y: 1}]}]})).toThrow();
    expect(bad({areas: [{...area, outline: [null]}]})).toThrow();
    expect(bad({areas: [null]})).toThrow();
    expect(bad({areas: [area], docking_stations: [{}]})).toThrow();
    expect(bad({areas: [area], docking_stations: [{...dock, heading: '1'}]})).toThrow();
    expect(parseMapFile(JSON.stringify({areas: [area], docking_stations: [dock]})).map.docking_stations).toEqual([dock]);
  });

  it('refuses areas without an id or with the same one, and leaves out a known property of the wrong type', () => {
    const bad = (m: object) => () => parseMapFile(JSON.stringify(m));
    expect(bad({areas: [{...area, id: undefined}]})).toThrow();
    expect(bad({areas: [{...area, id: ''}]})).toThrow();
    expect(bad({areas: [area, {...area}]})).toThrow();
    const odd = {...area, properties: {type: 'mow', angle: '12.5', planner: [1], margin: 0.2, mine: 'kept'}};
    expect(parseMapFile(JSON.stringify({areas: [odd]})).map.areas[0].properties).toEqual({type: 'mow', margin: 0.2, mine: 'kept'});
  });

  it('names what it left out and why a file is refused', () => {
    const odd = {...area, properties: {name: 'Bed', active: 0, mowable: 'false'}};
    expect(parseMapFile(JSON.stringify({areas: [odd, {...area, id: 'y', properties: {pin: 1}}]})).left).toEqual(['Bed: active, mowable', 'y: pin']);
    const why = (m: object) => {
      try {
        parseMapFile(JSON.stringify(m));
      } catch (e) {
        return [(e as Error).message, (e as {id?: string}).id];
      }
    };
    expect(why({areas: [{...area, id: ''}]})).toEqual(['An area in the file has no id.', undefined]);
    expect(why({areas: [area, {...area}]})).toEqual(['Two areas in the file have the same id ({id}).', 'x']);
    expect(why({areas: [{...area, outline: [null]}]})).toEqual(["Area {id} in the file has points that aren't numbers.", 'x']);
    expect(why({areas: [area], docking_stations: [{}]})).toEqual(['A docking station in the file has no position or heading.', undefined]);
    expect(why({})).toEqual(["That file doesn't look like a map.", undefined]);
  });
});

describe('how many are kept', () => {
  const map = {areas: [], docking_stations: []} as never;
  beforeEach(() => {
    forget('backups');
    net.list = true;
    net.status = 409;
  });

  it('comes with the list', async () => {
    net.keep = 'auto=30 hand=50';
    expect((await listBackups())?.keep).toEqual({auto: 30, hand: 50});
  });

  it('is unknown from a container that does not say', async () => {
    net.keep = null;
    expect((await listBackups())?.keep).toBeNull();
    expect(keepOf('auto=30')).toBeNull();
  });

  it('says the most made by hand the container keeps', async () => {
    net.keep = 'auto=30 hand=40';
    await expect(saveBackup(map, 'mine', false)).rejects.toThrow('40 backups made by hand');
  });

  it('says it without a number when the container does not tell it', async () => {
    net.keep = null;
    await expect(saveBackup(map, 'mine', false)).rejects.toThrow('no more backups made by hand');
  });
});
