import type {Point} from '@/hooks/useMowerMap';
import type {MowPlan, PlanChecks, PlanChosen, PlanDuration, PlanPiece, PlanZone} from './mowPlan';
import {planPieces, type PlanPath, type PlanSegment, type SegmentType} from './planProgress';
import {RPC} from './openmower';
import {callRpc, rpcMethods} from './rpc';

// The real plan for an area, once the mower offers it (RPC.areaPlan). Read like the planner answers
// inside ROS: paths, each an outline pass or a run of stripes, as poses or plain points.
interface PlannerPath {
  is_outline?: boolean | number;
  outline?: boolean;
  points?: ([number, number] | Point)[];
  pose_index?: number[];
  path?: {poses?: {pose: {position: Point}}[]};
  // the MowBite Planner: what the stretches of the path are
  segments?: {type?: unknown; start?: unknown; end?: unknown}[];
}

const SEGMENT_TYPES = new Set<string>(['perimeter', 'lane', 'turn', 'transit']);
const segments = (p: PlannerPath): PlanSegment[] | undefined => {
  if (!Array.isArray(p.segments)) return undefined;
  const out = p.segments.flatMap((s) =>
    s && typeof s.type === 'string' && SEGMENT_TYPES.has(s.type) && typeof s.start === 'number' && typeof s.end === 'number'
      ? [{type: s.type as SegmentType, start: s.start, end: s.end}]
      : [],
  );
  return out.length ? out : undefined;
};

const points = (p: PlannerPath): Point[] =>
  p.points?.map((q) => (Array.isArray(q) ? {x: q[0], y: q[1]} : {x: q.x, y: q.y})) ??
  p.path?.poses?.map((q) => ({x: q.pose.position.x, y: q.pose.position.y})) ??
  [];

export function readPaths(answer: {paths?: PlannerPath[]} | PlannerPath[]): PlanPath[] {
  const paths = Array.isArray(answer) ? answer : (answer.paths ?? []);
  return paths.map((p) => {
    const pts = points(p);
    // the points come simplified, only pose_index says which pose of the full path each one is
    const index = p.pose_index?.length === pts.length ? p.pose_index : p.path?.poses ? pts.map((_, i) => i) : undefined;
    const segs = segments(p);
    return {outline: !!(p.is_outline || p.outline), points: pts, index, ...(segs ? {segments: segs} : {})};
  });
}

type PlanAnswer = {
  paths?: PlannerPath[];
  angle?: number;
  stats?: {chosen?: PlanChosen; body_fit?: unknown; headland_turns?: unknown; zones?: unknown};
  warnings?: unknown;
  body_space?: unknown;
  // the MowBite Planner's estimate of the mowing time, corrected by the last finished mows
  duration?: {min?: unknown; model_min?: unknown; factor?: unknown; runs?: unknown};
};

// how long the planner says the plan takes (planner.plan duration), nothing from a planner without it
export function readDuration(answer: PlanAnswer): PlanDuration | undefined {
  const d = answer.duration;
  if (!d || typeof d.min !== 'number' || !Number.isFinite(d.min) || d.min < 0) return undefined;
  return {
    min: d.min,
    modelMin: typeof d.model_min === 'number' ? d.model_min : d.min,
    factor: typeof d.factor === 'number' ? d.factor : 1,
    runs: typeof d.runs === 'number' ? d.runs : 0,
  };
}

// the parts of the lawn the planner gave a lane direction of their own (split_zones), their outlines
export function readZones(answer: PlanAnswer): PlanZone[] {
  const zones = answer.stats?.zones;
  if (!Array.isArray(zones)) return [];
  return zones.flatMap((z: {angle?: unknown; lanes?: unknown; outlines?: unknown}) =>
    z && typeof z === 'object'
      ? [
          {
            angle: typeof z.angle === 'number' ? z.angle : 0,
            lanes: typeof z.lanes === 'number' ? z.lanes : 0,
            outlines: (Array.isArray(z.outlines) ? z.outlines.map(xys) : []).filter((o) => o.length >= 3),
          },
        ]
      : [],
  );
}

const xy = (v: unknown): Point | null => (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? {x: v[0], y: v[1]} : null);
const xys = (v: unknown): Point[] => (Array.isArray(v) ? v.map(xy).filter((p): p is Point => !!p) : []);
// the planner's own lines for what stats.body_fit counts, shown from the counts
const COUNTED = [/^\d+ places? driven another way where the body would stick out/, /^\d+ places? left out where the body doesn't fit/];

// what the collision mode found (stats.body_fit, stats.headland_turns, warnings, body_space), nothing from a planner
// without it
export function readChecks(answer: PlanAnswer): PlanChecks | undefined {
  const fit = (answer.stats?.body_fit ?? null) as {
    places?: unknown;
    poses?: unknown;
    fixed?: unknown;
    left?: unknown;
    skipped_m?: unknown;
    jumps?: unknown;
    unchecked?: unknown;
  } | null;
  const head = (answer.stats?.headland_turns ?? null) as {places?: unknown} | null;
  const space = (answer.body_space ?? null) as {outlines?: unknown; holes?: unknown} | null;
  const warnings = (Array.isArray(answer.warnings) ? answer.warnings : []).filter(
    (w): w is string => typeof w === 'string' && !(fit && COUNTED.some((r) => r.test(w))),
  );
  if (!fit && !head && !space && !warnings.length) return undefined;
  // poses: one for each place, in the same order
  const poses = Array.isArray(fit?.poses) ? fit.poses : [];
  const places = (Array.isArray(fit?.places) ? fit.places : []).flatMap((p: unknown, i: number) => {
    const at = xy(p);
    if (!at) return [];
    const q = poses[i];
    const pose =
      Array.isArray(q) && q.slice(0, 4).length === 4 && q.slice(0, 4).every((v) => typeof v === 'number')
        ? {x: q[0] as number, y: q[1] as number, yaw: q[2] as number, d: q[3] as number, spin: q[4] === 1 || q[4] === true}
        : undefined;
    return [{...at, m: typeof (p as number[])[2] === 'number' ? (p as number[])[2] : 0, ...(pose ? {pose} : {})}];
  });
  const rings = [space?.outlines, space?.holes].flatMap((list) => (Array.isArray(list) ? list.map(xys) : [])).filter((r) => r.length >= 3);
  return {
    ...(rings.length ? {space: rings} : {}),
    places,
    fixed: typeof fit?.fixed === 'number' ? fit.fixed : places.length,
    left: typeof fit?.left === 'number' ? fit.left : 0,
    skipped: typeof fit?.skipped_m === 'number' ? fit.skipped_m : 0,
    jumps: xys(fit?.jumps),
    // a list of points, or the one point itself
    unchecked: Array.isArray(fit?.unchecked) && typeof fit.unchecked[0] === 'number' ? [xy(fit.unchecked)].filter((p): p is Point => !!p) : xys(fit?.unchecked),
    turns: xys(head?.places),
    warnings,
  };
}

export function readPlan(answer: PlanAnswer | PlannerPath[]): MowPlan {
  const loops: Point[][] = [];
  const stripes: [Point, Point][] = [];
  const paths = readPaths(answer);
  for (const p of paths) {
    if (p.outline) loops.push(p.points);
    else for (let i = 1; i < p.points.length; i++) stripes.push([p.points[i - 1], p.points[i]]);
  }
  // the plan in pieces by what they are, only when the planner tells
  const pieces: PlanPiece[] | undefined = paths.some((p) => p.segments) ? paths.flatMap(planPieces) : undefined;
  const chosen = Array.isArray(answer) ? undefined : answer.stats?.chosen;
  const checks = Array.isArray(answer) ? undefined : readChecks(answer);
  const duration = Array.isArray(answer) ? undefined : readDuration(answer);
  const zones = Array.isArray(answer) ? [] : readZones(answer);
  return {
    loops,
    stripes,
    angle: Array.isArray(answer) ? undefined : answer.angle,
    open: true,
    ...(pieces ? {pieces} : {}),
    ...(chosen ? {chosen} : {}),
    ...(checks ? {checks} : {}),
    ...(duration ? {duration} : {}),
    ...(zones.length ? {zones} : {}),
  };
}

// what mowing.plan takes: a saved area by id, or an area as it is right now in the editor (map.json format,
// missing settings fall back to the mower's global ones)
// what's set on the area as it is in the editor, in place of the saved one
interface PlanProps {
  angle?: number;
  outline_count?: number;
  outline_overlap_count?: number;
  outline_offset?: number;
  angle_min?: number;
  angle_max?: number;
  // the area's MowBite Planner settings as edited (its planner property)
  settings?: Record<string, unknown>;
}
export type PlanRequest = ({area_id: string} & PlanProps) | ({outline: Point[]; obstacles: Point[][]} & PlanProps);

// null when this mower can't tell, then the editor works it out itself (lib/mowPlan). With the MowBite Planner on the
// mower it plans the area directly (planner.plan, the same settings mower_logic's plans get): it takes the area's
// planner settings as edited and says what it planned with (the lane spacing it picked). mowing.plan only knows
// OpenMower's area settings
export async function mowerPlan(req: PlanRequest, viaPlanner = false): Promise<MowPlan | null> {
  const asked = await mowerPlanAnswer(req, viaPlanner);
  return asked ? readPlan(asked.answer as PlanAnswer) : null;
}

// the mower's answer as it comes, and the method that gave it
export async function mowerPlanAnswer(req: PlanRequest, viaPlanner = false): Promise<{method: string; answer: unknown} | null> {
  const known = await rpcMethods();
  if ((viaPlanner || req.settings) && known?.has(RPC.plannerPlan)) {
    // with the body checked a plan takes the mower 10 to 20 s, more for a whole new one
    return {method: RPC.plannerPlan, answer: await callRpc(RPC.plannerPlan, req, 90000)};
  }
  if (!known?.has(RPC.areaPlan)) return null;
  // mowing.plan doesn't take planner settings
  const plain = Object.fromEntries(Object.entries(req).filter(([k]) => k !== 'settings'));
  return {method: RPC.areaPlan, answer: await callRpc(RPC.areaPlan, plain, 20000)};
}

// the plan in the order it's driven, for showing the progress of a run
export async function mowerPaths(areaId: string): Promise<PlanPath[] | null> {
  if (!(await rpcMethods())?.has(RPC.areaPlan)) return null;
  return readPaths(await callRpc(RPC.areaPlan, {area_id: areaId}, 20000));
}
