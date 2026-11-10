'use client';

import {forgetJobList, loadJobList} from '@/hooks/useMowHistory';
import {getMqttClient, onTopic} from '@/lib/mqttClient';
import {readMower, writeMower} from '@/lib/mowers';
import {callRpc} from '@/lib/rpc';
import {useSyncExternalStore} from 'react';
import {RPC, TOPIC} from '@/lib/openmower';

export interface Point {
  x: number;
  y: number;
  // blades running at that point, false = just driving
  b?: boolean;
}

// min distance between trail points, and how far a point may be off the line through its neighbours to get dropped
// (straight stripes need only their ends)
const MIN_DISTANCE = 0.03;
const STRAIGHT = 0.005;
const MAX_POINTS = 30000;
// the trail is kept in pieces of this many points. finished pieces never change, so each new position only
// touches the last one and the map only draws that again, a short stretch, however long the job is
const CHUNK = 120;
// at most this often the map gets told about new points, positions come in several times a second
const NOTIFY_MS = 200;

// the pieces in order, the last one is still growing. each piece starts with the last point of the one before,
// so they join up when drawn
export type TrackChunks = readonly Point[][];
const EMPTY: TrackChunks = [];
let track: TrackChunks = EMPTY;
let started = false;
let jobId: string | null = null;
// while no job runs (OpenMower drops the job id once it's done), the last one recorded: its trail stays until the
// next job starts. at: when it started, unix seconds
let lastJob: {id: string; at: number} | null = null;
// when the last one was asked for (ms), again a while later when the list didn't come
let askedLast = 0;
const ASK_AGAIN_MS = 30000;
// the job the trail is of
const shownJob = () => jobId ?? lastJob?.id ?? null;
let blades: boolean | undefined;
// what came in live while the recorded track was loading
let whileLoading: Point[] = [];

// whether b lies on the line from a to c
function straight(a: Point, b: Point, c: Point) {
  if (a.b !== b.b || b.b !== c.b) return false;
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return true;
  // and between them, not a turn back
  const t = ((b.x - a.x) * dx + (b.y - a.y) * dy) / (len * len);
  return t >= 0 && t <= 1 && Math.abs(dy * (b.x - a.x) - dx * (b.y - a.y)) / len < STRAIGHT;
}

// the points a trail's last point stands in for, dropped since the one before it: a new point only takes its place if
// they all stay on the line too, so a curve keeps its shape instead of being cut short bit by bit
const dropped = new WeakMap<Point, Point[]>();
// a long straight run is kept at some point, to bound the checks
const MAX_RUN = 500;

// appends p to out, in place
function add(out: Point[], p: Point) {
  const last = out[out.length - 1];
  if (last && last.b === p.b && Math.hypot(p.x - last.x, p.y - last.y) < MIN_DISTANCE) return;
  if (out.length >= 2) {
    const from = out[out.length - 2];
    const run = dropped.get(last) ?? [];
    if (run.length < MAX_RUN && straight(from, last, p) && run.every((q) => straight(from, q, p))) {
      run.push(last);
      dropped.delete(last);
      dropped.set(p, run);
      out[out.length - 1] = p;
      return;
    }
  }
  dropped.delete(p);
  out.push(p);
}

export function thin(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) add(out, p);
  return out;
}

export function chunked(points: Point[]): TrackChunks {
  if (!points.length) return EMPTY;
  const out: Point[][] = [];
  for (let i = 0; ; i += CHUNK - 1) {
    out.push(points.slice(i, i + CHUNK));
    if (i + CHUNK >= points.length) break;
  }
  return out;
}

export function trackPoints(chunks: TrackChunks) {
  return chunks.reduce((n, c, i) => n + c.length - (i ? 1 : 0), 0);
}

// the trail with p added to the growing piece, null when it doesn't change anything
export function appendPoint(chunks: TrackChunks, p: Point, maxPoints = MAX_POINTS): TrackChunks | null {
  const tail = chunks[chunks.length - 1];
  if (!tail) return [[p]];
  const next = tail.slice();
  const last = next[next.length - 1];
  const before = next.length;
  add(next, p);
  if (next.length === before && next[next.length - 1] === last) return null;
  const out = chunks.slice(0, -1);
  if (next.length > CHUNK) out.push(next.slice(0, CHUNK), next.slice(CHUNK - 1));
  else out.push(next);
  // the oldest pieces go first once there are too many points
  let total = trackPoints(out);
  while (out.length > 1 && total > maxPoints) total -= out.shift()!.length - 1;
  return out;
}

function append(p: Point): boolean {
  const next = appendPoint(track, p);
  if (!next) return false;
  track = next;
  return true;
}

let notifyTimer: ReturnType<typeof setTimeout> | null = null;
function notifySoon() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    listeners.forEach((l) => l());
  }, NOTIFY_MS);
}

// what the mower recorded of this job so far, so a reload doesn't start with an empty trail. again after the
// connection was gone (phone asleep, app in the background), the live trail misses that part
let loading = false;

type Recorded = {segments?: {points: [number, number][]; attributes?: {blades?: boolean}}[]; buffer?: [number, number][]};

// the points of a recorded track, and how many of them the mower has written for good: those only grow, the buffer
// after them is thinned out once it's written
export function recordedPoints(h: Recorded, bladesNow: boolean | undefined): {points: Point[]; written: number} {
  const done = (h.segments ?? []).flatMap((s) => s.points.map(([x, y]) => ({x, y, b: s.attributes?.blades})));
  // the buffer is the segment still being written, so it has the current blade state
  return {points: [...done, ...(h.buffer ?? []).map(([x, y]) => ({x, y, b: bladesNow}))], written: done.length};
}

// of the job asked for last: how many of its points were written for good then
let written: {job: string; points: number} | null = null;

async function recordedTrack(id: string): Promise<Point[]> {
  const r = recordedPoints(await callRpc<Recorded>(RPC.jobTrack, {job_id: id}, 20000), blades);
  written = {job: id, points: r.written};
  return r.points;
}

// cleared by hand: the job and how many of its recorded points were written for good then, only later ones are shown.
// per device and mower, the recording on the mower stays as it is
const CLEARED_KEY = 'trackCleared';
function clearedUpTo(id: string): number {
  const c = readMower<{job?: unknown; points?: unknown}>(CLEARED_KEY);
  return c?.job === id && typeof c.points === 'number' ? c.points : 0;
}

async function seed(id: string) {
  if (loading) return;
  loading = true;
  whileLoading = [];
  try {
    const recorded = (await recordedTrack(id)).slice(clearedUpTo(id));
    if (shownJob() !== id) return;
    // the recorded track replaces what was here, only what came in live while it loaded goes on top
    track = chunked(thin([...recorded, ...whileLoading]).slice(-MAX_POINTS));
    listeners.forEach((l) => l());
  } catch {
    // no history on this mower, just keep the live trail
  } finally {
    loading = false;
  }
}
const listeners = new Set<() => void>();

// a trail stays when it's of the job that comes in (one resumed, or the last run that goes on) or of none yet: the
// live points so far, the recorded track replaces them anyway
export function keepsTrail(shown: string | null, next: string): boolean {
  return shown === null || shown === next;
}

// what a position's job id means for the trail: 'new' a job started (or another one), 'ended' the one running is over,
// its trail stays as the last run, 'last' none runs and the last one is to be asked for
export function jobChange(running: string | null, id: string | undefined, last: string | null, askedAt: number, now: number) {
  if (id) return id === running ? null : 'new';
  if (running !== null) return 'ended';
  return last === null && now - askedAt >= ASK_AGAIN_MS ? 'last' : null;
}

// the newest recorded job, shown while the mower is idle until the next one starts
async function showLastJob() {
  const [last] = await loadJobList();
  if (!last || jobId !== null) return;
  lastJob = {id: last.job_id, at: last.timestamp};
  await seed(last.job_id);
}

// recorded straight from mqtt so it keeps going no matter which tab is open
function start() {
  if (started) return;
  started = true;
  const c = getMqttClient();
  // position/json is much more frequent, robot_state is the fallback for setups without it
  let fast = false;
  // after a reconnect the trail of the time without connection comes from the recorded track
  const reseed = () => {
    const id = shownJob();
    if (id) void seed(id);
  };
  c.on('connect', reseed);
  // a phone keeps the connection a while in the background but gets no messages, so also when the page is back
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reseed();
  });
  const onPose = (payload: Buffer, name: string) => {
    if (name === TOPIC.position) fast = true;
    else if (name !== TOPIC.robotState || fast) return;
    let pose: Point | undefined;
    try {
      const msg = JSON.parse(payload.toString());
      pose = name === TOPIC.position ? msg : msg.pose;
      const id = name === TOPIC.position ? msg.attributes?.job_id : undefined;
      if (name === TOPIC.position) blades = msg.attributes?.blades;
      const change = name === TOPIC.position ? jobChange(jobId, id, lastJob?.id ?? null, askedLast, Date.now()) : null;
      if (change === 'new') {
        // new job, new trail
        if (!keepsTrail(shownJob(), id)) track = EMPTY;
        jobId = id;
        lastJob = null;
        listeners.forEach((l) => l());
        // the list of recorded jobs has it now
        forgetJobList();
        void seed(id);
      } else if (change) {
        if (change === 'ended') {
          jobId = null;
          listeners.forEach((l) => l());
        }
        askedLast = Date.now();
        void showLastJob();
      }
    } catch {
      return;
    }
    if (!pose) return;
    if (loading) whileLoading.push({x: pose.x, y: pose.y, b: blades});
    if (append({x: pose.x, y: pose.y, b: blades})) notifySoon();
  };
  onTopic(TOPIC.robotState, onPose);
  onTopic(TOPIC.position, onPose);
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// empties the live trail, it starts again from the mower's position now
export async function clearTrack() {
  const id = shownJob();
  if (id) {
    // the number seen last when the mower doesn't answer now
    await recordedTrack(id).catch(() => null);
    if (written?.job === id) writeMower(CLEARED_KEY, written);
  }
  track = EMPTY;
  whileLoading = [];
  listeners.forEach((l) => l());
}

// when the trail shown is the last run because none runs now: when that one started (unix seconds), else null
export function useLastRun(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => (jobId === null ? (lastJob?.at ?? null) : null),
    () => null,
  );
}

// the job of the last run while that one's trail is shown, else null
export function useLastRunJob(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (jobId === null ? (lastJob?.id ?? null) : null),
    () => null,
  );
}

// the job the trail shown is of: the one running, or the last one while none runs
export function useTrailJob(): string | null {
  return useSyncExternalStore(subscribe, shownJob, () => null);
}

// the job the mower says it's on (waiting in the dock included), null with none or before it said
export function useRunningJob(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => jobId,
    () => null,
  );
}

export function useMowerTrack(): TrackChunks {
  return useSyncExternalStore(
    subscribe,
    () => track,
    () => EMPTY,
  );
}
