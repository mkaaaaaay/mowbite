import type {MapArea, MowerMap, Point} from '@/hooks/useMowerMap';
import {tr} from '../i18n';
import {PARAM} from '../openmower';

// The demo mower's garden, made up: two lawns joined by a path, a few obstacles, some pictures standing by themselves
// (two lamps by the path, a gnome and a bench) and the docking station in a short bay next to the front lawn. Meters,
// like a recorded map.

// the corners cut round, like an outline driven by hand
function rounded(corners: [number, number][], r: number, steps = 4): Point[] {
  const out: Point[] = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const [bx, by] = corners[i];
    const towards = ([x, y]: [number, number]) => {
      const d = Math.hypot(x - bx, y - by);
      const k = Math.min(r, d / 2) / d;
      return {x: bx + (x - bx) * k, y: by + (y - by) * k};
    };
    const a = towards(corners[(i + n - 1) % n]);
    const c = towards(corners[(i + 1) % n]);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push({x: u * u * a.x + 2 * u * t * bx + t * t * c.x, y: u * u * a.y + 2 * u * t * by + t * t * c.y});
    }
  }
  return out.map((p) => ({x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000}));
}

const circle = (cx: number, cy: number, r: number, n = 14): Point[] =>
  Array.from({length: n}, (_, i) => ({
    x: Math.round((cx + r * Math.cos((2 * Math.PI * i) / n)) * 1000) / 1000,
    y: Math.round((cy + r * Math.sin((2 * Math.PI * i) / n)) * 1000) / 1000,
  }));

export const FRONT = 'demo-front-lawn';
export const BACK = 'demo-back-lawn';

// a picture standing by itself at x, y (app/map/editing pinSquare), drawn by its name without settings of its own
const pin = (id: string, name: string, x: number, y: number): MapArea => ({
  id,
  properties: {name, type: 'decor', pin: true},
  outline: [
    {x: x - 0.05, y: y - 0.05},
    {x: x + 0.05, y: y - 0.05},
    {x: x + 0.05, y: y + 0.05},
    {x: x - 0.05, y: y + 0.05},
  ],
});

export function demoMap(): MowerMap {
  return {
    areas: [
      {
        id: FRONT,
        properties: {name: tr('Front lawn'), type: 'mow', angle: 0.35},
        outline: rounded([[0, 0], [10, 0], [10, 4.5], [7.5, 7.5], [0, 7.5]], 0.9),
      },
      {
        id: BACK,
        properties: {name: tr('Back lawn'), type: 'mow', angle: -0.5},
        outline: rounded([[-0.5, 10], [7, 10], [8, 15], [0.5, 15.5]], 0.8),
      },
      {
        id: 'demo-path',
        properties: {name: tr('Path'), type: 'nav'},
        outline: rounded([[1.2, 7], [2.4, 7], [2.4, 10.4], [1.2, 10.4]], 0.15, 2),
      },
      {
        id: 'demo-dock-bay',
        properties: {name: tr('Dock'), type: 'nav'},
        outline: rounded([[-1.7, 3], [0.4, 3], [0.4, 4], [-1.7, 4]], 0.1, 2),
      },
      {id: 'demo-tree', properties: {name: tr('Tree'), type: 'obstacle'}, outline: circle(3.1, 2.3, 0.55)},
      {
        id: 'demo-flower-bed',
        properties: {name: tr('Flower bed'), type: 'obstacle'},
        outline: rounded([[5.5, 4.2], [7.7, 3.9], [7.9, 5], [5.7, 5.3]], 0.35),
      },
      {
        id: 'demo-sandpit',
        properties: {name: tr('Sandpit'), type: 'obstacle'},
        outline: rounded([[3.8, 11.8], [5.4, 11.8], [5.4, 13.4], [3.8, 13.4]], 0.2, 2),
      },
      pin('demo-lamp-left', tr('Garden lamp'), 0.85, 8.7),
      pin('demo-lamp-right', tr('Garden lamp'), 2.75, 8.7),
      pin('demo-gnome', tr('Garden gnome'), 10.6, 1.4),
      pin('demo-bench', tr('Bench'), -1.1, 6.3),
    ],
    docking_stations: [{id: 'demo-dock', position: {x: -1.1, y: 3.5}, heading: Math.PI}],
  };
}

// what mower_logic runs with, and a place for the weather, the sun and the aerial imagery: the middle of
// Tempelhofer Feld in Berlin, a public meadow
export const DEMO_PARAMS: Record<string, number | boolean> = {
  [PARAM.toolWidth]: 0.18,
  [PARAM.outlineCount]: 3,
  '/mower_logic/outline_overlap_count': 0,
  '/mower_logic/outline_offset': 0.1,
  [PARAM.mowAngleOffset]: 0,
  [PARAM.mowAngleOffsetIsAbsolute]: false,
  [PARAM.mowAngleIncrement]: 0,
  [PARAM.dockingApproachDistance]: 1.5,
  [PARAM.maxPositionAccuracy]: 0.2,
  [PARAM.antennaX]: -0.1,
  [PARAM.antennaY]: 0,
  '/mower_logic/gps_timeout': 10,
  '/mower_logic/gps_wait_time': 10,
  '/mower_logic/rain_mode': 2,
  '/mower_logic/rain_delay_minutes': 30,
  '/mower_logic/rain_check_seconds': 20,
  '/mower_logic/automatic_mode': 0,
  '/mower_logic/docking_distance': 2,
  '/mower_logic/docking_retry_count': 4,
  '/mower_logic/undock_distance': 1.4,
  '/mower_logic/motor_hot_temperature': 70,
  '/mower_logic/motor_cold_temperature': 40,
  '/ll/services/gps/datum_lat': 52.4735,
  '/ll/services/gps/datum_long': 13.4035,
};

const sensor = (
  id: string,
  name: string,
  what: string,
  unit: string,
  limits: {min?: number; max?: number; low?: number; high?: number} = {},
  type = 'DOUBLE',
) => ({
  sensor_id: id,
  sensor_name: name,
  value_type: type,
  value_description: what,
  unit,
  has_min_max: limits.min !== undefined || limits.max !== undefined ? 1 : 0,
  min_value: limits.min ?? 0,
  max_value: limits.max ?? 0,
  has_critical_low: limits.low !== undefined ? 1 : 0,
  lower_critical_value: limits.low ?? 0,
  has_critical_high: limits.high !== undefined ? 1 : 0,
  upper_critical_value: limits.high ?? 0,
});

// the sensors an OpenMower v2 reports (sensor_infos/json)
export const DEMO_SENSORS = [
  sensor('om_charge_current', 'Charge Current', 'CURRENT', 'A', {high: 2}),
  sensor('om_charge_state', 'Charge State', 'UNKNOWN', '', {}, 'STRING'),
  sensor('om_gps_accuracy', 'GPS Accuracy', 'UNKNOWN', 'm'),
  sensor('om_left_esc_temp', 'Left ESC Temp', 'TEMPERATURE', 'deg.C', {max: 70}),
  sensor('om_mow_esc_temp', 'Mow ESC Temp', 'TEMPERATURE', 'deg.C', {max: 70}),
  sensor('om_mow_motor_current', 'Mow Motor Current', 'CURRENT', 'A'),
  sensor('om_mow_motor_rpm', 'Mow Motor Revolutions', 'REVOLUTIONS', 'rpm', {min: 2300, max: 3800, low: 2000}),
  sensor('om_mow_motor_temp', 'Mow Motor Temp', 'TEMPERATURE', 'deg.C', {min: 40, max: 70}),
  sensor('om_right_esc_temp', 'Right ESC Temp', 'TEMPERATURE', 'deg.C', {max: 70}),
  sensor('om_v_battery', 'V Battery', 'VOLTAGE', 'V', {min: 24.5, max: 28.2, low: 23, high: 29.9}),
  sensor('om_v_charge', 'V Charge', 'VOLTAGE', 'V', {high: 34}),
];
