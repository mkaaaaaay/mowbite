import type {Point} from '@/hooks/useMowerMap';
import type {PlanRequest} from './areaPlan';
import {RPC} from './openmower';
import type {Pose} from './poseEaser';
import {callRpc, rpcMethods} from './rpc';

// The MowBite Planner drives a plan the way the mower would (planner.simulate): OpenMower's controller and mower_logic
// on a mower with the errors of gps, odometry and drive, set after real runs. What it left, where the body got into the
// margin, where the controller would have given up, how long it took, and the drive second by second to play it back

// realistic: the errors of a real mower, ideal: one that drives exactly
export type SimModel = 'realistic' | 'ideal';

// [t s from the start, x, y, yaw, blades 1/0], where it really was (not where it believed it was)
export type SimFrame = [number, number, number, number, number];

export interface SimResult {
  // min: the whole drive, mow: with the blades on, plan: what the planner's estimate says
  minutes: {all: number; mow: number; plan?: number};
  drivenM: number;
  mowedM2: number;
  // m² left unmowed after the drive, in pieces, and what the plan alone would leave
  leftM2: number;
  plannedLeftM2?: number;
  left: {m2: number; outline: Point[]}[];
  // where the body got into the margin, m how far, the worst first
  touches: {x: number; y: number; m: number}[];
  // where the controller would have given up
  navErrors: Point[];
  // mower_logic would have given up the area
  aborted: boolean;
  // m off the plan: on the lanes (p50, p95) and at most anywhere
  offPlan?: {usual: number; p95: number; max: number};
  spins: number;
  frames: SimFrame[];
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const pt = (v: unknown): Point | null => (Array.isArray(v) && num(v[0]) !== undefined && num(v[1]) !== undefined ? {x: v[0], y: v[1]} : null);

export function readSimulation(answer: unknown): SimResult {
  const a = (answer ?? {}) as Record<string, unknown>;
  const duration = (a.duration ?? {}) as Record<string, unknown>;
  const body = (a.body ?? {}) as Record<string, unknown>;
  const tracking = (a.tracking ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const left = (Array.isArray(a.left) ? a.left : []).flatMap((l: {m2?: unknown; outline?: unknown}) => {
    const outline = (Array.isArray(l?.outline) ? l.outline : []).map(pt).filter((p): p is Point => !!p);
    return outline.length >= 3 ? [{m2: num(l.m2) ?? 0, outline}] : [];
  });
  const touches = (Array.isArray(body.places) ? body.places : []).flatMap((p: unknown) => {
    const at = pt(p);
    return at ? [{...at, m: num((p as number[])[2]) ?? 0}] : [];
  });
  const kinds = ['lane', 'perimeter', 'turn', 'transit'].map((k) => tracking[k]).filter((t): t is Record<string, unknown> => !!t);
  const maxOf = (key: string) => Math.max(...kinds.map((t) => num(t[key]) ?? 0));
  const frames = (Array.isArray(a.playback) ? a.playback : []).filter(
    (f: unknown): f is SimFrame => Array.isArray(f) && f.length >= 5 && f.slice(0, 5).every((v) => num(v) !== undefined),
  );
  return {
    minutes: {all: num(duration.min) ?? 0, mow: num(duration.mow_min) ?? 0, plan: num(duration.model_min)},
    drivenM: num(a.driven_m) ?? 0,
    mowedM2: num(a.mowed_m2) ?? 0,
    leftM2: num(a.left_m2) ?? 0,
    plannedLeftM2: num(a.planned_left_m2),
    left,
    touches,
    navErrors: (Array.isArray(a.nav_errors) ? a.nav_errors : []).map(pt).filter((p): p is Point => !!p),
    aborted: a.aborted === true,
    offPlan: kinds.length
      ? {usual: num(tracking.lane?.p50) ?? maxOf('p50'), p95: num(tracking.lane?.p95) ?? maxOf('p95'), max: maxOf('max')}
      : undefined,
    spins: num(a.spins) ?? 0,
    frames,
  };
}

// the plan of the area asked for driven once (the same request as planner.plan: the area as saved or as edited). On the
// mower that takes a while, about half a minute for ten minutes of mowing
export async function simulate(req: PlanRequest, model: SimModel): Promise<SimResult> {
  return readSimulation(await callRpc(RPC.plannerSimulate, {...req, model, playback: 1}, 6 * 60_000));
}

// how far the one running got (phase, 0 to 1), when the planner tells
export async function simulationProgress(): Promise<{phase: string; fraction: number} | null> {
  if (!(await rpcMethods())?.has(RPC.plannerSimulateStatus)) return null;
  const s = (await callRpc(RPC.plannerSimulateStatus, {}, 5000)) as {running?: unknown; phase?: unknown; fraction?: unknown};
  return s?.running ? {phase: typeof s.phase === 'string' ? s.phase : '', fraction: num(s.fraction) ?? 0} : null;
}

export async function canCancelSimulation(): Promise<boolean> {
  return !!(await rpcMethods())?.has(RPC.plannerSimulateCancel);
}

export async function cancelSimulation(): Promise<void> {
  await callRpc(RPC.plannerSimulateCancel, {}, 5000);
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// where it was at t s, between the frames around it
export function poseAt(frames: readonly SimFrame[], t: number): Pose | null {
  if (!frames.length) return null;
  let lo = 0;
  let hi = frames.length - 1;
  if (t <= frames[0][0]) return {x: frames[0][1], y: frames[0][2], heading: frames[0][3]};
  if (t >= frames[hi][0]) return {x: frames[hi][1], y: frames[hi][2], heading: frames[hi][3]};
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const f = (t - a[0]) / (b[0] - a[0] || 1);
  return {x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f, heading: a[3] + wrap(b[3] - a[3]) * f};
}

// the frames up to t s: how many lie at or before it
export function framesUntil(frames: readonly SimFrame[], t: number): number {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid][0] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const SIM_SPEEDS = [10, 30, 60, 120];

// The drive played back: the time it's at (s) runs at speed times real time while playing. Shows the mower like the live
// poses do (at, still, listen: MapView's mower moves every frame without a render), the player reads it through
// snapshot/subscribe
export type SimClock = ReturnType<typeof createSimClock>;
export function createSimClock(frames: readonly SimFrame[]) {
  const end = frames.length ? frames[frames.length - 1][0] : 0;
  let base = 0;
  let since = 0;
  let playing = false;
  let speed = 30;
  let snap = {playing, speed, base};
  const listeners = new Set<() => void>();
  const time = (now = performance.now()) => (playing ? Math.min(end, base + ((now - since) / 1000) * speed) : base);
  const changed = () => {
    snap = {playing, speed, base};
    for (const f of listeners) f();
  };
  return {
    end,
    time,
    at: (now: number) => poseAt(frames, time(now)),
    still: (now: number) => !playing || time(now) >= end,
    listen(f: () => void) {
      listeners.add(f);
      return () => void listeners.delete(f);
    },
    // (for useSyncExternalStore: the same object until something changes)
    snapshot: () => snap,
    play() {
      if (playing && time() < end) return;
      base = time() >= end ? 0 : time();
      since = performance.now();
      playing = true;
      changed();
    },
    pause() {
      base = time();
      playing = false;
      changed();
    },
    seek(t: number) {
      base = Math.min(end, Math.max(0, t));
      since = performance.now();
      changed();
    },
    setSpeed(s: number) {
      base = time();
      since = performance.now();
      speed = s;
      changed();
    },
  };
}
