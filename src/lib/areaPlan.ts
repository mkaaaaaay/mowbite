import type {Point} from '@/hooks/useMowerMap';
import type {MowPlan} from './mowPlan';
import {RPC} from './openmower';
import {callRpc, rpcMethods} from './rpc';

// The real plan for an area, once the mower offers it (RPC.areaPlan). Read like the planner answers
// inside ROS: paths, each an outline pass or a run of stripes, as poses or plain points.
interface PlannerPath {
  is_outline?: boolean | number;
  outline?: boolean;
  points?: ([number, number] | Point)[];
  path?: {poses?: {pose: {position: Point}}[]};
}

const points = (p: PlannerPath): Point[] =>
  p.points?.map((q) => (Array.isArray(q) ? {x: q[0], y: q[1]} : {x: q.x, y: q.y})) ??
  p.path?.poses?.map((q) => ({x: q.pose.position.x, y: q.pose.position.y})) ??
  [];

export function readPlan(answer: {paths?: PlannerPath[]} | PlannerPath[]): MowPlan {
  const paths = Array.isArray(answer) ? answer : (answer.paths ?? []);
  const loops: Point[][] = [];
  const stripes: [Point, Point][] = [];
  for (const p of paths) {
    const pts = points(p);
    if (p.is_outline || p.outline) loops.push(pts);
    else for (let i = 1; i < pts.length; i++) stripes.push([pts[i - 1], pts[i]]);
  }
  return {loops, stripes};
}

// null when this mower can't tell, then the editor works it out itself (lib/mowPlan)
export async function mowerPlan(areaId: string): Promise<MowPlan | null> {
  if (!(await rpcMethods())?.has(RPC.areaPlan)) return null;
  return readPlan(await callRpc(RPC.areaPlan, {area_id: areaId}, 20000));
}
