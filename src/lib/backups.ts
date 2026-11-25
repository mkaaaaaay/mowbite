import {useState} from 'react';
import type {DockingStation, MapArea, MowerMap, Point} from '@/hooks/useMowerMap';
import {knownDatum} from '@/hooks/useMowerParams';
import {AREA_PROPERTY_TYPES, hasPropertyType} from './geojson';
import {forget, fresh} from './fresh';
import {fmt, tr} from './i18n';
import type {Datum} from './imagery';
import {isObj} from './mergeChanges';
import {isPin} from './mowerBody';
import {apiBase, keptOs, mowerFetch} from './mowers';
import {closedRings, openRings} from './rings';
import {rpcErrorText} from './rpcText';

// map backups kept by the container (docker/backups.cgi), so only there when served by it
export interface BackupInfo {
  id: string;
  t: number; // unix seconds
  name: string;
  areas: number;
  auto: boolean;
  size: number;
}

// how many the container keeps of the automatic ones and of those made by hand, null from one that doesn't say
export interface BackupKeep {
  auto: number;
  hand: number;
}
export interface Backups {
  list: BackupInfo[];
  keep: BackupKeep | null;
}

export function keepOf(header: string | null): BackupKeep | null {
  const auto = header?.match(/\bauto=(\d+)/);
  const hand = header?.match(/\bhand=(\d+)/);
  return auto && hand ? {auto: Number(auto[1]), hand: Number(hand[1])} : null;
}

const PATH = '/cgi-bin/backups';
const endpoint = () => apiBase() + PATH;
// the container only on OpenMower
const httpError = (status: number) =>
  new Error(
    keptOs() === false
      ? tr('The mower answered with error {status}. Is MowBite running as a container on the mower?', {status})
      : tr('The mower answered with error {status}.', {status}),
  );

// null: not served, no container keeps backups. undefined: it didn't answer, a save still tries to make one
export function listBackups(): Promise<Backups | null | undefined> {
  return fresh('backups', async () => {
    let res: Response;
    try {
      res = await mowerFetch(endpoint(), {cache: 'no-store'});
    } catch {
      return undefined;
    }
    if (res.status >= 500) return undefined;
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    return {list: await res.json(), keep: keepOf(res.headers.get('X-Backups-Keep'))};
  });
}

// a backup or a map file keeps the datum its coordinates count from next to the map (the mower doesn't read it). none:
// none written, an older backup or file
export interface DatedMap {
  map: MowerMap;
  datum?: Datum;
}

// the map as it goes into a backup or a file, with the datum when it's known
export const withDatum = (map: MowerMap, datum: Datum | undefined) => ({
  ...closedRings(map),
  ...(datum ? {datum: {lat: datum.lat, lon: datum.lon}} : {}),
});

const datumOf = (v: unknown): {datum?: Datum} =>
  isObj(v) && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? {datum: {lat: v.lat as number, lon: v.lon as number}} : {};

// how far apart two datums are in meters (close enough for a garden)
const datumDistance = (a: Datum, b: Datum) =>
  Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180));
// MowBite OS's tolerance for the same datum
const SAME_DATUM_M = 0.01;

// what to warn of before a backup or a file goes onto the mower: made with another datum than the mower's, or without
// one. null when it fits or the mower's datum isn't known
export function datumWarning(recorded: Datum | undefined, current: Datum | undefined): string | null {
  if (!current) return null;
  if (!recorded)
    return tr(
      "This map has no reference point (datum) with it, an older backup or file. If the mower's reference point changed since, all areas and the docking station lie off by that much. Check in the preview that they lie where they belong.",
    );
  const m = datumDistance(recorded, current);
  if (m <= SAME_DATUM_M) return null;
  return tr(
    "This map was made with another reference point (datum), {m} m away from the mower's. Put on the mower, all areas and the docking station lie {m} m off and it mows beside the lawn.",
    {m: fmt(m, m < 10 ? 2 : 0)},
  );
}

export async function loadBackup(id: string): Promise<DatedMap> {
  const res = await mowerFetch(`${endpoint()}?id=${encodeURIComponent(id)}`, {cache: 'no-store'});
  if (!res.ok) throw httpError(res.status);
  const {datum, ...map} = await res.json();
  return {map: openRings(map), ...datumOf(datum)};
}

// areas: how many it has, pins not counted. with the mower's datum as it is now, the map's coordinates count from it
export async function saveBackup(map: MowerMap, name: string, auto: boolean): Promise<void> {
  const q = new URLSearchParams({name, areas: String(map.areas.filter((a) => !isPin(a)).length), auto: auto ? '1' : '0'});
  const res = await mowerFetch(`${endpoint()}?${q}`, {method: 'POST', body: JSON.stringify(withDatum(map, knownDatum()))});
  forget('backups');
  if (res.status === 409) {
    const n = (await listBackups().catch(() => undefined))?.keep?.hand;
    throw new Error(
      n
        ? tr('{n} backups made by hand are kept at most. Delete one you no longer need first.', {n})
        : tr('The mower keeps no more backups made by hand. Delete one you no longer need first.'),
    );
  }
  if (!res.ok) throw httpError(res.status);
}

// the map on the mower into the backups before it gets replaced: false when no container keeps backups. throws when
// that failed
export async function backupFirst(map: MowerMap, name: string): Promise<boolean> {
  if ((await listBackups().catch(() => undefined)) === null) return false;
  await saveBackup(map, name, true);
  return true;
}

// backupFirst for a save or restore: failed sets the error and the next try goes without a backup (until reset).
// none: no map, no container for backups, or going without. timeoutMs: gives up after that long
export function useBackupFirst(fail: (text: string) => void, again: 'save' | 'restore' = 'save', timeoutMs = 0) {
  const [without, setWithout] = useState(false);
  const first = async (map: MowerMap | null, name: string): Promise<'made' | 'none' | 'failed'> => {
    if (!map || without) return 'none';
    try {
      const made = backupFirst(map, name);
      const noAnswer = () => new Promise<never>((_, reject) => setTimeout(() => reject(new Error(tr('no answer'))), timeoutMs));
      return (await (timeoutMs ? Promise.race([made, noAnswer()]) : made)) ? 'made' : 'none';
    } catch (e) {
      setWithout(true);
      const why = rpcErrorText(e);
      fail(
        again === 'restore'
          ? tr("The map on the mower couldn't be backed up first ({why}). Restore again to go on without that backup.", {why})
          : tr("The map on the mower couldn't be backed up first ({why}). Tap save again to save without that backup.", {why}),
      );
      return 'failed';
    }
  };
  return {first, without, reset: () => setWithout(false)};
}

export async function deleteBackup(id: string): Promise<void> {
  const res = await mowerFetch(`${endpoint()}?action=delete&id=${encodeURIComponent(id)}`, {method: 'POST'});
  forget('backups');
  if (!res.ok) throw httpError(res.status);
}

// whether a backup made after `since` has another angle for the area than `angle`. backups are made before every save,
// so then the angle got changed on purpose after that time. only looks at the newest few
export async function angleChangedSince(areaId: string, since: number, angle: number | undefined): Promise<boolean> {
  const after = ((await listBackups())?.list ?? []).filter((b) => b.t > since).sort((a, b) => b.t - a.t);
  for (const b of after.slice(0, 10)) {
    try {
      const area = (await loadBackup(b.id)).map.areas.find((a) => a.id === areaId);
      if (area && area.properties.angle !== angle) return true;
    } catch {}
  }
  return false;
}

// why a file isn't taken as a map, the message is for the user ({id}: the area it's about)
export class MapFileError extends Error {
  constructor(
    message: string,
    public id?: string,
  ) {
    super(message);
  }
}

// a file picked by the user: at least has to look like a map, its points and docking stations numbers, each area with an
// id of its own. what a map can do without is filled in, a known property of the wrong type left out and named in left
// (area name or id: the properties), with the datum the file was written with
export function parseMapFile(text: string): DatedMap & {left: string[]} {
  const {datum, ...m} = JSON.parse(text) ?? {};
  const isPoint = (p?: Point | null) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
  const hasId = (a: MapArea | null) => !!a && typeof a.id === 'string' && !!a.id;
  const isDock = (d: DockingStation | null) => !!d && isPoint(d.position) && Number.isFinite(d.heading);
  if (!m || !Array.isArray(m.areas)) throw new MapFileError("That file doesn't look like a map.");
  if (!m.areas.every(hasId)) throw new MapFileError('An area in the file has no id.');
  const odd = m.areas.find((a: MapArea) => !Array.isArray(a.outline) || !a.outline.every(isPoint));
  if (odd) throw new MapFileError("Area {id} in the file has points that aren't numbers.", odd.id);
  if (Array.isArray(m.docking_stations) && !m.docking_stations.every(isDock))
    throw new MapFileError('A docking station in the file has no position or heading.');
  const twice = m.areas.find((a: MapArea, i: number) => m.areas.findIndex((b: MapArea) => b.id === a.id) !== i);
  if (twice) throw new MapFileError('Two areas in the file have the same id ({id}).', twice.id);
  const left: string[] = [];
  const typed = (a: {id: string; properties?: unknown}) => {
    const p = a.properties;
    if (!isObj(p)) return {};
    const entries = Object.entries(p);
    const wrong = entries.filter(([k, v]) => k in AREA_PROPERTY_TYPES && !hasPropertyType(v, AREA_PROPERTY_TYPES[k])).map(([k]) => k);
    const name = p.name;
    if (wrong.length) left.push(`${typeof name === 'string' && name ? name : a.id}: ${wrong.join(', ')}`);
    return Object.fromEntries(entries.filter(([k]) => !wrong.includes(k)));
  };
  const map = openRings({
    ...m,
    docking_stations: Array.isArray(m.docking_stations) ? m.docking_stations : [],
    areas: m.areas.map((a: {id: string; properties?: unknown}) => ({...a, properties: typed(a)})),
  });
  return {map, left, ...datumOf(datum)};
}
