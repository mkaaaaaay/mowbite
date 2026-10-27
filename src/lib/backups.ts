import type {MowerMap} from '@/hooks/useMowerMap';
import {forget, fresh} from './fresh';
import {tr} from './i18n';
import {isPin} from './mowerBody';
import {apiBase, mowerFetch} from './mowers';
import {closedRings, openRings} from './rings';

// map backups kept by the container (docker/backups.cgi), so only there when served by it
export interface BackupInfo {
  id: string;
  t: number; // unix seconds
  name: string;
  areas: number;
  auto: boolean;
  size: number;
}

const PATH = '/cgi-bin/backups';
const endpoint = () => apiBase() + PATH;

// null: not served, no container keeps backups. undefined: it didn't answer, a save still tries to make one
export function listBackups(): Promise<BackupInfo[] | null | undefined> {
  return fresh('backups', async () => {
    let res: Response;
    try {
      res = await mowerFetch(endpoint(), {cache: 'no-store'});
    } catch {
      return undefined;
    }
    if (res.status >= 500) return undefined;
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    return await res.json();
  });
}

export async function loadBackup(id: string): Promise<MowerMap> {
  const res = await mowerFetch(`${endpoint()}?id=${encodeURIComponent(id)}`, {cache: 'no-store'});
  if (!res.ok) throw new Error(`backup ${res.status}`);
  return openRings(await res.json());
}

// areas: how many it has, pins not counted
export async function saveBackup(map: MowerMap, name: string, auto: boolean): Promise<void> {
  const q = new URLSearchParams({name, areas: String(map.areas.filter((a) => !isPin(a)).length), auto: auto ? '1' : '0'});
  const res = await mowerFetch(`${endpoint()}?${q}`, {method: 'POST', body: JSON.stringify(closedRings(map))});
  forget('backups');
  if (res.status === 409) throw new Error(tr('{n} backups made by hand are kept at most. Delete one you no longer need first.', {n: 50}));
  if (!res.ok) throw new Error(`backup ${res.status}`);
}

export async function deleteBackup(id: string): Promise<void> {
  await mowerFetch(`${endpoint()}?action=delete&id=${encodeURIComponent(id)}`, {method: 'POST'});
  forget('backups');
}

// whether a backup made after `since` has another angle for the area than `angle`. backups are made before every save,
// so then the angle got changed on purpose after that time. only looks at the newest few
export async function angleChangedSince(areaId: string, since: number, angle: number | undefined): Promise<boolean> {
  const after = ((await listBackups()) ?? []).filter((b) => b.t > since).sort((a, b) => b.t - a.t);
  for (const b of after.slice(0, 10)) {
    try {
      const area = (await loadBackup(b.id)).areas.find((a) => a.id === areaId);
      if (area && area.properties.angle !== angle) return true;
    } catch {}
  }
  return false;
}

// a file picked by the user: at least has to look like a map. what a map can do without is filled in
export function parseMapFile(text: string): MowerMap {
  const m = JSON.parse(text);
  if (!m || !Array.isArray(m.areas) || !m.areas.every((a: {outline?: unknown}) => Array.isArray(a.outline)))
    throw new Error('not a map');
  return openRings({
    ...m,
    docking_stations: Array.isArray(m.docking_stations) ? m.docking_stations : [],
    areas: m.areas.map((a: {properties?: unknown}) => ({...a, properties: a.properties && typeof a.properties === 'object' ? a.properties : {}})),
  });
}
