import type {MowerMap} from '@/hooks/useMowerMap';

export type Area = MowerMap['areas'][number];
export type AreaProperties = Area['properties'];
// change the selected area's properties, undoable = one undo step for this change
export type UpdateArea = (patch: Partial<AreaProperties>, undoable?: boolean) => void;

// area settings only newer openmower versions keep, older ones drop them when saving
export const NEW_AREA_SETTINGS = ['skip_mowing', 'angle_min', 'angle_max'] as const;

export const AREA_TYPES = [
  {value: 'mow', label: 'Mowing area', hint: 'driven on and mowed'},
  {value: 'nav', label: 'Navigation area', hint: 'driven on but not mowed, e.g. a path between two lawns'},
  {value: 'obstacle', label: 'Obstacle', hint: 'no-go zone, keep it inside a mowing area'},
  {value: 'draft', label: 'Draft', hint: 'ignored by the mower'},
];

export const DEG = Math.PI / 180;

// wraps into -180..180
export function normDeg(d: number) {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}
