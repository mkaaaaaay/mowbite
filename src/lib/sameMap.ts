import type {MowerMap} from '@/hooks/useMowerMap';
import {openRings} from './rings';

// same content. areas the editor didn't touch keep their object, so only changed ones get compared as text
export function sameMap(a: MowerMap, b: MowerMap): boolean {
  if (a === b) return true;
  const same = (x: unknown, y: unknown) => x === y || JSON.stringify(x) === JSON.stringify(y);
  const rest = (m: MowerMap) => ({...m, areas: null, docking_stations: null});
  return (
    a.areas.length === b.areas.length &&
    a.areas.every((x, i) => same(x, b.areas[i])) &&
    same(a.docking_stations, b.docking_stations) &&
    same(rest(a), rest(b))
  );
}

// the values as the mower writes them back: keys in any order, numbers to a millionth, outlines open or closed
const canonical = (v: unknown): unknown =>
  typeof v === 'number'
    ? Math.round(v * 1e6) / 1e6
    : Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;

// the same map as one sent to the mower, after it came back from there (map.replace answering late)
export function sameContent(a: MowerMap, b: MowerMap): boolean {
  return a === b || JSON.stringify(canonical(openRings(a))) === JSON.stringify(canonical(openRings(b)));
}

// a recording saved in the record page has come in the map: one more area of its type (mow, nav), or for the docking
// station another one than before
export function recordedIn(kind: 'mow' | 'nav' | 'dock', before: MowerMap | null, now: MowerMap | null): boolean {
  if (!now) return false;
  if (kind === 'dock') return now.docking_stations.length > 0 && JSON.stringify(now.docking_stations) !== JSON.stringify(before?.docking_stations ?? []);
  const count = (m: MowerMap | null) => m?.areas.filter((a) => a.properties.type === kind).length ?? 0;
  return count(now) > count(before);
}
