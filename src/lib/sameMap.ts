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

// the values as the mower writes them back: keys in any order, numbers to a millionth (or 1/per), outlines open or closed
const canonical = (v: unknown, per = 1e6): unknown =>
  typeof v === 'number'
    ? Math.round(v * per) / per
    : Array.isArray(v)
      ? v.map((x) => canonical(x, per))
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, canonical(x, per)]),
          )
        : v;

// what openmower's mower_map keeps of a map and writes back (mower_map_service to_json): areas and docks only, an area's
// name only when not empty, its type draft when missing, active and mowable only when false, of a point x and y
const asKept = (m: MowerMap): MowerMap => ({
  areas: m.areas.map(({id, properties: {name, type, active, mowable, ...rest}, outline}) => ({
    id,
    properties: {
      ...rest,
      ...(name ? {name} : {}),
      type: type ?? 'draft',
      ...(active === false ? {active} : {}),
      ...(mowable === false ? {mowable} : {}),
    },
    outline: outline.map(({x, y}) => ({x, y})),
  })),
  docking_stations: m.docking_stations,
});

// the same map as one sent to the mower, after it came back from there (map.replace answering late)
export function sameContent(a: MowerMap, b: MowerMap): boolean {
  const text = (m: MowerMap) => JSON.stringify(canonical(asKept(openRings(m))));
  return a === b || text(a) === text(b);
}

// a short key of what the mower keeps of a map, to the mm: the same when the same map comes again, another one when an
// area or a point differs (the number of areas in front, one more always changes it)
export function mapKey(m: MowerMap): string {
  const text = JSON.stringify(canonical(asKept(openRings(m)), 1000));
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${m.areas.length}:${(h >>> 0).toString(36)}`;
}

// a recording saved in the record page has come in the map: one more area of its type (mow, nav), or for the docking
// station another one than before
export function recordedIn(kind: 'mow' | 'nav' | 'dock', before: MowerMap | null, now: MowerMap | null): boolean {
  if (!now) return false;
  if (kind === 'dock') return now.docking_stations.length > 0 && JSON.stringify(now.docking_stations) !== JSON.stringify(before?.docking_stations ?? []);
  const count = (m: MowerMap | null) => m?.areas.filter((a) => a.properties.type === kind).length ?? 0;
  return count(now) > count(before);
}
