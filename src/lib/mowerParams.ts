import {dec} from './i18n';
import {mowerFetch, apiBase} from './mowers';
import {PARAM, RPC} from './openmower';
import {callRpc} from './rpc';
import {containerFetch} from './updates';

// mower_logic's settings an app can change while the mower runs (params.set, newer OpenMower only). Which ones,
// their ranges and defaults are from MowerLogic.cfg, OpenMower doesn't tell. The ones that could hurt (the
// emergency inputs, ignoring gps errors, the mow motor switch) are left out on purpose.

export type ParamGroup = 'mowing' | 'auto' | 'gps' | 'docking' | 'motor';

export interface ParamField {
  key: string; // under /mower_logic/
  group: ParamGroup;
  label: string;
  help?: string;
  // the label and help on MowBite OS where they differ
  osLabel?: string;
  osHelp?: string;
  type: 'int' | 'double' | 'bool' | 'choice';
  // in the mower's unit
  min?: number;
  max?: number;
  def: number | boolean;
  // the range and default on MowBite OS where they differ
  osMin?: number;
  osMax?: number;
  osDef?: number;
  // shown in: the mower's value times scale, e.g. meters as cm
  unit?: string;
  scale?: number;
  step?: number;
  // for a choice, by value 0, 1, 2 ...
  choices?: string[];
  // only when the mower lists it in its params, not every mower has it
  reported?: boolean;
  // switched off only after this question
  confirmOff?: string;
}

export const PARAM_GROUPS: {key: ParamGroup; title: string}[] = [
  {key: 'mowing', title: 'Lanes and outline passes'},
  {key: 'auto', title: 'Rain and automatic mode'},
  {key: 'gps', title: 'GPS'},
  {key: 'docking', title: 'Docking'},
  {key: 'motor', title: 'Mow motor'},
];

export const PARAM_FIELDS: ParamField[] = [
  {key: 'outline_count', group: 'mowing', label: 'Outline passes', help: 'Rounds along the edge of an area and around its obstacles before the lanes. An area can have its own number.', type: 'int', min: 0, max: 20, def: 3},
  {key: 'outline_overlap_count', group: 'mowing', label: 'Overlapping passes', help: 'How many of the outline passes the lanes reach into, so nothing is left standing between the lanes and the rounds along the edge.', type: 'int', min: 0, max: 20, def: 0},
  {key: 'outline_offset', group: 'mowing', label: 'Outline offset', help: 'How far the outer pass stays inside the outline. Negative mows beyond it.', type: 'double', min: -1, max: 1, def: 0, unit: 'cm', scale: 100, step: 1},
  {key: 'tool_width', group: 'mowing', label: 'Lane spacing', help: "OpenMower's tool_width: how far the lanes are apart. Narrower than the blade, so they overlap.", type: 'double', min: 0.1, max: 2, def: 0.14, unit: 'cm', scale: 100, step: 1},
  {key: 'mow_angle_offset', group: 'mowing', label: 'Mowing direction turned by', help: "Added to every area's direction. The schedule can set it for each start time.", type: 'double', min: -180, max: 180, def: 0, unit: '°', step: 5},
  {key: 'mow_angle_offset_is_absolute', group: 'mowing', label: 'That is the direction itself, for every area', help: "Off: it's added to the direction each area has or the mower picks for it. On: all areas are mowed in that direction, counted from east.", type: 'bool', def: false},
  {key: 'mow_angle_increment', group: 'mowing', label: 'Turn further after every whole mowing run', help: 'Added each time all areas are done, so the lanes run another way next time. 0 keeps the direction.', type: 'double', min: 0, max: 180, def: 0, unit: '°', step: 5},

  {key: 'rain_mode', group: 'auto', label: 'When the rain sensor is wet', type: 'choice', def: 0, choices: ['Keep mowing', 'Go home', 'Go home and wait until dry', 'Pause automatic mode']},
  {key: 'rain_delay_minutes', group: 'auto', label: 'Wait after the rain', help: 'With "wait until dry": how long it has to be dry before it mows on.', type: 'int', min: 30, max: 1440, def: 30, unit: 'min', step: 10},
  {key: 'rain_check_seconds', group: 'auto', label: 'Rain counts after', help: 'The sensor has to be wet for this long without a break.', type: 'int', min: 20, max: 300, def: 20, unit: 's', step: 10},
  // off: it mows on after sunset, DOCKING DARK never comes (masterplan 3.1a, O11)
  {
    key: 'dock_at_sunset',
    group: 'auto',
    label: 'Go home at sunset',
    help: 'When the sun sets while it mows, it goes home. Started or continued in the dark on purpose, or at a start time allowed in the dark, it mows on. A change counts from the next mow.',
    type: 'bool',
    def: true,
    reported: true,
    confirmOff: 'Switch it off? It then mows on into the night, when hedgehogs and other animals are out.',
  },
  {key: 'automatic_mode', group: 'auto', label: 'Starting by itself', help: "OpenMower's own automatic, apart from MowBite's schedule: with a schedule leave it on manual, or both start the mower.", osHelp: "The mower's own automatic, apart from the schedule: with a schedule leave it on manual.", type: 'choice', def: 0, choices: ['Manual: only when started', 'Semi-automatic: after a start it mows the whole map, charging in between', 'Automatic: mows whenever it can']},

  {key: 'gps_timeout', group: 'gps', label: 'Mows on without a fix for 10 s plus', help: "After the fix is lost, OpenMower still takes it as good for 10 s, then the mower drives on for this long on wheel odometry, the blade still on: with 10 s for about 20 s. Then it stops with the blade off and waits for the fix.", osLabel: 'Docking waits for a good position for', osHelp: 'Mowing pauses as soon as the position is bad. Docking waits this long for a good position, then it gives up.', type: 'double', min: 0, max: 60, def: 10, osMin: 1, unit: 's', step: 1},
  {key: 'max_position_accuracy', group: 'gps', label: 'Required GPS accuracy', help: "OpenMower's max_position_accuracy: a position less accurate than this counts as no fix. An RTK fix is at a few cm.", type: 'double', min: 0.01, max: 1, def: 0.2, osMax: 0.3, osDef: 0.1, unit: 'cm', scale: 100, step: 1},
  {key: 'gps_wait_time', group: 'gps', label: 'Wait after the fix is back', type: 'double', min: 0, max: 60, def: 10, unit: 's', step: 1},

  {key: 'docking_approach_distance', group: 'docking', label: 'Approach in a straight line from', help: 'How far in front of the dock the mower lines up before it drives in.', type: 'double', min: 0, max: 5, def: 1.5, osMin: 0.5, osMax: 2, unit: 'm', step: 0.1},
  {key: 'docking_distance', group: 'docking', label: 'Drives in at most this far', help: 'How far it drives forward looking for the charging contacts.', type: 'double', min: 0, max: 100, def: 2, unit: 'm', step: 0.1},
  {key: 'docking_retry_count', group: 'docking', label: 'Retries when docking', help: 'How often it backs out and tries again before it gives up.', type: 'int', min: 0, max: 50, def: 4, osMax: 5},
  {key: 'undock_distance', group: 'docking', label: 'Backs out of the dock by', type: 'double', min: 0, max: 100, def: 2, osMin: 0.5, osMax: 2, unit: 'm', step: 0.1},

  {key: 'motor_hot_temperature', group: 'motor', label: 'Too hot to mow from', help: 'The mow motor pauses and the mower goes home.', type: 'double', min: 20, max: 150, def: 70, unit: '°C', step: 1},
  {key: 'motor_cold_temperature', group: 'motor', label: 'Cool enough again at', type: 'double', min: 20, max: 150, def: 40, unit: '°C', step: 1},
];

export const paramField = (key: string) => PARAM_FIELDS.find((f) => f.key === key);
// the field with MowBite OS's range and default on it
export const onOs = (f: ParamField, os: boolean): ParamField => (os ? {...f, min: f.osMin ?? f.min, max: f.osMax ?? f.max, def: f.osDef ?? f.def} : f);
// the ones this mower has, none of the reported ones before its params came
export const paramShown = (f: ParamField, params: Record<string, unknown>) => !f.reported || paramName(f.key) in params;
export const paramName = (key: string) => PARAM.mowerLogic(key);
// going home at sunset: whether the mower has the setting, whether it's switched off on purpose there
export const hasSunsetSwitch = (params: Record<string, unknown>) => paramShown(paramField('dock_at_sunset')!, params);
export const mowsIntoNight = (params: Record<string, unknown>) => paramValue(params, paramField('dock_at_sunset')!) === false;

// the value the mower has, or its default while the list hasn't got it (see PARAM_DEFAULTS in lib/openmower). a switch
// is 0|1 on MowBite OS
export function paramValue(params: Record<string, unknown>, f: ParamField): number | boolean {
  const v = params[paramName(f.key)];
  if (f.type === 'bool') return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : (f.def as boolean);
  return typeof v === 'number' ? v : (f.def as number);
}

// a value that doesn't go with the others the mower has: the mow motor's "too hot" has to be above "cool again", or it
// pauses and goes on in turns (MowBite OS turns that down itself, OpenMower takes it)
export function paramConflict(params: Record<string, unknown>, key: string, value: number | boolean): string | null {
  if (key !== 'motor_hot_temperature' && key !== 'motor_cold_temperature') return null;
  const temp = (k: string) => (k === key ? (value as number) : (paramValue(params, paramField(k)!) as number));
  if (temp('motor_hot_temperature') > temp('motor_cold_temperature')) return null;
  return key === 'motor_hot_temperature' ? 'It has to be above "Cool enough again at".' : 'It has to be below "Too hot to mow from".';
}

// what's typed in a field (in the unit shown, a comma for the point allowed) as the mower's value, null when
// that's no number
export function parseParam(f: ParamField, text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  if (text.trim() === '' || !Number.isFinite(n)) return null;
  const v = n / (f.scale ?? 1);
  const fit = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, v));
  return f.type === 'int' ? Math.round(fit) : Math.round(fit * 1e6) / 1e6;
}

export function showParam(f: ParamField, value: number): string {
  const shown = value * (f.scale ?? 1);
  return dec(Math.round(shown * 1000) / 1000);
}

// the mower answers with what its node took, a value out of range comes back clamped. os: MowBite OS takes only numbers,
// a switch as 0|1
export async function setParams(values: Record<string, number | boolean>, os = false): Promise<Record<string, number | boolean>> {
  const params = Object.fromEntries(Object.entries(values).map(([key, v]) => [paramName(key), os ? Number(v) : v]));
  const applied = await callRpc<Record<string, number | boolean>>(RPC.setParams, {params}, 15000);
  return Object.fromEntries(Object.entries(applied ?? {}).map(([name, v]) => [name.slice(name.lastIndexOf('/') + 1), v]));
}

// OpenMower doesn't store what's set this way. The container keeps the values set in the app and sets them again
// whenever the mower has other ones, so after its restart (docker/params.sh, /data/params.txt): "enabled 0|1" and a
// line "<full name> <value>" each
export interface KeptParams {
  enabled: boolean;
  values: Record<string, number | boolean>; // by key
}

export function parseKept(text: string): KeptParams {
  const kept: KeptParams = {enabled: true, values: {}};
  for (const line of text.split('\n')) {
    const [name, value] = line.trim().split(' ');
    if (name === 'enabled') kept.enabled = value !== '0';
    else if (name?.startsWith('/mower_logic/') && value !== undefined) {
      const v = value === 'true' ? true : value === 'false' ? false : Number(value);
      if (typeof v === 'boolean' || Number.isFinite(v)) kept.values[name.slice('/mower_logic/'.length)] = v;
    }
  }
  return kept;
}

// a number with at most 6 decimals, the container takes no more (and no exponent)
const keptValue = (v: number | boolean) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);

export const serializeKept = (k: KeptParams) =>
  [`enabled ${k.enabled ? 1 : 0}`, ...Object.entries(k.values).map(([key, v]) => `${paramName(key)} ${keptValue(v)}`), ''].join('\n');

const endpoint = () => apiBase() + '/cgi-bin/params';

// null: not served, an older container or MowBite not running as one, nothing is kept then
export async function loadKept(): Promise<KeptParams | null> {
  try {
    const res = await containerFetch(endpoint(), {cache: 'no-store'});
    if (!res?.ok || !res.headers.get('content-type')?.includes('text/plain')) return null;
    return parseKept(await res.text());
  } catch {
    return null;
  }
}

// what the container keeps then, it answers with its file (a line it doesn't take is left out). one that answers
// otherwise: what was sent
export async function saveKept(k: KeptParams): Promise<KeptParams> {
  const res = await mowerFetch(endpoint(), {method: 'POST', body: serializeKept(k)});
  if (!res.ok) throw new Error(`params ${res.status}`);
  return res.headers.get('content-type')?.includes('text/plain') ? parseKept(await res.text()) : k;
}
