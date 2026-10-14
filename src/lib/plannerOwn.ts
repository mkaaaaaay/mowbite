import type {MowerMap} from '@/hooks/useMowerMap';
import {shareInside} from './geometry';
import {fmt, tr} from './i18n';
import type {PlannerSetting} from './mowerBody';
import {FIELDS, RETIRED} from './plannerFields';

// What an area sets for the planner itself, at a glance: its planner settings (the planner property) and OpenMower's
// own per area values the planner takes too (outline_count and co., the app doesn't offer them with the planner). In
// the planner's order: the area's planner settings, then OpenMower's of the area, then the ones for all areas.

export type OpenMowerOwn = {outline_count?: number; outline_overlap_count?: number; outline_offset?: number};

export type Own = {
  key: string;
  label: string;
  value: string;
  // why it doesn't count, null when it does
  idle: string | null;
};

// OpenMower's per area value and the planner setting it stands for
const OPENMOWER: [keyof OpenMowerOwn, string][] = [
  ['outline_count', 'perimeter_passes'],
  ['outline_overlap_count', 'lane_overlap_passes'],
  ['outline_offset', 'perimeter_offset'],
];

const short = (v: number) => fmt(v, Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1);

// a setting's value in words, as the menu shows it
export function shown(key: string, v: unknown, s: PlannerSetting | undefined): string {
  const field = FIELDS[key];
  if (typeof v === 'boolean') return field?.ways ? tr(field.ways[v ? 1 : 0]) : v ? tr('on') : tr('off');
  if (typeof v === 'string') return tr(field?.choices?.[v] ?? v);
  if (typeof v === 'number') {
    if (s?.auto_value !== undefined && v === s.auto_value) return tr('automatic');
    if (field?.unit === 'm') return Math.abs(v) < 1 ? `${short(v * 100)} cm` : `${fmt(v, 2)} m`;
    if (field?.unit === 'deg') return `${short((v * 180) / Math.PI)}°`;
    return short(v);
  }
  return JSON.stringify(v);
}

// collision: the planner checks the body (it has edge_margin and the sizes), edges doesn't count then
export function ownSettings(
  own: Record<string, unknown>,
  openmower: OpenMowerOwn,
  settings: Record<string, PlannerSetting>,
  collision: boolean,
): Own[] {
  const out: Own[] = [];
  for (const [key, v] of Object.entries(own)) {
    if (v === undefined || v === null || RETIRED.includes(key)) continue;
    const idle = !settings[key]
      ? tr("the planner doesn't know it")
      : key === 'edges' && collision
        ? tr('no effect with the mower sizes')
        : null;
    out.push({key, label: tr(FIELDS[key]?.label ?? key), value: shown(key, v, settings[key]), idle});
  }
  for (const [prop, key] of OPENMOWER) {
    const v = openmower[prop];
    // a count below 0 is OpenMower's "the global one", the planner leaves it out too
    if (typeof v !== 'number' || (prop !== 'outline_offset' && v < 0)) continue;
    out.push({
      key: prop,
      label: tr('{what} (OpenMower)', {what: tr(FIELDS[key]?.label ?? key)}),
      value: shown(key, v, undefined),
      idle: own[key] !== undefined && own[key] !== null ? tr("no effect, the area's planner setting counts") : null,
    });
  }
  return out;
}

// an area of the map with a value of its own, for the line under a setting: tapped, the map selects the area
export type AreaValue = {id: string; name: string; value: string};

const nameOf = (a: MowerMap['areas'][number]) => a.properties.name || tr(a.properties.type === 'obstacle' ? 'Obstacle' : 'unnamed');
// a mowing area that is mowed, an inactive one's or one not mowed's own values don't count
const mowed = (a: MowerMap['areas'][number]) => a.properties.type === 'mow' && a.properties.active !== false && a.properties.mowable !== false;

// the mowing areas setting a planner setting themselves, or with OpenMower's own value of the area standing for it
// (outline_count and co.), for the line under the setting for all areas. Only the ones mowed
export function areasWith(map: MowerMap | null | undefined, key: string, settings: Record<string, PlannerSetting>): AreaValue[] {
  const om = OPENMOWER.find(([, k]) => k === key)?.[0];
  const out: AreaValue[] = [];
  for (const a of map?.areas ?? []) {
    if (!mowed(a)) continue;
    const own = a.properties.planner?.[key];
    if (own !== undefined && own !== null) {
      out.push({id: a.id, name: nameOf(a), value: shown(key, own, settings[key])});
      continue;
    }
    const v = om ? a.properties[om] : undefined;
    if (typeof v === 'number' && (om === 'outline_offset' || v >= 0)) {
      out.push({id: a.id, name: nameOf(a), value: tr('{value} from OpenMower', {value: shown(key, v, undefined)})});
    }
  }
  return out;
}

// the mowing areas going their own way: an angle of their own, or their own way of working the direction out (which
// wins over the angle with the planner)
export function areasWithDirection(map: MowerMap | null | undefined, settings: Record<string, PlannerSetting>): AreaValue[] {
  const out: AreaValue[] = [];
  for (const a of map?.areas ?? []) {
    if (!mowed(a)) continue;
    const strategy = a.properties.planner?.angle_strategy;
    const angle = a.properties.angle;
    if (typeof strategy === 'string') out.push({id: a.id, name: nameOf(a), value: shown('angle_strategy', strategy, settings.angle_strategy)});
    else if (typeof angle === 'number') out.push({id: a.id, name: nameOf(a), value: `${(((Math.round((angle * 180) / Math.PI)) % 360) + 360) % 360}°`});
  }
  return out;
}

// obstacles, mowing areas not mowed and inactive ones with a distance of their own (margin), in place of the one for
// all of them. within: only the ones lying mostly inside this outline
export function ownMargins(map: MowerMap | null | undefined, within?: MowerMap['areas'][number]['outline']): AreaValue[] {
  const out: AreaValue[] = [];
  for (const a of map?.areas ?? []) {
    const p = a.properties;
    const keptOff = p.type === 'obstacle' || p.active === false || p.mowable === false;
    if (!keptOff || typeof p.margin !== 'number' || !Number.isFinite(p.margin)) continue;
    if (within && shareInside(a.outline, within) < 0.5) continue;
    out.push({id: a.id, name: nameOf(a), value: `${short(p.margin * 100)} cm`});
  }
  return out;
}
