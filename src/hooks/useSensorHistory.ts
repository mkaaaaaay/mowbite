'use client';

import {getMqttClient, unprefix, withPrefix} from '@/lib/mqttClient';
import {useSyncExternalStore} from 'react';

export interface Sample {
  t: number; // ms
  v: number;
}

const KEEP_MS = 60 * 60 * 1000;
const EVERY_MS = 5000;

// sensor id -> samples, oldest first. only covers the time the app has been open
let history: Record<string, Sample[]> = {};
let started = false;
const listeners = new Set<() => void>();

export function startSensorHistory() {
  if (started) return;
  started = true;
  const c = getMqttClient();
  const sub = () => c.subscribe(withPrefix('sensors/+/data'));
  c.on('connect', sub);
  if (c.connected) sub();
  c.on('message', (topic, payload) => {
    const m = unprefix(topic)?.match(/^sensors\/(.+)\/data$/);
    if (!m) return;
    const v = Number(payload.toString());
    if (!Number.isFinite(v)) return;
    const now = Date.now();
    const list = history[m[1]] ?? [];
    if (list.length && now - list[list.length - 1].t < EVERY_MS) return;
    const kept = list.length && now - list[0].t > KEEP_MS ? list.filter((s) => now - s.t <= KEEP_MS) : list;
    history = {...history, [m[1]]: [...kept, {t: now, v}]};
    listeners.forEach((l) => l());
  });
}

function subscribe(listener: () => void) {
  startSensorHistory();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: Record<string, Sample[]> = {};

export function useSensorHistory(): Record<string, Sample[]> {
  return useSyncExternalStore(
    subscribe,
    () => history,
    () => EMPTY,
  );
}
