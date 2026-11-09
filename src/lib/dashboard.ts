import type {SensorInfo} from '@/hooks/useMowerSensors';
import {tr} from './i18n';

// what the dashboard's status card can show, by key: the facts in their order, then the mower's temperatures by sensor
// id. one switched off in the settings (dashboard.hidden) still shows while it warns
export const DASH_FACTS = [
  ['gps', 'GPS'],
  ['speed', 'Speed'],
  ['progress', 'Progress'],
  ['charging', 'Charging'],
  ['battery', 'Battery'],
  ['rain', 'Rain'],
  ['wifi', 'Wi-Fi'],
] as const;
export type DashKey = (typeof DASH_FACTS)[number][0];

// the temperatures first in this order (the blade side, then the wheels), the others by name after them
const TEMP_ORDER: [string, string][] = [
  ['om_mow_motor_temp', 'Mow motor'],
  ['om_mow_esc_temp', 'Mow ESC'],
  ['om_left_esc_temp', 'Left ESC'],
  ['om_right_esc_temp', 'Right ESC'],
];
export const isTemperature = (info: SensorInfo) => info.value_description === 'TEMPERATURE';
export const tempRank = (id: string) => {
  const i = TEMP_ORDER.findIndex(([k]) => k === id);
  return i < 0 ? TEMP_ORDER.length : i;
};
// the mower's temperatures in that order, with their names
export const tempItems = (infos: SensorInfo[]) =>
  infos
    .filter(isTemperature)
    .map((info) => ({info, key: info.sensor_id, label: tr(TEMP_ORDER.find(([k]) => k === info.sensor_id)?.[1] ?? info.sensor_name)}))
    .sort((a, b) => tempRank(a.key) - tempRank(b.key) || a.label.localeCompare(b.label));

export const shown = (hidden: readonly string[] | undefined, key: string, warn?: boolean) => !!warn || !hidden?.includes(key);
