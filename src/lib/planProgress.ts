import type {Point} from '@/hooks/useMowerMap';
import type {MowerEvent} from './events';

// The mower's plan for an area (mowing.plan) split at where it is: the robot state has the path it's on and the
// index of the pose in that path (current_path, current_path_index). The plan comes simplified, pose_index says which
// pose of the full path each point was.

export interface PlanPath {
  outline: boolean;
  points: Point[];
  index?: number[]; // pose index per point, rising. without it there's no telling how far the mower got
  // what the stretches of the path are (the MowBite Planner tells): an outline pass, a lane, a turn between lanes or
  // a drive between the parts, start and end are pose indices
  segments?: PlanSegment[];
}

export type SegmentType = 'perimeter' | 'lane' | 'turn' | 'transit';
export interface PlanSegment {
  type: SegmentType;
  start: number;
  end: number;
}

// a path's points cut into pieces by what they are, from its segments and pose_index. The stretch from one point to
// the next is what the segment its first pose lies in says, stretches of a kind in a row are one piece, and the point
// where a piece ends starts the next so the line goes on. Without segments the whole path is one piece: perimeter
// for an outline pass, lane otherwise
export function planPieces(p: PlanPath): {type: SegmentType; points: Point[]}[] {
  if (!p.points.length) return [];
  if (!p.segments?.length || !p.index || p.index.length !== p.points.length) return [{type: p.outline ? 'perimeter' : 'lane', points: p.points}];
  const segs = [...p.segments].sort((a, b) => a.start - b.start);
  const typeAt = (pose: number) => {
    let found = segs[0];
    for (const s of segs) if (s.start <= pose) found = s;
    return found.type;
  };
  const out: {type: SegmentType; points: Point[]}[] = [];
  for (let i = 1; i < p.points.length; i++) {
    const t = typeAt(p.index[i - 1]);
    const last = out[out.length - 1];
    if (last && last.type === t) last.points.push(p.points[i]);
    else out.push({type: t, points: [p.points[i - 1], p.points[i]]});
  }
  return out.length ? out : [{type: typeAt(p.index[0]), points: p.points}];
}

export interface PlanProgress {
  done: Point[][];
  todo: Point[][];
  doneLength: number; // m
  todoLength: number;
  fraction: number; // of the length
}

export const length = (pts: Point[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);

export function splitPlan(paths: PlanPath[], path: number, pose: number): PlanProgress | null {
  if (paths.some((p) => !p.index)) return null;
  const done: Point[][] = [];
  const todo: Point[][] = [];
  paths.forEach((p, i) => {
    if (i < path) done.push(p.points);
    else if (i > path) todo.push(p.points);
    else {
      // the point between the two poses it's between
      const index = p.index!;
      let k = 0;
      while (k + 1 < index.length && index[k + 1] <= pose) k++;
      const a = p.points[k];
      const b = p.points[k + 1];
      let at = a;
      if (b && index[k + 1] > index[k]) {
        const t = Math.min(1, Math.max(0, (pose - index[k]) / (index[k + 1] - index[k])));
        at = {x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y)};
      }
      done.push([...p.points.slice(0, k + 1), at]);
      todo.push([at, ...p.points.slice(k + 1)]);
    }
  });
  const doneLength = done.reduce((s, p) => s + length(p), 0);
  const todoLength = todo.reduce((s, p) => s + length(p), 0);
  const all = doneLength + todoLength;
  return {done, todo, doneLength, todoLength, fraction: all > 0 ? doneLength / all : 0};
}

// how long the blades ran in the area during this job, from the event history, so every device comes to the same
// time. a job resumed after a break has the earlier part in it too, like the done part of the plan has
export function bladeSeconds(events: MowerEvent[], areaId: string, now: number): number {
  const job = events.filter((e) => e.type === 'AREA' && e.area_id === areaId).pop()?.job_id;
  if (!job) return 0;
  let area: string | undefined;
  let on: number | null = null;
  let total = 0;
  for (const e of events) {
    if (e.job_id !== job) continue;
    if (e.type === 'AREA' || (e.type === 'BLADES' && !e.enabled)) {
      if (on !== null && area === areaId) total += e.t - on;
      on = null;
    }
    if (e.type === 'AREA') area = e.area_id;
    if (e.type === 'BLADES' && e.enabled) on = e.t;
  }
  if (on !== null && area === areaId) total += now - on;
  return total;
}

// how fast the plan gets done (m of plan per second of blades running, turns included). the last one is kept per
// device, the editor uses it for how long an area takes
const RATE_KEY = 'mowRate';

export function savedRate(): number | null {
  try {
    const v = Number(localStorage.getItem(RATE_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveRate(rate: number) {
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {}
}
