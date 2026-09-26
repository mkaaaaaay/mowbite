'use client';

import {getMqttClient, unprefix, withPrefix} from '@/lib/mqttClient';
import {callRpc} from '@/lib/rpc';
import {useSyncExternalStore} from 'react';

interface Point {
  x: number;
  y: number;
}

// min distance between trail points
const MIN_DISTANCE = 0.15;
const MAX_POINTS = 8000;

const EMPTY: Point[] = [];
let track: Point[] = EMPTY;
let started = false;
let jobId: string | null = null;

function thin(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= MIN_DISTANCE) out.push(p);
  }
  return out;
}

// what the mower recorded of this job so far, so a reload doesn't start with an empty trail
async function seed(id: string) {
  try {
    const h = await callRpc<{segments?: {points: [number, number][]}[]; buffer?: [number, number][]}>(
      'position.history',
      {job_id: id},
      20000,
    );
    if (jobId !== id) return;
    const earlier = [...(h.segments ?? []).flatMap((s) => s.points), ...(h.buffer ?? [])].map(([x, y]) => ({x, y}));
    track = thin([...earlier, ...track]).slice(-MAX_POINTS);
    listeners.forEach((l) => l());
  } catch {
    // no history on this mower, just keep the live trail
  }
}
const listeners = new Set<() => void>();

// recorded straight from mqtt so it keeps going no matter which tab is open
function start() {
  if (started) return;
  started = true;
  const c = getMqttClient();
  // position/json is much more frequent, robot_state is the fallback for setups without it
  let fast = false;
  const sub = () => c.subscribe([withPrefix('robot_state/json'), withPrefix('position/json')]);
  c.on('connect', sub);
  if (c.connected) sub();
  c.on('message', (topic, payload) => {
    const name = unprefix(topic);
    if (name === 'position/json') fast = true;
    else if (name !== 'robot_state/json' || fast) return;
    let pose: Point | undefined;
    try {
      const msg = JSON.parse(payload.toString());
      pose = name === 'position/json' ? msg : msg.pose;
      const id = name === 'position/json' ? msg.attributes?.job_id : undefined;
      if (id && id !== jobId) {
        // new job, new trail
        const first = jobId === null;
        jobId = id;
        if (!first) track = EMPTY;
        void seed(id);
      }
    } catch {
      return;
    }
    if (!pose) return;
    const last = track[track.length - 1];
    if (last && Math.hypot(pose.x - last.x, pose.y - last.y) < MIN_DISTANCE) return;
    track = [...track.slice(-(MAX_POINTS - 1)), {x: pose.x, y: pose.y}];
    listeners.forEach((l) => l());
  });
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMowerTrack(): Point[] {
  return useSyncExternalStore(
    subscribe,
    () => track,
    () => EMPTY,
  );
}
