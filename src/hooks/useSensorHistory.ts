'use client';

import {onTopic} from '@/lib/mqttClient';
import {useSyncExternalStore} from 'react';
import {apiBase} from '@/lib/mowers';
import {RPC, TOPIC} from '@/lib/openmower';
import {callRpc, rpcMethods} from '@/lib/rpc';
import {containerFetch} from '@/lib/updates';

export interface Sample {
  t: number; // ms
  v: number;
  // lowest and highest value in the recorder's 5 min bucket
  lo?: number;
  hi?: number;
}

const KEEP_MS = 60 * 60 * 1000;
const EVERY_MS = 5000;
// the recorder's file is some 150 kB, asked for again this often while it's shown
const DAY_EVERY_MS = 5 * 60 * 1000;
// how far back MowBite OS keeps them, and the recorder's step
const OS_KEEP_MS = 48 * 60 * 60 * 1000;
const RECORDER_STEP_MS = 300000;

// sensor id -> samples, oldest first. only covers the time the app has been open
let live: Record<string, Sample[]> = {};
// the buckets kept on the mower: 48 h from MowBite OS (sensors.history), else 24 h from the container's recorder
// (docker/recorder.sh), empty when there are none
let day: Record<string, Sample[]> = {};
// how long one of them is, ms
let stepMs = RECORDER_STEP_MS;
// both together: recorded buckets up to where the live samples start
let history: Record<string, Sample[]> = {};

// only: the one sensor that changed, the others keep theirs
function merge(only?: string) {
  const next: Record<string, Sample[]> = only ? {...history} : {};
  for (const id of only ? [only] : new Set([...Object.keys(live), ...Object.keys(day)])) {
    const l = live[id] ?? [];
    const start = l.length ? l[0].t : Infinity;
    next[id] = [...(day[id] ?? []).filter((b) => b.t + stepMs <= start), ...l];
  }
  history = next;
  listeners.forEach((f) => f());
}

// the answer of sensors.history: t the start of a step in unix s, a step without values is left out
export interface OsHistory {
  step: number;
  from: number;
  to: number;
  truncated: boolean;
  sensors: {sensor_id: string; points: unknown[]}[];
}

// MowBite OS's buckets added to those known: from its from on they are the answer's (the one going on came again),
// older ones stay while they're within 48 h. another step starts anew
export function addOsHistory(known: Record<string, Sample[]>, knownStep: number, h: OsHistory, now: number): Record<string, Sample[]> {
  const from = h.from * 1000;
  const keep = h.step * 1000 === knownStep ? known : {};
  const next: Record<string, Sample[]> = {};
  for (const [id, list] of Object.entries(keep)) next[id] = list.filter((b) => b.t < from && now - b.t <= OS_KEEP_MS);
  for (const sensor of h.sensors) {
    const points = sensor.points.flatMap((p) => {
      const [t, lo, v, hi] = Array.isArray(p) ? p : [];
      return [t, lo, v, hi].every(Number.isFinite) ? [{t: t * 1000, v, lo, hi}] : [];
    });
    next[sensor.sensor_id] = [...(next[sensor.sensor_id] ?? []), ...points];
  }
  return next;
}

type Kept = {buckets: Record<string, Sample[]>; step: number};

// MowBite OS: all of them the first time (up to some 900 kB, a slow link takes a while), then from the start of the
// newest bucket on
async function loadOs(): Promise<Kept | undefined> {
  const newest = Math.max(0, ...Object.values(day).map((l) => (l.length ? l[l.length - 1].t : 0)));
  const params = {client: 'app', ...(newest ? {from: Math.floor(newest / 1000)} : {})};
  const h = await callRpc<OsHistory>(RPC.sensorsHistory, params, newest ? 10000 : 60000);
  if (!h || !Array.isArray(h.sensors) || !(h.step > 0)) return undefined;
  return {buckets: addOsHistory(day, stepMs, h, Date.now()), step: h.step * 1000};
}

// the container's recorder
async function loadRecorder(): Promise<Kept | undefined> {
  const res = await containerFetch(`${apiBase()}/cgi-bin/sensors`, {cache: 'no-store'});
  if (!res?.ok || !res.headers.get('content-type')?.includes('text/plain')) return undefined;
  const next: Record<string, Sample[]> = {};
  for (const line of (await res.text()).split('\n')) {
    const [id, t, lo, hi, v] = line.split('\t');
    if (!v) continue;
    (next[id] ??= []).push({t: +t * 1000, v: +v, lo: +lo, hi: +hi});
  }
  for (const list of Object.values(next)) list.sort((a, b) => a.t - b.t);
  return {buckets: next, step: RECORDER_STEP_MS};
}

async function loadDay() {
  try {
    const kept = (await rpcMethods())?.has(RPC.sensorsHistory) ? await loadOs() : await loadRecorder();
    if (!kept) return;
    day = kept.buckets;
    stepMs = kept.step;
    dayAt = Date.now();
    merge();
  } catch {
    // not now or not served, the next round asks again
  }
}
let started = false;
let dayAt = 0;
let dayTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

// the live values, from the start on whichever page is open
export function startSensorHistory() {
  if (started) return;
  started = true;
  onTopic(TOPIC.sensorData, (payload, topic) => {
    const m = topic.match(/^sensors\/(.+)\/data$/);
    if (!m) return;
    const v = Number(payload.toString());
    if (!Number.isFinite(v)) return;
    const now = Date.now();
    const list = live[m[1]] ?? [];
    if (list.length && now - list[list.length - 1].t < EVERY_MS) return;
    const kept = list.length && now - list[0].t > KEEP_MS ? list.filter((s) => now - s.t <= KEEP_MS) : list;
    live = {...live, [m[1]]: [...kept, {t: now, v}]};
    merge(m[1]);
  });
}

// the recorded buckets only while someone looks at them, a slow link to the mower shouldn't carry them all the time
function subscribe(listener: () => void) {
  startSensorHistory();
  listeners.add(listener);
  if (!dayTimer) {
    if (Date.now() - dayAt > DAY_EVERY_MS) void loadDay();
    dayTimer = setInterval(loadDay, DAY_EVERY_MS);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && dayTimer) {
      clearInterval(dayTimer);
      dayTimer = null;
    }
  };
}

// the mower keeps them, the curves reach back further than the app has been open
export const keptOnMower = () => Object.keys(day).length > 0;

const EMPTY: Record<string, Sample[]> = {};

export function useSensorHistory(): Record<string, Sample[]> {
  return useSyncExternalStore(
    subscribe,
    () => history,
    () => EMPTY,
  );
}
