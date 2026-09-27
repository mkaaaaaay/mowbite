import type {MowerMap} from '@/hooks/useMowerMap';
import {apiBase} from './mowers';

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

export async function listBackups(): Promise<BackupInfo[] | null> {
  try {
    const res = await fetch(endpoint(), {cache: 'no-store'});
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function loadBackup(id: string): Promise<MowerMap> {
  const res = await fetch(`${endpoint()}?id=${encodeURIComponent(id)}`, {cache: 'no-store'});
  if (!res.ok) throw new Error(`backup ${res.status}`);
  return res.json();
}

export async function saveBackup(map: MowerMap, name: string, auto: boolean): Promise<void> {
  const q = new URLSearchParams({name, areas: String(map.areas.length), auto: auto ? '1' : '0'});
  const res = await fetch(`${endpoint()}?${q}`, {method: 'POST', body: JSON.stringify(map)});
  if (!res.ok) throw new Error(`backup ${res.status}`);
}

export async function deleteBackup(id: string): Promise<void> {
  await fetch(`${endpoint()}?action=delete&id=${encodeURIComponent(id)}`, {method: 'POST'});
}

// a file picked by the user: at least has to look like a map
export function parseMapFile(text: string): MowerMap {
  const m = JSON.parse(text);
  if (!m || !Array.isArray(m.areas) || !m.areas.every((a: {outline?: unknown}) => Array.isArray(a.outline)))
    throw new Error('not a map');
  return m;
}
