'use client';

import {onTopic} from '@/lib/mqttClient';
import {useSyncExternalStore} from 'react';
import {TOPIC} from '@/lib/openmower';

export interface Position {
  x: number;
  y: number;
  heading: number;
}

// position/json comes ~7x a second, robot_state only once, so the marker glides instead of jumping. A mower standing
// still (in the dock) wobbles by a centimetre with the gps: that's no news, the pages would draw the map again and
// again for nothing
const MOVED = 0.02; // m
const TURNED = (2 * Math.PI) / 180;
let position: Position | null = null;
let started = false;
const listeners = new Set<() => void>();

function start() {
  if (started) return;
  started = true;
  onTopic(TOPIC.position, (payload) => {
    let p: Position;
    try {
      const raw = JSON.parse(payload.toString());
      if (typeof raw.x !== 'number' || typeof raw.y !== 'number') return;
      p = {x: raw.x, y: raw.y, heading: raw.heading ?? 0};
    } catch {
      return;
    }
    const turned = position ? Math.abs(Math.atan2(Math.sin(p.heading - position.heading), Math.cos(p.heading - position.heading))) : Infinity;
    if (position && Math.hypot(p.x - position.x, p.y - position.y) < MOVED && turned < TURNED) return;
    position = p;
    listeners.forEach((l) => l());
  });
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// null if the mower doesn't publish position/json (older setups), use robot_state's pose then
export function useMowerPosition(): Position | null {
  return useSyncExternalStore(
    subscribe,
    () => position,
    () => null,
  );
}
