'use client';

import {getMqttClient, unprefix, withPrefix} from '@/lib/mqttClient';
import {useEffect, useState} from 'react';
import {TOPIC} from '@/lib/openmower';

export interface MowerState {
  battery_percentage: number;
  gps_percentage: number;
  current_state: string;
  current_sub_state?: string;
  emergency: number;
  is_charging: number;
  rain_detected: number;
  pose: {
    x: number;
    y: number;
    heading: number;
    pos_accuracy: number;
  };
}

// cached so remounting doesn't flash "waiting"
let cachedState: MowerState | null = null;

export function useMowerState(): {state: MowerState | null; connected: boolean} {
  const [state, setState] = useState<MowerState | null>(cachedState);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const c = getMqttClient();

    const onConnect = () => {
      setConnected(true);
      c.subscribe(withPrefix(TOPIC.robotState));
    };
    const onClose = () => setConnected(false);
    const onMessage = (topic: string, payload: Buffer) => {
      if (unprefix(topic) !== TOPIC.robotState) return;
      try {
        cachedState = JSON.parse(payload.toString());
        setState(cachedState);
      } catch {
        // ignore malformed payloads
      }
    };

    c.on('connect', onConnect);
    c.on('close', onClose);
    c.on('message', onMessage);
    if (c.connected) onConnect();

    return () => {
      c.off('connect', onConnect);
      c.off('close', onClose);
      c.off('message', onMessage);
    };
  }, []);

  return {state, connected};
}
