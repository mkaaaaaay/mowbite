'use client';

import {getMqttClient, onTopic} from '@/lib/mqttClient';
import {useSyncExternalStore} from 'react';
import {TOPIC} from '@/lib/openmower';
import {lastSensorAt, useSensorValue} from './useMowerSensors';

export interface MowerState {
  battery_percentage: number;
  gps_percentage: number;
  current_state: string;
  current_sub_state?: string;
  // while mowing: the mowing area (in map order), the path of its plan and the pose on that path, -1 otherwise
  current_area?: number;
  current_path?: number;
  current_path_index?: number;
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

export interface MowerLink {
  // the last state that came, kept while the connection is gone
  state: MowerState | null;
  connected: boolean;
  // connected, but no state for a while: ros stopped, or the wifi is gone and the socket hasn't noticed yet
  stale: boolean;
  // ms, when the last state came
  lastAt: number;
  // just back from the background and connecting again, for a few seconds that's not a lost connection
  resuming: boolean;
  // the rest of OpenMower answers (its sensors come), only mower_logic sends no state: it isn't running, starting again
  // or waiting for something (the MowBite Planner with OM_PLANNER=external)
  silent: boolean;
}

// mower_logic sends its state once a second, this long without one means none is coming
const STALE_MS = 5000;
// OpenMower starting again takes a while, mower_logic waiting for a planner gives up after 60 s
const SILENT_MS = 20000;

// no state from mower_logic for SILENT_MS (since the last one or since connecting) while the sensors still come
export function logicSilent(connected: boolean, since: number, sensorsAt: number, now = Date.now()): boolean {
  return connected && since > 0 && now - since > SILENT_MS && sensorsAt > 0 && now - sensorsAt < STALE_MS;
}

const NONE: MowerLink = {state: null, connected: false, stale: false, lastAt: 0, resuming: false, silent: false};
const RESUME_MS = 8000;
// one store for every page, so remounting doesn't flash "waiting" or "connection lost"
let link = NONE;
let started = false;
let resumedAt = 0;
let connectedAt = 0;
const listeners = new Set<() => void>();

function update(patch: Partial<MowerLink>) {
  if ((Object.keys(patch) as (keyof MowerLink)[]).every((k) => link[k] === patch[k])) return;
  link = {...link, ...patch};
  listeners.forEach((l) => l());
}

function start() {
  if (started) return;
  started = true;
  const c = getMqttClient();
  c.on('connect', () => {
    connectedAt = Date.now();
    update({connected: true});
  });
  c.on('close', () => update({connected: false}));
  if (c.connected) {
    connectedAt = Date.now();
    update({connected: true});
  }
  onTopic(TOPIC.robotState, (payload) => {
    try {
      // back once a state comes over a connection made after the return, one still queued on the old one doesn't count
      const back = link.resuming && connectedAt >= resumedAt;
      update({
        state: JSON.parse(payload.toString()),
        lastAt: Date.now(),
        stale: false,
        silent: false,
        ...(back ? {resuming: false} : {}),
      });
    } catch {
      // ignore malformed payloads
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    resumedAt = Date.now();
    update({resuming: true});
  });
  setInterval(
    () =>
      update({
        stale: !!link.state && Date.now() - link.lastAt > STALE_MS,
        resuming: link.resuming && Date.now() - resumedAt < RESUME_MS,
        // counted from the later of the last state and the connection, after connecting the sensors can come first
        silent:
          !link.resuming && logicSilent(link.connected, Math.max(link.state ? link.lastAt : 0, connectedAt), lastSensorAt()),
      }),
    1000,
  );
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMowerState(): MowerLink {
  return useSyncExternalStore(
    subscribe,
    () => link,
    () => NONE,
  );
}

// what a page needs of the state: it's only drawn again when that changes, not every second. select returns
// something comparable with ===, e.g. a boolean, or a part of the state as it came
export function useMowerStateValue<T>(select: (link: MowerLink) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(link),
    () => select(NONE),
  );
}

// in the docking station, like isDocked (lib/status): idle there and charging, or the charge voltage there while the
// charging has paused (full)
export function useDocked(): boolean {
  const idle = useMowerStateValue((l) => l.state?.current_state === 'IDLE');
  const charging = useMowerStateValue((l) => !!l.state?.is_charging);
  const voltage = useSensorValue('om_v_charge', (v) => Number(v) > 20);
  return idle && (charging || voltage);
}

// connected and the state is current: only then is what's shown real and a command goes out right away
export const isLive = (l: MowerLink) => l.connected && !l.stale;
