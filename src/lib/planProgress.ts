import type {Point} from '@/hooks/useMowerMap';

// The mower's plan for an area (mowing.plan) split at where it is: the robot state has the path it's on and the
// index of the pose in that path (current_path, current_path_index). The plan comes simplified, pose_index says which
// pose of the full path each point was.

export interface PlanPath {
  outline: boolean;
  points: Point[];
  index: number[]; // pose index per point, rising
}

export interface PlanProgress {
  done: Point[][];
  todo: Point[][];
  doneLength: number; // m
  todoLength: number;
  fraction: number; // of the length
}

export const length = (pts: Point[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);

export function splitPlan(paths: PlanPath[], path: number, pose: number): PlanProgress {
  const done: Point[][] = [];
  const todo: Point[][] = [];
  paths.forEach((p, i) => {
    if (i < path) done.push(p.points);
    else if (i > path) todo.push(p.points);
    else {
      // the point between the two poses it's between
      let k = 0;
      while (k + 1 < p.index.length && p.index[k + 1] <= pose) k++;
      const a = p.points[k];
      const b = p.points[k + 1];
      let at = a;
      if (b && p.index[k + 1] > p.index[k]) {
        const t = Math.min(1, Math.max(0, (pose - p.index[k]) / (p.index[k + 1] - p.index[k])));
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

// how fast the plan gets done (m of plan per second, turns and stops included), learned while watching a run. kept
// per device, the editor uses it for how long an area takes
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
