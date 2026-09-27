'use client';

import {getMqttClient, unprefix, withPrefix} from '@/lib/mqttClient';
import {callRpc} from '@/lib/rpc';
import {useSyncExternalStore} from 'react';
import {RPC, TOPIC} from '@/lib/openmower';

interface Point {
  x: number;
  y: number;
  // blades running at that point, false = just driving
  b?: boolean;
}

// min distance between trail points
const MIN_DISTANCE = 0.15;
const MAX_POINTS = 8000;

const EMPTY: Point[] = [];
let track: Point[] = EMPTY;
let started = false;
let jobId: string | null = null;
let blades: boolean | undefined;

function thin(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.b !== p.b || Math.hypot(p.x - last.x, p.y - last.y) >= MIN_DISTANCE) out.push(p);
  }
  return out;
}

// what the mower recorded of this job so far, so a reload doesn't start with an empty trail
async function seed(id: string) {
  try {
    const h = await callRpc<{
      segments?: {points: [number, number][]; attributes?: {blades?: boolean}}[];
      buffer?: [number, number][];
    }>(
      RPC.jobTrack,
      {job_id: id},
      20000,
    );
    if (jobId !== id) return;
    // the buffer is the segment still being written, so it has the current blade state
    const earlier = [
      ...(h.segments ?? []).flatMap((s) => s.points.map(([x, y]) => ({x, y, b: s.attributes?.blades}))),
      ...(h.buffer ?? []).map(([x, y]) => ({x, y, b: blades})),
    ];
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
  const sub = () => c.subscribe([withPrefix(TOPIC.robotState), withPrefix(TOPIC.position)]);
  c.on('connect', sub);
  if (c.connected) sub();
  c.on('message', (topic, payload) => {
    const name = unprefix(topic);
    if (name === TOPIC.position) fast = true;
    else if (name !== TOPIC.robotState || fast) return;
    let pose: Point | undefined;
    try {
      const msg = JSON.parse(payload.toString());
      pose = name === TOPIC.position ? msg : msg.pose;
      const id = name === TOPIC.position ? msg.attributes?.job_id : undefined;
      if (name === TOPIC.position) blades = msg.attributes?.blades;
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
    if (last && last.b === blades && Math.hypot(pose.x - last.x, pose.y - last.y) < MIN_DISTANCE) return;
    track = [...track.slice(-(MAX_POINTS - 1)), {x: pose.x, y: pose.y, b: blades}];
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
