import type {SensorInfo} from '@/hooks/useMowerSensors';
import {tr} from './i18n';

// what the dashboard's status card can show, by key: the facts in their order, then the mower's temperatures by sensor
// id. one switched off in the settings (dashboard.hidden) still shows while it warns
export const DASH_FACTS: [string, string][] = [
  ['gps', 'GPS'],
  ['speed', 'Speed'],
  ['progress', 'Progress'],
  ['charging', 'Charging'],
  ['battery', 'Battery'],
  ['rain', 'Rain'],
  ['wifi', 'Wi-Fi'],
];

// the temperatures first in this order, the others by name after them
export const TEMP_ORDER: [string, string][] = [
  ['om_mow_motor_temp', 'Mow motor'],
  ['om_mow_esc_temp', 'Mow ESC'],
  ['om_left_esc_temp', 'Left ESC'],
  ['om_right_esc_temp', 'Right ESC'],
];
export const tempLabel = (info: SensorInfo) => tr(TEMP_ORDER.find(([k]) => k === info.sensor_id)?.[1] ?? info.sensor_name);
export const isTemperature = (info: SensorInfo) => info.value_description === 'TEMPERATURE';
export const tempRank = (id: string) => {
  const i = TEMP_ORDER.findIndex(([k]) => k === id);
  return i < 0 ? TEMP_ORDER.length : i;
};

export const shown = (hidden: readonly string[] | undefined, key: string, warn?: boolean) => !!warn || !hidden?.includes(key);
