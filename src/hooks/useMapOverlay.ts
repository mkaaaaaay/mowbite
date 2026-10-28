'use client';

import {topicStore} from '@/lib/mqttClient';
import {useSyncExternalStore} from 'react';
import type {Point} from './useMowerMap';
import {TOPIC} from '@/lib/openmower';

// lines the mower draws on top of the map, while recording: the outline green, obstacles red and the
// one being recorded right now blue
export interface OverlayLine {
  points: Point[];
  color: string;
  closed: boolean;
}

// as xbot_monitoring sends them: {polygons: [{poly: [{x, y}], is_closed: 0|1, line_width, color}]}, null when there are none
export function parseOverlay(text: string): OverlayLine[] {
  const m: {polygons?: {poly?: Point[]; color?: string; is_closed?: number | boolean}[] | null} = JSON.parse(text);
  return (m.polygons ?? []).map((p) => ({points: p.poly ?? [], color: p.color ?? 'blue', closed: !!p.is_closed}));
}

const store = topicStore<OverlayLine[]>(TOPIC.mapOverlay, [], (payload) => parseOverlay(payload.toString()));

export function useMapOverlay(): OverlayLine[] {
  return useSyncExternalStore(store.subscribe, store.get, store.initial);
}
