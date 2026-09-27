'use client';

import {getMqttClient, unprefix, withPrefix} from '@/lib/mqttClient';
import {useEffect, useState} from 'react';
import {TOPIC} from '@/lib/openmower';

export interface SensorInfo {
  sensor_id: string;
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

// module level cache, sensor_infos/json is retained and won't come again on remount
let cachedInfos: SensorInfo[] = [];
let cachedValues: Record<string, string> = {};

export function useMowerSensors(): {infos: SensorInfo[]; values: Record<string, string>} {
  const [infos, setInfos] = useState<SensorInfo[]>(cachedInfos);
  const [values, setValues] = useState<Record<string, string>>(cachedValues);

  useEffect(() => {
    const c = getMqttClient();

    const onConnect = () => {
      c.subscribe(withPrefix(TOPIC.sensorInfos));
      c.subscribe(withPrefix(TOPIC.sensorData));
    };
    const onMessage = (fullTopic: string, payload: Buffer) => {
      const topic = unprefix(fullTopic);
      if (topic === TOPIC.sensorInfos) {
        try {
          cachedInfos = JSON.parse(payload.toString());
          setInfos(cachedInfos);
        } catch {
          // ignore malformed payloads
        }
        return;
      }
      const match = topic?.match(/^sensors\/(.+)\/data$/);
      if (match) {
        const sensorId = match[1];
        cachedValues = {...cachedValues, [sensorId]: payload.toString()};
        setValues(cachedValues);
      }
    };

    c.on('connect', onConnect);
    c.on('message', onMessage);
    if (c.connected) onConnect();

    return () => {
      c.off('connect', onConnect);
      c.off('message', onMessage);
    };
  }, []);

  return {infos, values};
}
