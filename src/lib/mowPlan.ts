import * as ClipperLib from 'clipper-lib';
import type {Point} from '@/hooks/useMowerMap';

// What slic3r_coverage_planner does with an area, so the editor can show where the mower will drive:
// the first outline pass is the area shrunk by outline_offset, every further one by one tool width.
// The stripes fill the pass number (outline_count - 1 - overlap), so they reach under that many
// passes. Obstacles grow the same way and get their own passes. Like the planner (Slic3r) the
// shapes are offset with Clipper, mitered corners. Neighbouring stripes are joined into zigzags,
// turning at the ends like the mower does. In which order it drives the pieces isn't worked out.

export interface MowPlanInput {
  outline: Point[];
  holes: Point[][];
  outlineOffset: number; // m, positive is inwards
  outlineCount: number;
  overlapCount: number;
  toolWidth: number; // m, also the stripe spacing
  angle: number; // rad, 0 = +x, ccw
}

export interface MowPlan {
  loops: Point[][]; // the outline passes, around the area and around obstacles
  stripes: [Point, Point][];
  angle?: number; // rad, only the mower's own plan says it
  // the loops are paths as the mower drives them (its own plan: several passes joined into one), not rings to close
  open?: boolean;
  // the stripes are the lanes one by one (the MowBite Planner's estimate), not joined into zigzags here
  lanes?: boolean;
  // m, what the mower drives besides the loops and the stripes (the estimate's turns and drives between the parts)
  between?: number;
  // what the MowBite Planner planned with (lane_spacing_mode auto: what it picked)
  chosen?: PlanChosen;
  // what its collision mode found while planning
  checks?: PlanChecks;
  // the plan cut into pieces by what they are (the MowBite Planner tells): the map leaves turns and drives out on wish
  pieces?: PlanPiece[];
  // how long it says the plan takes
  duration?: PlanDuration;
  // the parts of the lawn with a lane direction of their own (split_zones)
  zones?: PlanZone[];
}

export interface PlanPiece {
  type: 'perimeter' | 'lane' | 'turn' | 'transit';
  points: Point[];
}

// min: the mowing time, the planner's model corrected by the last runs finished mows (factor, runs 0: not corrected yet)
export interface PlanDuration {
  min: number;
  modelMin: number;
  factor: number;
  runs: number;
}

export interface PlanZone {
  angle: number; // rad
  lanes: number;
  outlines: Point[][];
}

// The MowBite Planner with the mower's body checks every plan: where the body would stick out past a real edge or into
// what to keep off, it drives another way and leaves a little out where nothing fits
// where the body would have stuck out furthest on the plan as it came: d m into the space it keeps free (spin: turning on
// the spot, the extra distance for that counts too)
export interface FitPose {
  x: number;
  y: number;
  yaw: number;
  d: number;
  spin: boolean;
}

export interface PlanChecks {
  // where the body may go: the real edges less the distances kept, outlines and holes
  space?: Point[][];
  // places driven another way, m: meters of loops and lanes left out there (0: only driven differently), with where the
  // body would have stuck out when the planner tells
  places: {x: number; y: number; m: number; pose?: FitPose}[];
  // how many were driven another way, how many left out as nothing fits there (the path jumps over them), m left out
  fixed: number;
  left: number;
  skipped: number;
  // where the path jumps: OpenMower drives the way between the parts itself, without the body checked
  jumps: Point[];
  // where the plan starts or ends without the body checked, OpenMower drives from or to there on its own
  unchecked: Point[];
  // clean stripes: where it still had to turn in the field of lanes
  turns: Point[];
  warnings: string[];
}

export interface PlanChosen {
  lane_spacing: number; // m
  perimeter_passes: number;
  mode: string; // fixed, auto
  // lanes or concentric, what the planner took with fill_pattern auto (a planner from before doesn't say)
  fill_pattern?: string;
}

// clipper works in integers, this is 0.01 mm
const SCALE = 1e5;
type Paths = ClipperLib.Paths;

const toPath = (o: Point[]) => o.map((p) => ({X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE)}));
const fromPath = (p: ClipperLib.Path): Point[] => p.map((q) => ({x: q.X / SCALE, y: q.Y / SCALE}));

function offset(paths: Paths, delta: number): Paths {
  // miter limit 3 like Slic3r's offset()
  const co = new ClipperLib.ClipperOffset(3, 0.25 * SCALE);
  co.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const out: Paths = [];
  co.Execute(out, delta * SCALE);
  return out;
}

// parallel lines at the angle, spacing apart, inside the rings (even-odd, so holes stay empty)
export function fillStripes(rings: Point[][], angle: number, spacing: number): [Point, Point][] {
  if (!rings.length || spacing <= 0) return [];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // rotate by -angle so the stripes become horizontal
  const local = rings.map((r) => r.map((p) => ({x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos})));
  const toWorld = (x: number, y: number): Point => ({x: x * cos - y * sin, y: x * sin + y * cos});
  const ys = local.flat().map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (maxY - minY > spacing * 4000) return [];

  const out: [Point, Point][] = [];
  for (let y = minY + spacing / 2; y < maxY; y += spacing) {
    const xs: number[] = [];
    for (const r of local) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        if (a.y <= y !== b.y <= y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-6) out.push([toWorld(xs[i], y), toWorld(xs[i + 1], y)]);
  }
  return out;
}

export function mowPlan(req: MowPlanInput): MowPlan {
  if (req.outline.length < 3 || req.toolWidth <= 0) return {loops: [], stripes: []};
  // the area minus its obstacles. obstacles outside of it drop out, ones over its edge get cut off,
  // otherwise shrinking gets confused by them
  const c = new ClipperLib.Clipper();
  c.AddPaths([toPath(req.outline)], ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(req.holes.filter((h) => h.length > 2).map(toPath), ClipperLib.PolyType.ptClip, true);
  const area: Paths = [];
  c.Execute(ClipperLib.ClipType.ctDifference, area, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  if (!area.length) return {loops: [], stripes: []};

  let last: Paths = area;
  let inner = last;
  const loops: Point[][] = [];
  const count = Math.max(0, Math.round(req.outlineCount));
  const innerLoop = count - 1 - Math.max(0, Math.round(req.overlapCount));
  for (let i = 0; i < count; i++) {
    const next = offset(last, -(i === 0 ? req.outlineOffset : req.toolWidth));
    if (!next.length) break;
    last = next;
    loops.push(...next.map(fromPath));
    if (i <= innerLoop) inner = next;
  }
  return {loops, stripes: fillStripes(inner.map(fromPath), req.angle, req.toolWidth)};
}

// neighbouring stripes into zigzags, a new piece where an obstacle or a bend of the outline splits them
export function linkStripes(stripes: [Point, Point][], angle: number, spacing: number): Point[][] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const toLocal = (p: Point) => ({x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos});
  type Seg = {x0: number; x1: number; row: number; a: Point; b: Point; used: boolean};
  const segs: Seg[] = stripes.map(([p, q]) => {
    const lp = toLocal(p);
    const lq = toLocal(q);
    const [a, b, x0, x1] = lp.x <= lq.x ? [p, q, lp.x, lq.x] : [q, p, lq.x, lp.x];
    return {x0, x1, row: Math.round(lp.y / spacing), a, b, used: false};
  });
  const rows = new Map<number, Seg[]>();
  for (const s of segs) rows.set(s.row, [...(rows.get(s.row) ?? []), s]);
  const order = [...rows.keys()].sort((m, n) => m - n);

  const chains: Point[][] = [];
  for (const r of order) {
    for (const start of rows.get(r)!.sort((m, n) => m.x0 - n.x0)) {
      if (start.used) continue;
      start.used = true;
      let cur = start;
      let rightwards = true;
      const chain = [cur.a, cur.b];
      for (let guard = 0; guard < segs.length; guard++) {
        const endX = rightwards ? cur.x1 : cur.x0;
        const next = (rows.get(cur.row + 1) ?? [])
          .filter((s) => !s.used && s.x0 < cur.x1 && s.x1 > cur.x0)
          .sort((m, n) => Math.abs((rightwards ? m.x1 : m.x0) - endX) - Math.abs((rightwards ? n.x1 : n.x0) - endX))[0];
        if (!next || Math.abs((rightwards ? next.x1 : next.x0) - endX) > spacing * 3) break;
        next.used = true;
        chain.push(...(rightwards ? [next.b, next.a] : [next.a, next.b]));
        cur = next;
        rightwards = !rightwards;
      }
      chains.push(chain);
    }
  }
  return chains;
}
