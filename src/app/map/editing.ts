import type {MowerMap, Point} from '@/hooks/useMowerMap';
import {fmt, tr} from '@/lib/i18n';
import {isPin, PIN_SIDE} from '@/lib/mowerBody';
import {sameMap} from '@/lib/sameMap';
import type {KeptLooks} from '@/lib/settings';

export type Area = MowerMap['areas'][number];
export type AreaProperties = Area['properties'];
// change the selected area's properties, undoable = one undo step for this change
export type UpdateArea = (patch: Partial<AreaProperties>, undoable?: boolean) => void;

// area settings only newer openmower versions keep, older ones drop them when saving (pin too, its square says it then)
export const NEW_AREA_SETTINGS = ['mowable', 'angle_min', 'angle_max'] as const;

// the outline of a pin standing at x, y: a square PIN_SIDE across along the map's axes, an area other apps can take too
// (closed it has the 5 points a ring needs)
export function pinSquare(x: number, y: number): Point[] {
  const h = PIN_SIDE / 2;
  return [
    {x: x - h, y: y - h},
    {x: x + h, y: y - h},
    {x: x + h, y: y + h},
    {x: x - h, y: y + h},
  ];
}

// nothing but pins differs between the maps (set, moved or taken away), or nothing at all
export function onlyPinsChanged(base: MowerMap, map: MowerMap): boolean {
  const rest = (m: MowerMap) => ({...m, areas: m.areas.filter((a) => !isPin(a))});
  return sameMap(rest(base), rest(map));
}

// the map with the pins of another one in place of its own (decorating called off: the mower's), its areas as they are
export const pinsFrom = (map: MowerMap, from: MowerMap): MowerMap => ({
  ...map,
  areas: [...map.areas.filter((a) => !isPin(a)), ...from.areas.filter(isPin)],
});

// while decorating undo goes back no further than the map it started from (start), redo only brings back pins: a step
// undone before it that changed an area stays undone
export const decorUndo = (map: MowerMap, start: MowerMap | null, history: readonly MowerMap[]) => history.length > 0 && map !== start;
export const decorRedo = (map: MowerMap, future: readonly MowerMap[]) => future.length > 0 && onlyPinsChanged(map, future[future.length - 1]);

// what was kept for the pictures of areas not on the map (any more), to put back: nothing for a pin set since
export const goneLooks = (kept: KeptLooks, map: MowerMap | null): KeptLooks =>
  Object.fromEntries(Object.entries(kept).filter(([id]) => !map?.areas.some((a) => a.id === id)));

// the pictures offered first to decorate with, after the ones the map's pins already have
export const PIN_TILES = ['gnome', 'lamp', 'pot', 'bush', 'tree', 'bench', 'umbrella', 'grill'];

// the row of pictures to decorate with: the ones the pins have (looks), the most used first, then PIN_TILES
export function pinTiles(looks: readonly string[]): string[] {
  const count = new Map<string, number>();
  for (const look of looks) count.set(look, (count.get(look) ?? 0) + 1);
  const own = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!);
  return [...own, ...PIN_TILES.filter((k) => !count.has(k))];
}

export const AREA_TYPES = [
  {value: 'mow', label: 'Mowing area', hint: 'driven on and mowed'},
  {value: 'nav', label: 'Navigation area', hint: 'driven on but not mowed, e.g. a path between two lawns'},
  {value: 'obstacle', label: 'Obstacle', hint: 'no-go zone, keep it inside a mowing area'},
  {value: 'decor', label: 'Decoration', hint: 'only a picture on the map, the mower ignores it (lying in a lawn, it mows over it)'},
  {value: 'draft', label: 'Draft', hint: 'ignored by the mower'},
];

export const DEG = Math.PI / 180;

// wraps into -180..180
export function normDeg(d: number) {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

export type Override = 'outline_count' | 'outline_overlap_count' | 'outline_offset';

// the limits of the mower's own settings (MowerLogic.cfg). the ones per area go to the planner unchecked
const LIMITS: Record<Override, {min: number; max: number; whole: boolean}> = {
  outline_count: {min: 0, max: 255, whole: true},
  outline_overlap_count: {min: 0, max: 255, whole: true},
  outline_offset: {min: -1, max: 1, whole: false},
};

export function overrideError(key: Override, raw: string): string | null {
  if (raw.trim() === '') return null;
  const v = Number(raw);
  const {min, max, whole} = LIMITS[key];
  if (Number.isFinite(v) && v >= min && v <= max && (!whole || Number.isInteger(v))) return null;
  return whole
    ? tr('a whole number from {min} to {max}', {min, max})
    : tr('from {min} to {max} m', {min: fmt(min), max: fmt(max)});
}
