import {useSyncExternalStore} from 'react';
import type {PlanRequest} from './areaPlan';
import {topicStore} from './mqttClient';
import {RPC, TOPIC} from './openmower';
import {callRpc, RpcError} from './rpc';

// how far the MowBite Planner got with the planning it's at (mowbite/planner/progress, retained, at most one a second
// and one as it ends): done of of grows over the whole planning, started is unix s, estimate_s what that area's last
// planning took (null before one). stage only to show
export interface PlanningProgress {
  area_id: string;
  running: boolean;
  stage: string | null;
  done: number;
  of: number;
  started: number;
  elapsed_s: number;
  estimate_s: number | null;
  error: string | null;
}

export function readProgress(payload: string): PlanningProgress | null {
  const p = JSON.parse(payload);
  if (!p || typeof p !== 'object' || typeof p.area_id !== 'string' || typeof p.started !== 'number') return null;
  const num = (v: unknown, or: number) => (typeof v === 'number' && Number.isFinite(v) ? v : or);
  return {
    area_id: p.area_id,
    running: p.running === true,
    stage: typeof p.stage === 'string' ? p.stage : null,
    done: num(p.done, 0),
    of: Math.max(1, num(p.of, 1)),
    started: p.started,
    elapsed_s: num(p.elapsed_s, 0),
    estimate_s: typeof p.estimate_s === 'number' && p.estimate_s > 0 ? p.estimate_s : null,
    error: typeof p.error === 'string' ? p.error : null,
  };
}

const progress = topicStore<PlanningProgress | null>(TOPIC.plannerProgress, null, (payload) => readProgress(payload.toString()));

// the plans waited for under the map and not answered yet: the area (none for an outline) and since when (unix s, this
// device's clock)
export interface PlanAsked {
  areaId: string | null;
  at: number;
}
const asks = new Map<object, PlanAsked>();
const listeners = new Set<() => void>();
// the oldest one, the same object while it's the same
let oldest: PlanAsked | null = null;
function notify() {
  const first = [...asks.values()].sort((a, b) => a.at - b.at)[0] ?? null;
  if (first !== oldest) oldest = first;
  listeners.forEach((l) => l());
}

// the phone's clock and the mower's may be a few seconds apart
const CLOCK_SLACK = 10; // s

// the planning a plan asked for waits on: the same area, running (also one that started before, e.g. planned ahead, the
// request is answered from it) or finished but not started before the request
export function progressFor(p: PlanningProgress | null, ask: PlanAsked | null): PlanningProgress | null {
  if (!p || !ask?.areaId || p.area_id !== ask.areaId) return null;
  return p.running || p.started >= ask.at - CLOCK_SLACK ? p : null;
}

// a planner that hasn't answered within this asks again once the planning it was at has ended (the plan comes from its
// cache then), as long as that planning moves on
const PLAN_WAIT = 90_000;
// a running planning that didn't move on for this long has stopped
const STALLED = 180_000;

// the progress is listened to from the first plan asked for on
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  progress.subscribe(() => {});
}

// until the planning that runs ends (true) or stops moving on (false). false at once without one running
function planningEnds(): Promise<boolean> {
  return new Promise((done) => {
    let last = progress.get();
    if (!last?.running) return done(false);
    let moved = Date.now();
    const check = () => {
      const p = progress.get();
      if (!p?.running || p.started !== last?.started) return finish(true);
      if (p.done > (last?.done ?? 0)) moved = Date.now();
      last = p;
      if (Date.now() - moved > STALLED) finish(false);
    };
    const timer = setInterval(check, 1000);
    const off = progress.subscribe(check);
    const finish = (ended: boolean) => {
      clearInterval(timer);
      off();
      done(ended);
    };
  });
}

// planner.plan, waited for beyond its 90 s while the planner's progress moves on: the same request again once the
// planning it was at has ended. A planner without progress fails after 90 s as before. shown: under the map while it
// waits (not the plans worked out ahead)
export async function askPlan<T>(req: PlanRequest & {report?: boolean}, shown = true): Promise<T> {
  listen();
  const hide = shown ? showWait('area_id' in req ? req.area_id : null) : null;
  try {
    for (;;) {
      try {
        return await callRpc<T>(RPC.plannerPlan, req, PLAN_WAIT);
      } catch (e) {
        if (!(e instanceof RpcError && e.code === 'timeout') || !(await planningEnds())) throw e;
      }
    }
  } finally {
    hide?.();
  }
}

// a plan waited for under the map like one asked for, from since (unix s) on until the function returned is called:
// also one not asked yet or asked as one worked out ahead (see planAsker)
export function showWait(areaId: string | null, since = Date.now() / 1000): () => void {
  const key = {};
  asks.set(key, {areaId, at: since});
  notify();
  return () => {
    if (asks.delete(key)) notify();
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// the oldest plan waited for that the planner hasn't answered yet, null when none
export const planAsked = () => oldest;

export function usePlanAsked(): PlanAsked | null {
  return useSyncExternalStore(subscribe, planAsked, () => null);
}

export function usePlanningProgress(): PlanningProgress | null {
  return useSyncExternalStore(progress.subscribe, progress.get, progress.initial);
}
