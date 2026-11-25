'use client';

import {isObj} from '@/lib/mergeChanges';
import {topicStore} from '@/lib/mqttClient';
import {useSyncExternalStore} from 'react';
import {TOPIC} from '@/lib/openmower';

export interface SensorInfo {
  sensor_id: string;
  // MowBite OS (api 56 on): its own id, also where sensor_id is OpenMower's
  key?: string;
  sensor_name: string;
  value_type: 'STRING' | 'DOUBLE' | 'UNKNOWN';
  value_description: string;
  unit: string;
  has_min_max: boolean | 0 | 1;
  min_value: number;
  max_value: number;
  has_critical_low: boolean | 0 | 1;
  lower_critical_value: number;
  has_critical_high: boolean | 0 | 1;
  upper_critical_value: number;
}

// MowBite OS's own sensor ids for OpenMower's, which the app goes by
const OPENMOWER_ID: Record<string, string> = {
  battery_voltage: 'om_v_battery',
  charge_voltage: 'om_v_charge',
  charge_current: 'om_charge_current',
  charge_state: 'om_charge_state',
  blade_rpm: 'om_mow_motor_rpm',
  blade_current: 'om_mow_motor_current',
  blade_temp: 'om_mow_motor_temp',
  drive_left_temp: 'om_left_esc_temp',
  drive_right_temp: 'om_right_esc_temp',
  position_accuracy: 'om_gps_accuracy',
};
// charge_state under its own id, in OpenMower's words
const CHARGE_WORDS: Record<string, string> = {idle: 'Not Charging', charging: 'Fast Charge', done: 'Done'};

// the id the app goes by: OpenMower's where it has one, else the mower's own
export const sensorId = (id: string): string => OPENMOWER_ID[id] ?? id;
export const sensorValue = (id: string, value: string): string => (id === 'charge_state' ? (CHARGE_WORDS[value] ?? value) : value);

// sensor_infos/json as a list of sensors by the app's ids, anything else none
export function infosFrom(text: string): SensorInfo[] {
  const list = JSON.parse(text);
  return Array.isArray(list)
    ? list.filter((i) => isObj(i) && typeof i.sensor_id === 'string').map((i) => ({...i, sensor_id: sensorId(i.key ?? i.sensor_id)}))
    : [];
}

// kept for the whole run, sensor_infos/json is retained and comes only once
const infoStore = topicStore<SensorInfo[]>(TOPIC.sensorInfos, [], (payload) => infosFrom(payload.toString()));
// ms, when the last sensor value came (0: none yet, or no page asked for them)
let sensorsAt = 0;
const valueStore = topicStore<Record<string, string>>(TOPIC.sensorData, {}, (payload, prev, topic) => {
  const id = topic.match(/^sensors\/(.+)\/data$/)?.[1];
  if (id) sensorsAt = Date.now();
  return id ? {...prev, [sensorId(id)]: sensorValue(id, payload.toString())} : prev;
});

// the sensors come from OpenMower's monitoring, also while mower_logic isn't running
export const lastSensorAt = () => sensorsAt;

// which sensors the mower has, without their values
export const useSensorInfos = () => useSyncExternalStore(infoStore.subscribe, infoStore.get, infoStore.initial);

export function useMowerSensors(): {infos: SensorInfo[]; values: Record<string, string>} {
  const infos = useSensorInfos();
  const values = useSyncExternalStore(valueStore.subscribe, valueStore.get, valueStore.initial);
  return {infos, values};
}

// what a page needs of one sensor's value: it's only drawn again when that changes, not for every other sensor (a
// dozen of them, each about once a second). select returns something comparable with ===, e.g. a number or a boolean
export function useSensorValue<T>(id: string, select: (value: string | undefined) => T): T {
  return useSyncExternalStore(
    valueStore.subscribe,
    () => select(valueStore.get()[id]),
    () => select(undefined),
  );
}
