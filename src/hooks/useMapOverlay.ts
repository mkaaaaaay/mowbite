'use client';

import {getMqttClient, unprefix, withPrefix} from '@/lib/mqttClient';
import {useEffect, useState} from 'react';
import type {Point} from './useMowerMap';

// lines the mower draws on top of the map, while recording: the outline green, obstacles red and the
// one being recorded right now blue
export interface OverlayLine {
  points: Point[];
  color: string;
  closed: boolean;
}

let cached: OverlayLine[] = [];

export function useMapOverlay(): OverlayLine[] {
  const [lines, setLines] = useState<OverlayLine[]>(cached);

  useEffect(() => {
    const c = getMqttClient();
    const onConnect = () => c.subscribe(withPrefix('map_overlay/json'));
    const onMessage = (topic: string, payload: Buffer) => {
      if (unprefix(topic) !== 'map_overlay/json') return;
      try {
        const m: {polygons?: {polygon?: {points?: Point[]}; color?: string; closed?: boolean}[]} = JSON.parse(payload.toString());
        cached = (m.polygons ?? []).map((p) => ({points: p.polygon?.points ?? [], color: p.color ?? 'blue', closed: !!p.closed}));
        setLines(cached);
      } catch {
        // ignore malformed payloads
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

  return lines;
}
