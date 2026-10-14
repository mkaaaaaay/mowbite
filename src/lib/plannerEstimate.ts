import * as ClipperLib from 'clipper-lib';
import type {Point} from '@/hooks/useMowerMap';
import {angleInRange} from './mowStripes';
import type {MowPlan} from './mowPlan';

// What the MowBite Planner (OM_PLANNER=mowbite) does with an area, worked out here so the editor can show it at
// once while the angle moves, before the mower's own plan is back. Like planner.py: the area minus the obstacles,
// outline passes at perimeter_offset and then a lane spacing further in each (rounded where they bend), the lanes
// in what's left inside the passes the lanes don't reach under, the first and the last row on its edge and the
// rows between spread evenly (never further apart than the lane spacing). Crosshatch adds lanes across, rings fills
// with passes further and further in. The direction: the one mower_logic asks for, or worked out like the planner
// does (longest edge, narrowest width, fewest lanes). Not here: turns, the order, lanes carried on through the
// headland, the strips too narrow for lanes, the body check.

export interface PlannerEstimateInput {
  id?: string; // whose estimate it is, for the caller (not used here)
  outline: Point[];
  holes: Point[][];
  spacing: number; // m, lane spacing (OpenMower's tool_width)
  bladeWidth: number; // m, mower_width
  perimeterOffset: number; // m, first pass inside the outline
  passes: number; // outline passes, -1: as many as the lanes' turns need (autoPasses)
  overlapPasses: number; // lanes reach this many passes further out
  // rad: the direction mower_logic asks for, null: worked out by strategy
  angle: number | null;
  strategy: string; // longest_edge, min_width, optimal
  angleOffset: number; // rad, the planner's own, on top
  angleMin?: number;
  angleMax?: number;
  angleStep: number; // rad, between the directions optimal tries
  fillPattern: string; // lanes, crosshatch, concentric
  crosshatchAngle: number; // rad
  minLaneLength: number; // m
  // where the lane region is narrower than the lanes' turns: 'lanes' anyway or 'loops' further in
  narrowParts?: string;
  turnRadius?: number; // m
  laneOrder?: string; // snake, skip
  bladeAhead?: number; // m, the blade ahead of the point the path is for: the lanes run that much behind it
  bladeOffset?: number; // m, left of it
  waypointSpacing?: number; // m
  // the body check (robot_width, robot_front, robot_rear): the ends of the lanes come back until the body and the
  // turn there fit in the area grown by half the body (recorded edges) and the other lawns, not over keepOut
  body?: {width: number; front: number; rear: number; recorded: boolean; drivable: Point[][]; keepOut: Point[][]; tolerance?: number};
  // where the plan starts and ends (mower_logic plans from the docking station), x, y and the way it faces (rad)
  start?: {x: number; y: number; heading?: number | null};
  perimeterOrder?: string; // first, last
  perimeterDirection?: string; // auto, ccw, cw
  cornerRadius?: number; // m, perimeter_corner_radius: a loop doesn't start right at a corner
  simplifyTolerance?: number; // m, the outline and obstacles are simplified this much first
  spacingMode?: string; // fixed, auto (the spacing is the one the planner picked or will try first), for chosen
  turnTypes?: string[]; // the kinds of turns allowed (u_turn, bulb, detour, pivot)
  minTurnRadius?: number; // m, no arc of a turn tighter than this (it turns on the spot there)
  // collision mode (body sizes with a planner that keeps distances): the first loop keeps at least edgeMargin off the
  // outline, the loops round a hole at least its margin (undefined: like round the outline)
  edgeMargin?: number;
  holeMargins?: (number | undefined)[];
}

export interface PlannerEstimate extends MowPlan {
  angle: number; // rad, 0..pi, the direction of the (first) lanes
}

// clipper works in integers, this is 0.01 mm
const SCALE = 1e5;
type Paths = ClipperLib.Paths;
const EDGE_MARGIN = 1e-4;
// how far a rounded corner may be off a true arc, for an offset by d: like shapely's 9 segments a quarter circle
const arcTolerance = (d: number) => Math.max(0.25, Math.abs(d) * SCALE * (1 - Math.cos(Math.PI / 36)));
// the planner simplifies an outline this much to find its longest edge
const ANGLE_SIMPLIFY = 0.1;

const toPath = (o: Point[]) => o.map((p) => ({X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE)}));
const fromPath = (p: ClipperLib.Path): Point[] => p.map((q) => ({x: q.X / SCALE, y: q.Y / SCALE}));
// counter-clockwise, so overlapping ones add up (clipper's non-zero filling)
const ccw = (p: ClipperLib.Path) => (ClipperLib.Clipper.Orientation(p) ? p : [...p].reverse());

// shrunk by d (grown if negative), round where it bends around inside corners, like the planner's inset()
function inset(paths: Paths, d: number): Paths {
  if (d === 0) return paths;
  const co = new ClipperLib.ClipperOffset(2, arcTolerance(d));
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out: Paths = [];
  co.Execute(out, -d * SCALE);
  return out;
}

const area = (p: ClipperLib.Path) => ClipperLib.Clipper.Area(p) / (SCALE * SCALE);

// the area minus the obstacles, simplified by tolerance like the planner does (douglas-peucker of each ring from its
// first point), without slivers smaller than the blade
function freeSpace(outline: Point[], holes: Point[][], half: number, tolerance: number): {paths: Paths; rings: Point[][]} {
  const obstacles = holes.filter((h) => h.length > 2).map((h) => ccw(toPath(h)));
  const outer = [toPath(outline)];
  const whole = (p: ClipperLib.Path) => Math.abs(area(p));
  // obstacles apart from each other and inside the outline (or outside) are the free space's own rings, which keep
  // their first points: simplified like that, they come out as the planner simplifies them (outline counter-clockwise,
  // holes clockwise, the outline first, then the holes from the left)
  const inside = obstacles.filter((o) => Math.abs(partArea(clip([o], outer, ClipperLib.ClipType.ctIntersection))) > 1e-9);
  const apart =
    inside.every((o) => Math.abs(Math.abs(partArea(clip([o], outer, ClipperLib.ClipType.ctIntersection))) - whole(o)) < 1e-7) &&
    Math.abs(Math.abs(partArea(clip(inside, [], ClipperLib.ClipType.ctUnion))) - inside.reduce((sum, o) => sum + whole(o), 0)) < 1e-7;
  const minX = (p: ClipperLib.Path) => Math.min(...p.map((q) => q.X));
  let subject = outer;
  let clipPaths = obstacles;
  let rings: Point[][] | null = null;
  if (apart) {
    rings = [oriented(outline, true), ...[...inside].sort((p, q) => minX(p) - minX(q)).map((o) => oriented(fromPath(o), false))];
    if (tolerance > 0) rings = simplifyRings(rings, tolerance);
    const simple = rings.map(toPath);
    subject = simple.slice(0, 1);
    clipPaths = simple.slice(1);
  }
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctDifference, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  let out: Paths = [];
  // a part smaller than half x half goes, with its holes
  const walk = (node: ClipperLib.PolyNode) => {
    for (const child of node.Childs()) {
      if (!child.IsHole() && area(child.Contour()) >= half * half) {
        out.push(child.Contour());
        for (const hole of child.Childs()) {
          out.push(hole.Contour());
          walk(hole);
        }
      }
    }
  };
  walk(tree);
  // obstacles across the outline or each other: the rings come out new, simplified from wherever they start
  if (!apart && tolerance > 0) out = simplifyRings(out.map(fromPath), tolerance).map(toPath);
  // the rings as the planner has them: from their first points, when they kept them
  return {paths: out, rings: rings && out.length === rings.length ? rings : out.map(fromPath)};
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// douglas-peucker of a line (shapely's simplify without keeping the topology)
function simplifyLine(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  let max = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distToSegment(points[i], points[0], points[points.length - 1]);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= tolerance) return [points[0], points[points.length - 1]];
  return [...simplifyLine(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplifyLine(points.slice(index), tolerance)];
}

const orient = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
const samePoint = (p: Point, q: Point) => p.x === q.x && p.y === q.y;

// whether two segments meet anywhere but at an end of both (GEOS' isInteriorIntersection)
function interiorIntersection(a0: Point, a1: Point, b0: Point, b1: Point): boolean {
  if (Math.max(a0.x, a1.x) < Math.min(b0.x, b1.x) || Math.max(b0.x, b1.x) < Math.min(a0.x, a1.x)) return false;
  if (Math.max(a0.y, a1.y) < Math.min(b0.y, b1.y) || Math.max(b0.y, b1.y) < Math.min(a0.y, a1.y)) return false;
  const o1 = orient(a0, a1, b0);
  const o2 = orient(a0, a1, b1);
  const o3 = orient(b0, b1, a0);
  const o4 = orient(b0, b1, a1);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  const on = (p: Point, s0: Point, s1: Point) =>
    orient(s0, s1, p) === 0 &&
    p.x >= Math.min(s0.x, s1.x) && p.x <= Math.max(s0.x, s1.x) && p.y >= Math.min(s0.y, s1.y) && p.y <= Math.max(s0.y, s1.y);
  for (const p of [b0, b1]) if (on(p, a0, a1) && !samePoint(p, a0) && !samePoint(p, a1)) return true;
  for (const p of [a0, a1]) if (on(p, b0, b1) && !samePoint(p, b0) && !samePoint(p, b1)) return true;
  return false;
}

// shapely's simplify(tolerance, preserve_topology=True) of rings (GEOS' TopologyPreservingSimplifier): douglas-peucker
// of each ring from its first point round to it again, but a stretch isn't straightened where the new segment would
// cross what's left of the rings, and a ring keeps at least 3 points
function simplifyRings(rings: Point[][], tolerance: number): Point[][] {
  type Seg = {a: Point; b: Point; ring: number; index: number};
  const input = new Set<Seg>();
  const byRing = rings.map((r, ri) => {
    const pts = [...r, r[0]];
    const segs = pts.slice(0, -1).map((a, i) => ({a, b: pts[i + 1], ring: ri, index: i}));
    segs.forEach((g) => input.add(g));
    return {pts, segs};
  });
  const output: Seg[] = [];
  return byRing.map(({pts, segs}, ri) => {
    const result: Point[] = [pts[0]];
    const section = (i: number, j: number, depth: number) => {
      depth += 1;
      if (i + 1 === j) {
        result.push(pts[j]);
        return;
      }
      // in the worst case enough points left for a ring (4 with the closing one)
      let valid = !(result.length - 1 < 3 && depth + 1 < 4);
      let far = -1;
      let index = i;
      for (let k = i + 1; k < j; k++) {
        const d = distToSegment(pts[k], pts[i], pts[j]);
        if (d > far) [far, index] = [d, k];
      }
      if (far > tolerance) valid = false;
      const a = pts[i];
      const b = pts[j];
      if (valid) {
        for (const g of output) {
          if (interiorIntersection(g.a, g.b, a, b)) {
            valid = false;
            break;
          }
        }
      }
      if (valid) {
        for (const g of input) {
          if (g.ring === ri && g.index >= i && g.index < j) continue;
          if (interiorIntersection(g.a, g.b, a, b)) {
            valid = false;
            break;
          }
        }
      }
      if (valid) {
        for (let k = i; k < j; k++) input.delete(segs[k]);
        output.push({a, b, ring: ri, index: -1});
        result.push(b);
        return;
      }
      section(i, index, depth);
      section(index, j, depth);
    };
    section(0, pts.length - 1, 0);
    return result.slice(0, -1);
  });
}

// a ring going counter-clockwise (or clockwise), from the same first point
function oriented(ring: Point[], ccw: boolean): Point[] {
  const a = ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0);
  return a > 0 === ccw ? ring : [ring[0], ...ring.slice(1).reverse()];
}

function longestEdgeDirection(coords: Point[]): number {
  let best = -1;
  let angle = 0;
  for (let i = 0; i + 1 < coords.length; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l > best) {
      best = l;
      angle = Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  return angle;
}

// the direction of the longest edge of the outline (simplified first, a recorded one has a dent every few cm)
export function longestEdgeAngle(outline: Point[]): number {
  if (outline.length < 2) return 0;
  const ring = [...outline, outline[0]];
  const simple = simplifyLine(ring, ANGLE_SIMPLIFY);
  return longestEdgeDirection(simple.length >= 4 ? simple : ring);
}

function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// the direction of the long side of the smallest rectangle around the points: the fewest lanes on a convex shape
export function minWidthAngle(points: Point[]): number {
  const hull = convexHull(points);
  if (hull.length < 3) return longestEdgeDirection(points);
  let best = Infinity;
  let angle = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const e = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(e);
    const s = Math.sin(e);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of hull) {
      const x = p.x * c + p.y * s;
      const y = -p.x * s + p.y * c;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const areaRect = (maxX - minX) * (maxY - minY);
    if (areaRect < best - 1e-12) {
      best = areaRect;
      // the long side of that rectangle
      angle = maxX - minX >= maxY - minY ? e : e + Math.PI / 2;
    }
  }
  return angle;
}

type Lane = {x0: number; x1: number; y: number; row: number};
type Intervals = [number, number][];
const MAX_ROWS = 20000;
// m, slivers to mow narrower than this next to a lane's strip aren't worth stretching a lane for
const COVER_TOLERANCE = 0.01;

// where the lines y0 + j * step of the lane frame cross the rings (even-odd), per edge for the lines it spans
class Scanner {
  private edges: [number, number, number, number, number, number][] = [];
  lo = Infinity;
  hi = -Infinity;

  constructor(rings: Point[][], c: number, s: number) {
    for (const ring of rings) {
      const local = ring.map((p) => [p.x * c + p.y * s, -p.x * s + p.y * c]);
      for (let i = 0; i < local.length; i++) {
        const [ax, ay] = local[i];
        const [bx, by] = local[(i + 1) % local.length];
        if (ay !== by) this.edges.push([Math.min(ay, by), Math.max(ay, by), ax, ay, bx - ax, by - ay]);
        this.lo = Math.min(this.lo, ay);
        this.hi = Math.max(this.hi, ay);
      }
    }
  }

  get empty() {
    return !this.edges.length;
  }

  intervals(y0: number, step: number, count: number): Intervals[] {
    const crossings: number[][] = Array.from({length: count}, () => []);
    for (const [lo, hi, ax, ay, dx, dy] of this.edges) {
      let j = Math.max(0, Math.floor((lo - y0) / step));
      let y = y0 + j * step;
      // half open, so a line through a vertex crosses one of its two edges
      while (y < hi && j < count) {
        if (y >= lo) crossings[j].push(ax + ((y - ay) * dx) / dy);
        j++;
        y = y0 + j * step;
      }
    }
    return crossings.map((xs) => {
      xs.sort((a, b) => a - b);
      const out: Intervals = [];
      for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] > xs[k]) out.push([xs[k], xs[k + 1]]);
      return out;
    });
  }
}

function intersect(a: Intervals, b: Intervals): Intervals {
  const out: Intervals = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

function subtract(a: Intervals, b: Intervals): Intervals {
  const out: Intervals = [];
  for (const [lo, hi] of a) {
    let cur = lo;
    for (const [blo, bhi] of b) {
      if (bhi <= cur) continue;
      if (blo >= hi) break;
      if (blo > cur) out.push([cur, blo]);
      cur = Math.max(cur, bhi);
    }
    if (cur < hi) out.push([cur, hi]);
  }
  return out;
}

function unite(a: Intervals, b: Intervals): Intervals {
  const out: Intervals = [];
  for (const [lo, hi] of [...a, ...b].sort((p, q) => p[0] - q[0] || p[1] - q[1])) {
    const top = out[out.length - 1];
    if (top && lo <= top[1] + 1e-9) top[1] = Math.max(top[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

const widen = (a: Intervals, d: number) => unite(a.map(([lo, hi]): [number, number] => [lo - d, hi + d]), []);
const total = (a: Intervals) => a.reduce((sum, [lo, hi]) => sum + hi - lo, 0);

// the pieces of the rows at the angle inside the rings (even-odd), the first and the last row on the edge, the ones
// between spread evenly at most spacing apart, like the planner's scan_lanes. With target (what the lanes have to
// mow), room (where the mower's centre may go) and reach (half the blade): where target reaches past a lane's strip
// and the row on that side has no lane, that row's lane is carried on there, so nothing stays between lanes and loops
export function scanLanes(rings: Point[][], angle: number, spacing: number, minLength: number, target?: Point[][],
                          room?: Point[][], reach = 0): Lane[][] {
  if (!rings.length || spacing <= 0) return [];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const lanes = new Scanner(rings, c, s);
  if (lanes.empty) return [];
  const usable = lanes.hi - lanes.lo - 2 * EDGE_MARGIN;
  let count: number, step: number, y0: number;
  if (usable <= 0) [count, step, y0] = [1, spacing, (lanes.lo + lanes.hi) / 2];
  else {
    count = Math.ceil(usable / spacing - 1e-9) + 1;
    if (count > MAX_ROWS) return [];
    step = usable / (count - 1);
    y0 = lanes.lo + EDGE_MARGIN;
  }
  // one more row on either side, which only gets lanes stretched into it
  const n = count + 2;
  const base = y0 - step;
  let rows: Intervals[] = [[], ...lanes.intervals(y0, step, count).map((r) => r.filter(([lo, hi]) => hi - lo >= minLength)), []];
  let free: Intervals[] | null = null;
  if (target?.length && room) {
    const tgt = new Scanner(target, c, s);
    const beyond = reach + COVER_TOLERANCE;
    const on = tgt.intervals(base, step, n);
    const above = tgt.intervals(base + beyond, step, n);
    const below = tgt.intervals(base - beyond, step, n);
    const space = new Scanner(room, c, s).intervals(base, step, n);
    free = space;
    for (let pass = 0; pass < 3; pass++) {
      const grown = rows.map((r) => [...r]);
      let more = 0;
      for (let j = 0; j < n - 1; j++) {
        // above row j where row j + 1 has no lane: row j + 1 goes on there, and the other way round
        for (const [src, dst, todo] of [[j, j + 1, above[j]], [j + 1, j, below[j + 1]]] as [number, number, Intervals][]) {
          const extra = intersect(subtract(intersect(todo, rows[src]), rows[dst]), space[dst]);
          if (extra.length) {
            more += total(extra);
            grown[dst] = unite(grown[dst], extra);
          }
        }
      }
      for (let j = 0; j < n; j++) {
        // on the row's own line out of reach of its lanes' ends: a lane there, joined to the ones next to it
        const todo = subtract(intersect(on[j], space[j]), widen(rows[j], reach)).filter(([lo, hi]) => hi - lo > COVER_TOLERANCE);
        if (todo.length) {
          more += total(todo);
          grown[j] = unite(grown[j], intersect(widen(todo, reach), space[j]));
        }
      }
      rows = grown;
      if (more < 1e-6) break;
    }
  }
  let out = rows.map((intervals, j) => {
    if (free && intervals.some(([lo, hi]) => hi - lo < minLength)) {
      // a filled in piece too short for a lane is lengthened to one, as far as there's room
      const longer: Intervals = [];
      for (const [lo, hi] of intervals) {
        const pad = 0.5 * Math.max(0, minLength - (hi - lo));
        longer.push(...(pad > 0 ? intersect([[lo - pad, hi + pad]], free[j]) : [[lo, hi] as [number, number]]));
      }
      intervals = unite(longer, []);
    }
    const y = base + j * step;
    // (a lengthened piece is minLength long give or take rounding, the planner keeps those too)
    return intervals.filter(([lo, hi]) => hi - lo >= minLength - 1e-9).map(([lo, hi]): Lane => ({x0: lo, x1: hi, y, row: j}));
  });
  // the outer rows only if something was stretched into them
  if (!out[0].length) out = out.slice(1);
  if (out.length && !out[out.length - 1].length) out = out.slice(0, -1);
  return out;
}

// how many cells (groups of lanes mowed in one zigzag) the rows split into, like the planner's split_cells
function countCells(rows: Lane[][]): number {
  let cells = 0;
  let prev: Lane[] = [];
  let open = new Map<number, boolean>();
  for (const lanes of rows) {
    const succ = prev.map(() => [] as number[]);
    const pred = lanes.map(() => [] as number[]);
    prev.forEach((p, i) =>
      lanes.forEach((q, k) => {
        if (p.x0 < q.x1 && q.x0 < p.x1) {
          succ[i].push(k);
          pred[k].push(i);
        }
      }),
    );
    const now = new Map<number, boolean>();
    lanes.forEach((_, k) => {
      const ps = pred[k];
      if (!(ps.length === 1 && succ[ps[0]].length === 1 && open.get(ps[0]))) cells++;
      now.set(k, true);
    });
    open = now;
    prev = lanes;
  }
  return cells;
}

function optimalAngle(rings: Point[][], input: PlannerEstimateInput, fallback: number, target?: Point[][],
                      room?: Point[][], reach = 0): number {
  const candidates = new Set<number>([+((((fallback % Math.PI) + Math.PI) % Math.PI).toFixed(9))]);
  const n = Math.max(1, Math.round(Math.PI / input.angleStep));
  for (let i = 0; i < n; i++) candidates.add(+((i * Math.PI) / n).toFixed(9));
  let list = [...candidates];
  if (input.angleMin !== undefined && input.angleMax !== undefined) list = list.map((a) => angleInRange(a, input.angleMin, input.angleMax));
  list.sort((a, b) => a - b);
  const diff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  let best: {cost: number; d: number; a: number} | null = null;
  for (const a of list) {
    const rows = scanLanes(rings, a, input.spacing, input.minLaneLength, target, room, reach);
    const cost = rows.reduce((s, r) => s + r.length, 0) + 3 * countCells(rows);
    const d = diff(2 * a, 2 * fallback);
    if (!best || cost < best.cost || (cost === best.cost && d < best.d)) best = {cost, d, a};
  }
  return best ? best.a : fallback;
}

const ringsOf = (paths: Paths) => paths.map(fromPath).filter((r) => r.length >= 3);

function clip(subject: Paths, clipPaths: Paths, type: number): Paths {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  if (clipPaths.length) c.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);
  const out: Paths = [];
  c.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out;
}

// the polygons of some paths, each its outline with its holes
function partsOf(paths: Paths): Paths[] {
  const c = new ClipperLib.Clipper();
  // parts touching at a corner are two, like shapely's
  c.StrictlySimple = true;
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const out: Paths[] = [];
  const walk = (node: ClipperLib.PolyNode) => {
    for (const child of node.Childs()) {
      if (child.IsHole()) continue;
      out.push([child.Contour(), ...child.Childs().map((h) => h.Contour())]);
      for (const hole of child.Childs()) walk(hole);
    }
  };
  walk(tree);
  return out;
}

const partArea = (part: Paths) => part.reduce((s, p) => s + area(p), 0);

function grow(paths: Paths, d: number, join: number): Paths {
  const co = new ClipperLib.ClipperOffset(5, arcTolerance(d));
  co.AddPaths(paths, join, ClipperLib.EndType.etClosedPolygon);
  const out: Paths = [];
  co.Execute(out, d * SCALE);
  return out;
}

// m, the planner's steps for the body check
const BODY_STEP = 0.01;
// rad, the planner's arcs have a pose at least this often
const MAX_ARC_STEP = (10 * Math.PI) / 180;
// rad, a bend sharper than this is a corner (a loop doesn't start right at one)
const CORNER_ANGLE = (15 * Math.PI) / 180;
const CELL = 0.5; // m, grid of the edges
const ROW = 0.1; // m, rows of the edges for points inside
const cellKey = (gx: number, gy: number) => (gx + 32768) * 65536 + gy + 32768;

// rings (even-odd) to check points, lines and the body in quickly: the edges by row and in a grid
class Space {
  private segs: number[] = [];
  private rows = new Map<number, number[]>();
  private grid = new Map<number, number[]>();
  private seen: Int32Array;
  private stamp = 0;
  // a corner of each ring small enough to lie all inside something checked with covers()
  private small: number[] = [];

  constructor(rings: Point[][], smallSize = 0) {
    for (const r of rings) {
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        const k = this.segs.push(a.x, a.y, b.x, b.y) / 4 - 1;
        [x0, y0, x1, y1] = [Math.min(x0, a.x), Math.min(y0, a.y), Math.max(x1, a.x), Math.max(y1, a.y)];
        for (let gy = Math.floor(Math.min(a.y, b.y) / ROW); gy <= Math.floor(Math.max(a.y, b.y) / ROW); gy++) {
          const row = this.rows.get(gy);
          if (row) row.push(k);
          else this.rows.set(gy, [k]);
        }
        for (let gy = Math.floor(Math.min(a.y, b.y) / CELL); gy <= Math.floor(Math.max(a.y, b.y) / CELL); gy++) {
          for (let gx = Math.floor(Math.min(a.x, b.x) / CELL); gx <= Math.floor(Math.max(a.x, b.x) / CELL); gx++) {
            const list = this.grid.get(cellKey(gx, gy));
            if (list) list.push(k);
            else this.grid.set(cellKey(gx, gy), [k]);
          }
        }
      }
      if (r.length && Math.hypot(x1 - x0, y1 - y0) <= smallSize) this.small.push(r[0].x, r[0].y);
    }
    this.seen = new Int32Array(this.segs.length / 4);
  }

  get empty() {
    return !this.segs.length;
  }

  // crossings of a ray to the right, only the edges of its row can cross it
  inside(x: number, y: number): boolean {
    let inside = false;
    const s = this.segs;
    for (const k of this.rows.get(Math.floor(y / ROW)) ?? []) {
      const ay = s[4 * k + 1];
      const by = s[4 * k + 3];
      if (ay > y !== by > y) {
        const ax = s[4 * k];
        if (x < ax + ((y - ay) / (by - ay)) * (s[4 * k + 2] - ax)) inside = !inside;
      }
    }
    return inside;
  }

  // whether the line from p to q crosses an edge (the edges' grid cells around it once each)
  private crosses(px: number, py: number, qx: number, qy: number): boolean {
    const s = this.segs;
    const stamp = ++this.stamp;
    const dx = qx - px;
    const dy = qy - py;
    for (let gx = Math.floor(Math.min(px, qx) / CELL); gx <= Math.floor(Math.max(px, qx) / CELL); gx++) {
      for (let gy = Math.floor(Math.min(py, qy) / CELL); gy <= Math.floor(Math.max(py, qy) / CELL); gy++) {
        for (const k of this.grid.get(cellKey(gx, gy)) ?? []) {
          if (this.seen[k] === stamp) continue;
          this.seen[k] = stamp;
          const ax = s[4 * k];
          const ay = s[4 * k + 1];
          const ex = s[4 * k + 2] - ax;
          const ey = s[4 * k + 3] - ay;
          const den = dx * ey - dy * ex;
          if (den === 0) continue;
          const t = ((ax - px) * ey - (ay - py) * ex) / den;
          const u = ((ax - px) * dy - (ay - py) * dx) / den;
          if (t > 0 && t < 1 && u >= 0 && u < 1) return true;
        }
      }
    }
    return false;
  }

  // the convex polygon lies in the space: its corners in, its edges crossing none, no small ring in it
  // (closed false: a line through the points, the small rings aren't looked at)
  covers(pts: [number, number][], closed = true): boolean {
    for (const [x, y] of pts) if (!this.inside(x, y)) return false;
    for (let i = 0; i < (closed ? pts.length : pts.length - 1); i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[(i + 1) % pts.length];
      if (this.crosses(px, py, qx, qy)) return false;
    }
    if (!closed) return true;
    for (let k = 0; k < this.small.length; k += 2) {
      const ax = this.small[k];
      const ay = this.small[k + 1];
      let sign = 0;
      let inside = true;
      for (let i = 0; i < pts.length && inside; i++) {
        const [px, py] = pts[i];
        const [qx, qy] = pts[(i + 1) % pts.length];
        const side = Math.sign((qx - px) * (ay - py) - (qy - py) * (ax - px));
        if (side && sign && side !== sign) inside = false;
        if (side) sign = side;
      }
      if (inside) return false;
    }
    return true;
  }

  // the longest piece of the line from a to b in the space, from a's side to b's, null if none is minLength long
  clip(a: Point, b: Point, minLength: number): [Point, Point] | null {
    const s = this.segs;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ts = [0, 1];
    for (let k = 0; k < s.length; k += 4) {
      const ex = s[k + 2] - s[k];
      const ey = s[k + 3] - s[k + 1];
      const den = dx * ey - dy * ex;
      if (den === 0) continue;
      const t = ((s[k] - a.x) * ey - (s[k + 1] - a.y) * ex) / den;
      const u = ((s[k] - a.x) * dy - (s[k + 1] - a.y) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u < 1) ts.push(t);
    }
    ts.sort((p, q) => p - q);
    let best: [number, number] | null = null;
    for (let i = 0; i + 1 < ts.length; i++) {
      const m = (ts[i] + ts[i + 1]) / 2;
      if (!this.inside(a.x + m * dx, a.y + m * dy)) continue;
      if (!best || ts[i + 1] - ts[i] > best[1] - best[0]) best = [ts[i], ts[i + 1]];
    }
    if (!best || (best[1] - best[0]) * Math.hypot(dx, dy) < Math.max(minLength, 1e-6)) return null;
    const at = (t: number): Point => ({x: a.x + t * dx, y: a.y + t * dy});
    return [at(best[0]), at(best[1])];
  }
}

// the mower's body: a rectangle front ahead of its centre, rear behind, width wide, and where it may be
class Body {
  readonly half: number;
  readonly reach: number;
  private space: Space;
  // a centre in here fits whatever way it faces
  private safe: Space | null;

  constructor(rings: Point[][], safe: Point[][], width: number, private front: number, private rear: number) {
    this.half = width / 2;
    this.reach = Math.max(Math.hypot(front, this.half), Math.hypot(rear, this.half));
    this.space = new Space(rings, 2 * this.reach);
    this.safe = safe.length ? new Space(safe) : null;
  }

  fits(x: number, y: number, yaw: number): boolean {
    if (this.safe?.inside(x, y)) return true;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const f = this.front;
    const r = -this.rear;
    const h = this.half;
    return this.space.covers([
      [x + c * f - s * h, y + s * f + c * h],
      [x + c * r - s * h, y + s * r + c * h],
      [x + c * r + s * h, y + s * r - c * h],
      [x + c * f + s * h, y + s * f - c * h],
    ]);
  }
}

// m, the rings the body was along when they were recorded are simplified this much first
const DRIVEN_SIMPLIFY = 0.02;
// rad, a heading changing more than this is turning on the spot
const SPIN = (30 * Math.PI) / 180;

// where a body half wide each side and reaching ahead in front and behind was while its centre drove along the rings
// (each list an outline and its holes): every edge that much wider and longer, and all round the corners turning more
// than SPIN, like the planner's _driven
function drivenSpace(geoms: Point[][][], half: number, ahead: number): Paths {
  const parts: Paths = [];
  const reach = Math.hypot(half, ahead);
  for (const rings of geoms) {
    for (const ring of simplifyRings(rings, DRIVEN_SIMPLIFY)) {
      const n = ring.length;
      ring.forEach((b, i) => {
        const a = ring[(i - 1 + n) % n];
        const c = ring[(i + 1) % n];
        if (angleDiff(Math.atan2(c.y - b.y, c.x - b.x), Math.atan2(b.y - a.y, b.x - a.x)) > SPIN) {
          // (shapely's 16-gon)
          parts.push(toPath(Array.from({length: 16}, (_, k) => ({x: b.x + reach * Math.cos((k * Math.PI) / 8), y: b.y + reach * Math.sin((k * Math.PI) / 8)}))));
        }
      });
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % n];
        const length = dist(a, b);
        if (length < 1e-9) return;
        const ux = (b.x - a.x) / length;
        const uy = (b.y - a.y) / length;
        const p = {x: a.x - ahead * ux, y: a.y - ahead * uy};
        const q = {x: b.x + ahead * ux, y: b.y + ahead * uy};
        parts.push(
          ccw(
            toPath([
              {x: p.x - half * uy, y: p.y + half * ux},
              {x: q.x - half * uy, y: q.y + half * ux},
              {x: q.x + half * uy, y: q.y - half * ux},
              {x: p.x + half * uy, y: p.y - half * ux},
            ]),
          ),
        );
      });
    }
  }
  return clip(parts, [], ClipperLib.ClipType.ctUnion);
}

// where the centre may go for turns and to clip lanes, like the planner's drive_space: the room, on recorded edges with
// the body checked body_tolerance past it (not into an area to keep out of)
function driveSpace(input: PlannerEstimateInput, room: Paths): Paths {
  const b = input.body;
  const tolerance = b?.tolerance ?? 0.05;
  if (!b || !b.recorded || b.width <= 0 || b.front + b.rear <= 0 || tolerance <= 0 || !room.length) return room;
  let space = grow(room, tolerance, ClipperLib.JoinType.jtRound);
  const keepOut = b.keepOut.filter((k) => k.length > 2).map((k) => ccw(toPath(k)));
  if (keepOut.length) space = clip(space, keepOut, ClipperLib.ClipType.ctDifference);
  return space;
}

// where the body may be: the area and the other lawns, on recorded edges also where the body was when they were
// recorded, grown by the tolerance (square corners), without the areas nothing goes over
function bodyOf(input: PlannerEstimateInput, free: Paths, freeRings: Point[][]): Body | null {
  const b = input.body;
  if (!b || b.width <= 0 || b.front + b.rear <= 0) return null;
  const others = b.drivable.filter((d) => d.length > 2).map((d) => fromPath(ccw(toPath(d))));
  let space = clip(free, others.map(toPath), ClipperLib.ClipType.ctUnion);
  if (b.recorded) {
    const geoms = [freeRings, ...others.map((o) => [o])];
    space = clip(space, drivenSpace(geoms, b.width / 2, Math.max(b.front, b.rear)), ClipperLib.ClipType.ctUnion);
  }
  space = grow(space, b.tolerance ?? 0.05, ClipperLib.JoinType.jtMiter);
  const keepOut = b.keepOut.filter((k) => k.length > 2).map((k) => ccw(toPath(k)));
  if (keepOut.length) space = clip(space, keepOut, ClipperLib.ClipType.ctDifference);
  const reach = Math.max(Math.hypot(b.front, b.width / 2), Math.hypot(b.rear, b.width / 2));
  return new Body(ringsOf(space), ringsOf(inset(space, reach)), b.width, b.front, b.rear);
}

// like the planner's sample_arc: forwards on a circle from (x, y) facing heading, turning by turn (rad, > 0 left)
function sampleArc(x: number, y: number, heading: number, radius: number, turn: number, step: number) {
  const side = turn >= 0 ? 1 : -1;
  const cx = x - side * radius * Math.sin(heading);
  const cy = y + side * radius * Math.cos(heading);
  let n = Math.abs(turn) / MAX_ARC_STEP;
  if (step > 0) n = Math.max(n, (Math.abs(turn) * radius) / step);
  n = Math.max(1, Math.ceil(n - 1e-9));
  const out: {x: number; y: number; yaw: number}[] = [];
  for (let i = 0; i <= n; i++) {
    const h = heading + (turn * i) / n;
    out.push({x: cx + side * radius * Math.sin(h), y: cy - side * radius * Math.cos(h), yaw: h});
  }
  return out;
}

// like the planner's body_ends: the lane pulled back at its ends until the body fits there, and on the quarter arcs
// of the turns it arrives and leaves on (1 from or to the left, -1 the right, 0 none). null if too little is left
function bodyEnds(body: Body, a: Point, b: Point, yaw: number, arrive: number, leave: number, r: number,
                  step: number, minLength: number): [Point, Point] | null {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = Math.cos(yaw);
  const uy = Math.sin(yaw);
  const quarter = Math.PI / 2;
  const fits = (t: number) => {
    const x = a.x + t * ux;
    const y = a.y + t * uy;
    if (!body.fits(x, y, yaw)) return false;
    if (r <= 1e-3) return true;
    // leaving at the end, arriving at the start (worked out backwards, facing the other way)
    if (t > 0.5 * length) return !leave || sampleArc(x, y, yaw, r, leave * quarter, step).every((p) => body.fits(p.x, p.y, p.yaw));
    return !arrive || sampleArc(x, y, yaw + Math.PI, r, -arrive * quarter, step).every((p) => body.fits(p.x, p.y, p.yaw + Math.PI));
  };
  const edge = (inside: number, outside: number) => {
    while (Math.abs(outside - inside) > BODY_STEP) {
      const t = 0.5 * (inside + outside);
      if (fits(t)) inside = t;
      else outside = t;
    }
    return inside;
  };
  const fits0 = fits(0);
  const fits1 = fits(length);
  if (fits0 && fits1) return [a, b];
  // the body and a turn reach no further than this past the lane's end
  const mid = 0.5 * length;
  const near = Math.min(mid, 2 * (body.reach + r));
  if (!fits(mid)) return null;
  const t0 = fits0 ? 0 : edge(fits(near) ? near : mid, 0);
  const t1 = fits1 ? length : edge(fits(length - near) ? length - near : mid, length);
  if (t1 - t0 < Math.max(minLength, 1e-6)) return null;
  return [
    {x: a.x + t0 * ux, y: a.y + t0 * uy},
    {x: a.x + t1 * ux, y: a.y + t1 * uy},
  ];
}

// the rows' lanes grouped into cells mowed in one zigzag, like the planner's split_cells
function splitCells(rows: Lane[][]): Lane[][] {
  const cells: Lane[][] = [];
  let open = new Map<number, Lane[]>();
  let prev: Lane[] = [];
  for (const lanes of rows) {
    const succ = prev.map(() => [] as number[]);
    const pred = lanes.map(() => [] as number[]);
    prev.forEach((p, i) =>
      lanes.forEach((q, k) => {
        if (p.x0 < q.x1 && q.x0 < p.x1) {
          succ[i].push(k);
          pred[k].push(i);
        }
      }),
    );
    const now = new Map<number, Lane[]>();
    lanes.forEach((q, k) => {
      const ps = pred[k];
      let cell: Lane[];
      if (ps.length === 1 && succ[ps[0]].length === 1 && open.has(ps[0])) {
        cell = open.get(ps[0])!;
        cell.push(q);
      } else {
        cell = [q];
        cells.push(cell);
      }
      now.set(k, cell);
    });
    open = now;
    prev = lanes;
  }
  return cells;
}

// the order the planner mows a cell's lanes in (visit_order): with skip lanes k apart, room for a U-turn
function visitOrder(lanes: Lane[], laneOrder: string, turnRadius: number, bladeOffset: number): Lane[] {
  if (laneOrder !== 'skip' || lanes.length < 3) return lanes;
  const spacing = Math.abs(lanes[1].y - lanes[0].y);
  if (spacing <= 0) return lanes;
  const k = Math.max(1, Math.ceil((2 * turnRadius + 2 * Math.abs(bladeOffset)) / spacing - 1e-9));
  const n = lanes.length;
  if (n < 2 * k) {
    // too few lanes: from the middle, every step about half the cell wide
    const m = Math.floor(n / 2);
    const order: number[] = [];
    for (let i = 0; i < m; i++) order.push(m + i, i);
    if (n % 2) order.push(n - 1);
    return order.map((i) => lanes[i]);
  }
  const out: Lane[] = [];
  for (let p = 0; p < k; p++) for (let i = p; i < n; i += k) out.push(lanes[i]);
  return out;
}

// m, the loops on the map are simplified this much: a fraction of the points, and nothing to see
const DRAWN = 0.005;

// the rings of the paths, closed: the map draws them as loops
const closed = (paths: Paths) => ringsOf(paths).map((r) => simplifyLine([...r, r[0]], DRAWN));

const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

type Closest = {i: number; q: Point; d: number};

// the closest point on segment i of the polyline
function onSegment(pts: Point[], i: number, p: Point): Closest {
  const a = pts[i];
  const b = pts[i + 1];
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len2 = ex * ex + ey * ey;
  const t = len2 <= 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2));
  const q = {x: a.x + t * ex, y: a.y + t * ey};
  return {i, q, d: Math.hypot(p.x - q.x, p.y - q.y)};
}

// like the planner's closest_on_polyline
function closestOnPolyline(pts: Point[], p: Point): Closest {
  let best: Closest = {i: 0, q: pts[0], d: Infinity};
  for (let i = 0; i + 1 < pts.length; i++) {
    const c = onSegment(pts, i, p);
    if (c.d < best.d) best = c;
  }
  return best;
}

// a loop (closed polyline) with its segments in a grid, for the closest point on it quickly
class Ring {
  readonly pts: Point[];
  readonly box: [number, number, number, number];
  private grid = new Map<number, number[]>();

  constructor(
    readonly ring: Point[],
    readonly hole: boolean,
    readonly depth: number,
  ) {
    this.pts = [...ring, ring[0]];
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 1 < this.pts.length; i++) {
      const a = this.pts[i];
      const b = this.pts[i + 1];
      [x0, y0, x1, y1] = [Math.min(x0, a.x), Math.min(y0, a.y), Math.max(x1, a.x), Math.max(y1, a.y)];
      for (let gx = Math.floor(Math.min(a.x, b.x) / CELL); gx <= Math.floor(Math.max(a.x, b.x) / CELL); gx++) {
        for (let gy = Math.floor(Math.min(a.y, b.y) / CELL); gy <= Math.floor(Math.max(a.y, b.y) / CELL); gy++) {
          const list = this.grid.get(cellKey(gx, gy));
          if (list) list.push(i);
          else this.grid.set(cellKey(gx, gy), [i]);
        }
      }
    }
    this.box = [x0, y0, x1, y1];
  }

  // the closest point to p, none closer than max: null
  closest(p: Point, max = Infinity): Closest | null {
    const [x0, y0, x1, y1] = this.box;
    const far = Math.max(Math.abs(p.x - x0), Math.abs(p.x - x1), Math.abs(p.y - y0), Math.abs(p.y - y1));
    const gx = Math.floor(p.x / CELL);
    const gy = Math.floor(p.y / CELL);
    let best: Closest = {i: -1, q: p, d: max};
    // cells further out than ring n are at least n cells away
    for (let n = 0; n <= Math.ceil(far / CELL) + 1; n++) {
      for (let x = gx - n; x <= gx + n; x++) {
        for (let y = gy - n; y <= gy + n; y++) {
          if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) !== n) continue;
          for (const i of this.grid.get(cellKey(x, y)) ?? []) {
            const c = onSegment(this.pts, i, p);
            if (c.d < best.d) best = c;
          }
        }
      }
      if (best.d <= n * CELL || n * CELL > max) break;
    }
    return best.i < 0 ? null : best;
  }
}

// the closest points of two loops (on a and on b), none closer than max: d Infinity. Two lines that don't cross are
// closest at a corner of one of them
const boxGap = (a: Ring, b: Ring) => Math.max(a.box[0] - b.box[2], b.box[0] - a.box[2], a.box[1] - b.box[3], b.box[1] - a.box[3], 0);
const boxDistance = (p: Point, [x0, y0, x1, y1]: [number, number, number, number]) =>
  Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(y0 - p.y, 0, p.y - y1));

function between(a: Ring, b: Ring, max = Infinity): {d: number; p: Point; q: Point} {
  let best = {d: Infinity, p: a.pts[0], q: b.pts[0]};
  if (boxGap(a, b) > max) return best;
  for (const v of a.ring) {
    if (boxDistance(v, b.box) >= Math.min(max, best.d)) continue;
    const c = b.closest(v, Math.min(max, best.d));
    if (c && c.d < best.d) best = {d: c.d, p: v, q: c.q};
  }
  for (const v of b.ring) {
    if (boxDistance(v, a.box) >= Math.min(max, best.d)) continue;
    const c = a.closest(v, Math.min(max, best.d));
    if (c && c.d < best.d) best = {d: c.d, p: c.q, q: v};
  }
  return best;
}

// like the planner's _splice: ring with a trip round other from the closest points between them (p on ring, q on
// other), over to other, round it and back, on along ring. lead: it leaves ring that far before that point and gets
// back that far after it, and goes round other from that far after to that far before its point (hops at a slant)
function splice(ring: Point[], other: Point[], p: Point, q: Point, lead: number): Point[] {
  // pts (closed) from lead after the point closest to near round to lead before it
  const fromTo = (pts: Point[], near: Point): Point[] => {
    const c = closestOnPolyline(pts, near);
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + dist(pts[k - 1], pts[k]));
    const n = cum[cum.length - 1];
    const d = Math.min(lead, 0.25 * n);
    const t0 = cum[c.i] + dist(pts[c.i], c.q) + d;
    const point = (t: number): Point => {
      t = ((t % n) + n) % n;
      let k = 0;
      while (k + 1 < cum.length && cum[k + 1] <= t) k++;
      k = Math.min(k, pts.length - 2);
      const f = (t - cum[k]) / Math.max(cum[k + 1] - cum[k], 1e-12);
      return {x: pts[k].x + f * (pts[k + 1].x - pts[k].x), y: pts[k].y + f * (pts[k + 1].y - pts[k].y)};
    };
    const span = n - 2 * d;
    const inner = pts
      .slice(0, -1)
      .map((pt, k) => ({t: (((cum[k] - t0) % n) + n) % n, pt}))
      .sort((a, b) => a.t - b.t)
      .filter(({t}) => t > 1e-9 && t < span - 1e-9)
      .map(({pt}) => pt);
    return [point(t0), ...inner, point(t0 + span)];
  };
  return [...fromTo([...ring, ring[0]], p), ...fromTo([...other, other[0]], q)];
}

// like the planner's _clear_of_corners: a loop's start moved on segment i away from a corner next to it
function clearOfCorners(pts: Point[], i: number, entry: Point, keep: number): Point {
  const n = pts.length - 1;
  const a = pts[i];
  const b = pts[i + 1];
  const length = dist(a, b);
  if (keep <= 0 || length < 1e-9) return entry;
  let t = dist(a, entry);
  const corner = (k: number) => {
    const p = pts[(((k - 1) % n) + n) % n];
    const q = pts[k % n];
    const r = pts[(k + 1) % n];
    return angleDiff(Math.atan2(r.y - q.y, r.x - q.x), Math.atan2(q.y - p.y, q.x - p.x)) > CORNER_ANGLE;
  };
  if (t < keep && corner(i)) t = Math.min(keep, 0.5 * length);
  else if (length - t < keep && corner(i + 1)) t = Math.max(length - keep, 0.5 * length);
  else return entry;
  return {x: a.x + ((b.x - a.x) * t) / length, y: a.y + ((b.y - a.y) * t) / length};
}

function firstDirection(loop: Point[]): Point | null {
  for (const p of loop.slice(1)) {
    const d = dist(loop[0], p);
    if (d > 1e-7) return {x: (p.x - loop[0].x) / d, y: (p.y - loop[0].y) / d};
  }
  return null;
}

// where the mower is and the way it faces, started: it has driven (a loop goes on from where it is, a little ahead)
type RouteState = {pos: Point; heading: number | null; started: boolean};

// the rings of the paths in the planner's order (rings()): the polygons by their lower left corner (minx, miny), each
// outline (counter-clockwise) and then its holes (clockwise) by theirs
function ringsWithKind(paths: Paths, depth: number): Ring[] {
  const corner = (p: ClipperLib.Path): [number, number] => [Math.min(...p.map((q) => q.X)), Math.min(...p.map((q) => q.Y))];
  const before = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];
  const out: Ring[] = [];
  for (const [outline, ...holes] of partsOf(paths).sort((a, b) => before(corner(a[0]), corner(b[0])))) {
    for (const p of [ccw(outline), ...holes.sort((a, b) => before(corner(a), corner(b))).map((h) => [...ccw(h)].reverse())]) {
      if (p.length >= 3) out.push(new Ring(fromPath(p), ClipperLib.Clipper.Area(p) < 0, depth));
    }
  }
  return out;
}

// a point inside the ring (on a line across its middle)
function insidePoint(ring: Point[]): Point {
  const ys = ring.map((p) => p.y);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  const xs: number[] = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    if (a.y <= y !== b.y <= y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  });
  xs.sort((p, q) => p - q);
  return {x: xs.length >= 2 ? (xs[0] + xs[1]) / 2 : ring[0].x, y};
}

function insideRing(ring: Point[], p: Point): boolean {
  let inside = false;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  });
  return inside;
}

// what the loops do to where the mower is, like the planner's route (drive_ring, perimeter, concentric): each loop
// starts closest to where the mower is (a little ahead once it drives), goes round the way it faces and ends there
class LoopRoute {
  // m, driven from one loop to the next
  between = 0;

  constructor(
    private state: RouteState,
    private spacing: number,
    private cornerRadius: number,
    private direction: string,
    // where the plan ends (the docking station): the last of the loops driven as one part starts and ends closest to it
    private end: Point | null = null,
  ) {}

  private distance(ring: Ring) {
    return ring.closest(this.state.pos)?.d ?? Infinity;
  }

  drive(ring: Ring, toEnd = false) {
    const s = this.state;
    let target = s.pos;
    if (toEnd && this.end) target = this.end;
    else if (s.started && s.heading !== null) {
      const lead = 2 * this.spacing;
      target = {x: s.pos.x + lead * Math.cos(s.heading), y: s.pos.y + lead * Math.sin(s.heading)};
    }
    const c = closestOnPolyline(ring.pts, target);
    const entry = clearOfCorners(ring.pts, c.i, c.q, 2 * this.cornerRadius);
    if (s.started) this.between += dist(s.pos, entry);
    let loop = [entry, ...ring.pts.slice(c.i + 1), ...ring.pts.slice(1, c.i + 1), entry];
    let flip = false;
    if (this.direction === 'auto') {
      if (s.heading !== null) {
        const fwd = firstDirection(loop);
        const back = firstDirection([...loop].reverse());
        const hx = Math.cos(s.heading);
        const hy = Math.sin(s.heading);
        flip = !!fwd && !!back && hx * back.x + hy * back.y > hx * fwd.x + hy * fwd.y + 1e-9;
      }
    } else flip = (this.direction === 'cw') !== ring.hole;
    if (flip) loop = loop.reverse();
    // it ends where it started, coming along its last piece
    const back = firstDirection([...loop].reverse());
    s.pos = entry;
    if (back) s.heading = Math.atan2(-back.y, -back.x);
    s.started = true;
  }

  // the loops along the outline level by level, then around each obstacle from its outermost loop in
  perimeter(levels: Paths[], holes: Point[][]) {
    const marks = holes.map(insidePoint);
    const outlines: Ring[][] = [];
    const groups = new Map<number, Ring[]>();
    let spare = holes.length;
    levels.forEach((level, k) => {
      const rings = ringsWithKind(level, k);
      outlines.push(rings.filter((r) => !r.hole));
      for (const r of rings.filter((r) => r.hole)) {
        let key = marks.findIndex((m) => insideRing(r.ring, m));
        if (key < 0) key = spare++;
        const group = groups.get(key);
        if (group) group.push(r);
        else groups.set(key, [r]);
      }
    });
    for (const level of outlines.filter((l) => l.length)) {
      const todo = [...level];
      while (todo.length) {
        const ds = todo.map((r) => this.distance(r));
        this.drive(todo.splice(ds.indexOf(Math.min(...ds)), 1)[0]);
      }
    }
    const todo = [...groups.values()].map((g) => [...g].reverse());
    while (todo.length) {
      const ds = todo.map((g) => this.distance(g[0]));
      for (const r of todo.splice(ds.indexOf(Math.min(...ds)), 1)[0]) this.drive(r);
    }
  }

  // every loop of every level (and the ones halfway in, middles[k] after level k), each after the loops further out
  // next to it, the closest ready one next. spliced: every loop further in is driven from the loop closest to it
  concentric(levels: Paths[], middles: Paths[], spliced: boolean) {
    let loops: Ring[] = [];
    levels.forEach((g, k) => loops.push(...ringsWithKind(g, k)));
    middles.forEach((g, k) => loops.push(...ringsWithKind(g, k + 0.5)));
    loops.sort((a, b) => a.depth - b.depth);
    if (spliced) {
      // from the innermost out, each loop into the closest loop further out (of those about as close the one furthest
      // in), not into the outermost ones
      const items: (Ring | null)[] = [...loops];
      const order = items.map((_, i) => i).sort((a, b) => loops[b].depth - loops[a].depth);
      for (const at of order) {
        const item = items[at]!;
        const outer = items.map((o, i) => [o, i] as const).filter(([o]) => o && o.depth > 0 && o.depth < item.depth) as [Ring, number][];
        if (!outer.length) continue;
        // the closest first (by their boxes): one further than the closest + half a spacing doesn't count
        const gaps = outer.map(() => ({d: Infinity, p: item.pts[0], q: item.pts[0]}));
        let closest = Infinity;
        for (const i of outer.map((_, i) => i).sort((p, q) => boxGap(outer[p][0], item) - boxGap(outer[q][0], item))) {
          if (boxGap(outer[i][0], item) > closest + 0.5 * this.spacing) break;
          gaps[i] = between(outer[i][0], item, closest + 0.5 * this.spacing);
          closest = Math.min(closest, gaps[i].d);
        }
        let parent = -1;
        outer.forEach(([o], i) => {
          if (gaps[i].d <= closest + 0.5 * this.spacing && (parent < 0 || o.depth > outer[parent][0].depth)) parent = i;
        });
        const [p, pi] = outer[parent];
        items[pi] = new Ring(splice(p.ring, item.ring, gaps[parent].p, gaps[parent].q, this.spacing), p.hole, p.depth);
        items[at] = null;
      }
      loops = items.filter((o): o is Ring => !!o);
    }
    const near = 1.5 * this.spacing;
    const waits = loops.map((l) => loops.map((o, j) => [o, j] as const).filter(([o]) => l.depth - 1 <= o.depth && o.depth < l.depth && between(l, o, near).d <= near).map(([, j]) => j));
    const done = new Set<number>();
    while (done.size < loops.length) {
      let ready = loops.map((_, i) => i).filter((i) => !done.has(i) && waits[i].every((j) => done.has(j)));
      if (!ready.length) ready = loops.map((_, i) => i).filter((i) => !done.has(i));
      const ds = ready.map((i) => this.distance(loops[i]));
      const i = ready[ds.indexOf(Math.min(...ds))];
      done.add(i);
      this.drive(loops[i], done.size === loops.length);
    }
  }
}

type Pose = {x: number; y: number; yaw: number};

function straight(x0: number, y0: number, x1: number, y1: number, yaw: number, step: number): Pose[] {
  const n = step > 0 ? Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step - 1e-9)) : 1;
  return Array.from({length: n + 1}, (_, i) => ({x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n, yaw}));
}

// the planner's turns from the end of a lane (at the origin facing +x) into the next one, starting at (dx, d) and
// driven the other way: u_turn where the lanes are two radii apart, bulb where they're closer.
// The turn goes level with the longer lane, the shorter one carried on straight to get there. Poses, null: none
function turnShape(name: string, d: number, dx: number, r: number, step: number): Pose[] | null {
  const a = Math.max(dx, 0);
  const b = Math.max(-dx, 0);
  const leadIn = a > 1e-9 ? straight(0, 0, a, 0, 0, step) : [];
  const leadOut = b > 1e-9 ? straight(a, d, a - b, d, Math.PI, step) : [];
  if (name === 'u_turn') {
    if (d < 2 * r - 1e-9) return null;
    return [
      ...leadIn,
      ...sampleArc(a, 0, 0, r, Math.PI / 2, step),
      ...(d - 2 * r > 1e-9 ? straight(a + r, r, a + r, d - r, Math.PI / 2, step) : []),
      ...sampleArc(a + r, d - r, Math.PI / 2, r, Math.PI / 2, step),
      ...leadOut,
    ];
  }
  if (d >= 2 * r || r <= 1e-9) return null;
  if (name === 'bulb') {
    // swerve right, loop left round a centre halfway between the lanes, swerve right
    const theta = Math.acos((d + 2 * r) / (4 * r));
    const first = sampleArc(a, 0, 0, r, -theta, step);
    const f = first[first.length - 1];
    const loop = sampleArc(f.x, f.y, f.yaw, r, Math.PI + 2 * theta, step);
    const l = loop[loop.length - 1];
    const last = sampleArc(l.x, l.y, l.yaw, r, -theta, step);
    last[last.length - 1] = {x: a, y: d, yaw: Math.PI};
    return [...leadIn, ...first, ...loop, ...last, ...leadOut];
  }
  return null;
}

// whether one of the turns (types, preferred first, larger radii first) gets from exit into a lane starting at entry,
// the centre in the room and the body where it may be, like the planner's plan_turn
function turnFits(exit: Pose, entry: Point, radius: number, step: number, types: string[], room: Space, body: Body, least = 0): boolean {
  const c = Math.cos(exit.yaw);
  const s = Math.sin(exit.yaw);
  const vx = entry.x - exit.x;
  const vy = entry.y - exit.y;
  const dx = vx * c + vy * s;
  const lateral = -vx * s + vy * c;
  const side = lateral >= 0 ? 1 : -1;
  const d = Math.abs(lateral);
  if (d < 1e-6) return false;
  const radii: number[] = [];
  for (const r of [radius, 0.75 * radius, 0.5 * radius, 0.5 * d]) {
    if (r > Math.max(1e-3, least - 1e-9) && r <= radius + 1e-9 && radii.every((o) => Math.abs(r - o) > 1e-3)) radii.push(r);
  }
  radii.sort((p, q) => q - p);
  for (const r of radii) {
    for (const name of types) {
      if (!['u_turn', 'bulb'].includes(name) || (name === 'u_turn') !== d >= 2 * r - 1e-9) continue;
      const local = turnShape(name, d, dx, r, step);
      if (!local) continue;
      const poses = local.map((p) => ({x: exit.x + p.x * c - side * p.y * s, y: exit.y + p.x * s + side * p.y * c, yaw: exit.yaw + side * p.yaw}));
      if (room.covers(poses.map((p): [number, number] => [p.x, p.y]), false) && [exit, ...poses].every((p) => body.fits(p.x, p.y, p.yaw))) return true;
    }
  }
  return false;
}

// what doesn't change with the angle, kept for a few areas: dragging the angle only moves the lanes
interface Prepared {
  free: Paths;
  half: number;
  loops: Point[][];
  region: Point[][];
  target: Point[][];
  roomRings: Point[][];
  room: Space;
  // the same a hair wider, like the planner's checks whether a turn is free (a lane end lies right on its edge)
  turnRoom: Space;
  body: Body | null;
  // where the mower is when the lanes start
  state: RouteState;
  between: number; // m, the drives between the loops
  loopsEnd: boolean;
  passes: number;
  angles: Map<string, number>;
}
const PREPARED = new Map<string, Prepared | null>();
const KEEP = 6;

function prepare(input: PlannerEstimateInput): Prepared | null {
  const key = JSON.stringify([
    input.outline, input.holes, input.spacing, input.bladeWidth, input.perimeterOffset, input.passes, input.overlapPasses,
    input.fillPattern === 'concentric', input.minLaneLength, input.narrowParts, input.turnRadius, input.bladeOffset,
    input.body, input.start, input.perimeterOrder, input.perimeterDirection, input.cornerRadius, input.simplifyTolerance,
    input.edgeMargin, input.holeMargins,
  ]);
  if (PREPARED.has(key)) {
    const known = PREPARED.get(key)!;
    PREPARED.delete(key);
    PREPARED.set(key, known);
    return known;
  }
  const found = prepareNow(input);
  PREPARED.set(key, found);
  if (PREPARED.size > KEEP) PREPARED.delete(PREPARED.keys().next().value!);
  return found;
}

// like the planner's PlannerConfig.passes for perimeter_passes -1: as many loops as mow the strip along the edges the
// lanes don't get to. A lane ends where its turn (a quarter arc, the body round it) stays in what the edges allow, the
// blade blade_ahead further in. width: the blade (mower_width)
export function autoPasses(input: PlannerEstimateInput, width: number): number {
  const half = width / 2;
  const first = input.perimeterOffset;
  const centre = first + Math.abs(input.bladeOffset ?? 0);
  const r = input.turnRadius ?? 0.25;
  const b = input.body;
  let end: number;
  if (b && b.width > 0 && b.front + b.rear > 0) {
    const out = Math.hypot(r + b.width / 2, Math.max(b.front, b.rear));
    const allowed = (b.recorded ? b.width / 2 : 0) + (b.tolerance ?? 0.05);
    end = Math.max(centre, out - allowed);
  } else end = centre + r;
  const strip = end + Math.abs(input.bladeAhead ?? 0) - half;
  return Math.max(1, Math.ceil((strip - half - first) / input.spacing - 1e-9) + 1);
}

function prepareNow(input: PlannerEstimateInput): Prepared | null {
  const width = Math.max(input.bladeWidth, input.spacing);
  const half = width / 2;
  const first = Math.max(input.perimeterOffset, input.edgeMargin ?? 0);
  // a hole whose loops keep further off than the first loop does: that much bigger, the loops go round it at first
  const holes = input.holes.map((h, i) => {
    const extra = (input.holeMargins?.[i] ?? 0) - first;
    if (extra <= 0.001 || h.length < 3) return h;
    const grown = grow([ccw(toPath(h))], extra, ClipperLib.JoinType.jtRound).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
    return grown.length ? fromPath(grown[0]) : h;
  });
  const found = freeSpace(input.outline, holes, half, input.simplifyTolerance ?? 0.01);
  let free = found.paths;
  let freeRings = found.rings;
  if (!free.length) return null;
  const lateral = input.bladeOffset ?? 0;
  // an area to keep out of is a wall, recorded edges or not: the first loop keeps the body off it (half its width, as
  // with hard edges), what that leaves along it isn't mowed
  const b = input.body;
  const away = b && b.width > 0 && b.front + b.rear > 0 ? b.keepOut.filter((k) => k.length > 2).map((k) => ccw(toPath(k))) : [];
  if (b && away.length) {
    const wall = 0.5 * b.width - Math.abs(lateral) - first;
    const walled = clip(free, wall > 0 ? grow(away, wall, ClipperLib.JoinType.jtRound) : away, ClipperLib.ClipType.ctDifference);
    if (Math.abs(partArea(walled)) < Math.abs(partArea(free)) - 1e-9) {
      free = partsOf(walled)
        .filter((p) => partArea(p) >= half * half)
        .flat();
      freeRings = ringsOf(free);
      if (!free.length) return null;
    }
  }
  const spacing = input.spacing;
  const concentric = input.fillPattern === 'concentric';
  const count = input.passes < 0 ? autoPasses(input, width) : Math.max(0, Math.round(input.passes));
  // rings meet at the corners, at a right angle the blade only covers up to width / sqrt 2 there
  const loopSpacing = concentric ? Math.min(spacing, width / Math.SQRT2) : spacing;
  const r = input.turnRadius ?? 0.25;
  const round = ClipperLib.JoinType.jtRound;
  const diff = ClipperLib.ClipType.ctDifference;
  const pieces = (paths: Paths, min: number) => partsOf(paths).filter((p) => partArea(p) >= min).flat();

  // 1. the loops, level k loopSpacing further in each, concentric until nothing is left
  const levels: Paths[] = [];
  while ((concentric || levels.length < count) && levels.length < MAX_ROWS) {
    const level = inset(free, first + levels.length * loopSpacing);
    if (!level.length) break;
    levels.push(level);
  }
  const perimeterLevels = levels.slice(0, count);
  // where level k ends and inner, the next one in, doesn't get there: one more loop halfway in
  const middle = (k: number, inner: Paths, step: number) => {
    let halfIn = inset(levels[k], step / 2);
    if (halfIn.length && inner.length) halfIn = clip(halfIn, grow(inner, step, round), diff);
    return pieces(halfIn, half * half);
  };
  let middles = concentric ? levels.map((_, k) => middle(k, levels[k + 1] ?? [], loopSpacing)) : [];

  // 2. the lanes: in what the loops the lanes don't reach under leave
  // (within half of a level's rings: the level grown by half without the level shrunk by half)
  const strip = (level: Paths) => clip(grow(level, half, round), inset(level, half), diff);
  const remaining = perimeterLevels.length ? clip(free, perimeterLevels.flatMap(strip), diff) : free;
  const lanePasses = Math.max(0, count - Math.max(0, Math.round(input.overlapPasses)));
  let laneRegion = concentric ? [] : inset(free, first + lanePasses * spacing);
  // narrow_parts loops: where the lane region is narrower than a U-turn the loops go on in, the lanes only where
  // it's wider (not here: the strips too narrow for lanes the planner gives a loop of their own otherwise)
  let ringed = concentric;
  if (input.narrowParts === 'loops' && !concentric && r > 0 && levels.length === count && laneRegion.length) {
    const opened = grow(inset(laneRegion, r), r, round);
    // what that takes away: narrow parts, and the tips of corners (smaller than r * r), which keep their lanes
    const cut = partsOf(clip(laneRegion, opened, diff)).filter((p) => partArea(p) >= r * r);
    if (cut.length) {
      // bits left between narrow parts too small for more than a few lanes go to the loops as well
      // (no hairline spikes left, like the planner opening it by a hair: the first row of lanes would go by one)
      const wide = pieces(ClipperLib.Clipper.CleanPolygons(clip(laneRegion, cut.flat(), diff), 1.5), (4 * r) ** 2);
      const keepOff = wide.length ? grow(wide, half, round) : null;
      while (levels.length < MAX_ROWS) {
        let level = inset(free, first + levels.length * spacing);
        if (keepOff && level.length) level = pieces(clip(level, keepOff, diff), half * half);
        if (!level.length) break;
        levels.push(level);
      }
      middles = levels.map((_, k) => {
        const inner = levels[k + 1] ?? [];
        return middle(k, k + 1 >= lanePasses ? clip(inner, wide, ClipperLib.ClipType.ctUnion) : inner, spacing);
      });
      laneRegion = wide;
      ringed = true;
    }
  }
  const loops: Point[][] = [];
  for (const level of levels) loops.push(...closed(level));
  if (ringed) for (const m of middles) loops.push(...closed(m));

  // where the mower is when the lanes start: at the start (the docking station), or where the loops before them end
  const state: RouteState = {
    pos: input.start ? {x: input.start.x, y: input.start.y} : input.outline[0],
    heading: input.start?.heading ?? null,
    started: false,
  };
  const last = input.perimeterOrder === 'last';
  // (with the loops last only their drives count, from where they start: about the same)
  const route = new LoopRoute(
    last ? {...state} : state,
    spacing,
    input.cornerRadius ?? 0.15,
    input.perimeterDirection ?? 'auto',
    input.start ? {x: input.start.x, y: input.start.y} : null,
  );
  if (ringed) route.concentric(levels, middles, !concentric);
  else route.perimeter(perimeterLevels, ringsWithKind(free, 0).filter((h) => h.hole).map((h) => h.ring));
  const roomRings = ringsOf(inset(free, first + Math.abs(lateral)));
  const drive = driveSpace(input, inset(free, first + Math.abs(lateral)));
  return {
    free,
    half,
    loops,
    region: ringsOf(laneRegion),
    target: ringsOf(remaining),
    roomRings,
    room: new Space(ringsOf(drive)),
    turnRoom: new Space(ringsOf(grow(drive, 1e-3, ClipperLib.JoinType.jtRound))),
    body: bodyOf(input, free, freeRings),
    state,
    between: route.between,
    // the end point counts for what's mowed last: the lanes, unless the loops come after them
    loopsEnd: last && !ringed && perimeterLevels.length > 0,
    passes: count,
    angles: new Map(),
  };
}

export function plannerEstimate(input: PlannerEstimateInput): PlannerEstimate | null {
  if (input.outline.length < 3 || input.spacing <= 0) return null;
  const prep = prepare(input);
  if (!prep) return null;
  const {region, target, roomRings, half} = prep;
  const spacing = input.spacing;
  let angle: number;
  if (input.angle !== null) angle = input.angle;
  else {
    const key = JSON.stringify([input.strategy, input.angleStep, input.angleMin, input.angleMax]);
    let found = prep.angles.get(key);
    if (found === undefined) {
      if (input.strategy === 'min_width') found = minWidthAngle(ringsOf(prep.free).flat());
      else if (input.strategy === 'optimal' && region.length) {
        found = optimalAngle(region, input, longestEdgeAngle(input.outline), target, roomRings, half);
      } else found = longestEdgeAngle(input.outline);
      prep.angles.set(key, found);
    }
    angle = found;
  }
  angle = angleInRange(angle + input.angleOffset, input.angleMin, input.angleMax);
  angle = ((angle % Math.PI) + Math.PI) % Math.PI;

  // 3. lanes, for crosshatch a second time across them
  const passes: {a: number; cells: Lane[][]}[] = [];
  if (input.fillPattern !== 'concentric' && region.length) {
    const angles = [angle];
    if (input.fillPattern === 'crosshatch') {
      const second = (angle + input.crosshatchAngle) % Math.PI;
      angles.push(second < 0 ? second + Math.PI : second);
    }
    for (const a of angles) {
      passes.push({a, cells: splitCells(scanLanes(region, a, spacing, input.minLaneLength, target, roomRings, half))});
    }
  }

  // 4. the order, like the planner's route from the docking station and back (mower_logic plans so): the cells
  // closest first, each from the end and the way round closest to where the mower is, the lanes' directions
  // alternating. Not here: the turns, the order 'optimized', parts of the area with no way between them
  const stripes: [Point, Point][] = [];
  const end = input.start ? {x: input.start.x, y: input.start.y} : null;
  let {pos, heading} = prep.state;
  const r = input.turnRadius ?? 0.25;
  const step = input.waypointSpacing ?? 0.1;
  const ahead = input.bladeAhead ?? 0;
  const lateral = input.bladeOffset ?? 0;
  const laneOrder = input.laneOrder ?? 'skip';
  const turnTypes = input.turnTypes ?? ['u_turn', 'bulb', 'detour', 'pivot'];
  const {body, room, turnRoom} = prep;
  // m, the turns between the lanes and the drives to the cells, about as the planner's turns go
  let between = prep.between;
  let lanesStarted = prep.state.started;

  const driveLanes = (lanes: Lane[], direction: number, a: number) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const toMap = (x: number, y: number): Point => ({x: x * c - y * s, y: x * s + y * c});
    let driven = 0;
    lanes.forEach((lane, i) => {
      const [xa, xb] = direction > 0 ? [lane.x0, lane.x1] : [lane.x1, lane.x0];
      // the blade on the lane: the centre blade_offset to its right (left of the lanes going +x is +y) and
      // blade_ahead behind it
      const y = lane.y - lateral * direction;
      const back = ahead * direction;
      let pa = toMap(xa - back, y);
      let pb = toMap(xb - back, y);
      if ((lateral !== 0 || back !== 0) && !room.empty) {
        // shifted towards an edge: as much of it as the centre may drive
        const piece = room.clip(pa, pb, 0);
        if (!piece || dist(...piece) < dist(pa, pb) - 1e-6) {
          const shorter = room.clip(pa, pb, input.minLaneLength);
          if (!shorter) return;
          [pa, pb] = shorter;
        }
      }
      const yaw = direction > 0 ? a : a + Math.PI;
      if (body) {
        // the side the turns come from and go to
        const arrive = driven ? direction * Math.sign(lanes[i - 1].y - lane.y) : 0;
        const leave = i + 1 < lanes.length ? direction * Math.sign(lanes[i + 1].y - lane.y) : 0;
        const ends = bodyEnds(body, pa, pb, yaw, arrive, leave, r, step, input.minLaneLength);
        if (!ends) return;
        [pa, pb] = ends;
        if (driven && heading !== null) {
          // the turn goes level with the lane end further out, where the body may not fit: then this lane starts
          // level with the last one's end, when a gentle turn gets there
          const ux = Math.cos(yaw);
          const uy = Math.sin(yaw);
          const level = (pos.x - pa.x) * ux + (pos.y - pa.y) * uy;
          const most = Math.min(dist(pa, pb) - input.minLaneLength, body.reach + r);
          if (level > 1e-6 && level < most) {
            const exit = {x: pos.x, y: pos.y, yaw: heading};
            const gentle = turnTypes.filter((t) => t !== 'detour' && t !== 'pivot');
            if (!turnFits(exit, pa, r, step, gentle, turnRoom, body, input.minTurnRadius ?? 0)) {
              const start = {x: pa.x + level * ux, y: pa.y + level * uy};
              if (turnFits(exit, start, r, step, gentle, turnRoom, body, input.minTurnRadius ?? 0)) pa = start;
            }
          }
        }
      }
      if (lanesStarted) {
        // a turn from the last lane (the other way, beside it) or a drive to the cell
        const hx = heading === null ? 0 : Math.cos(heading);
        const hy = heading === null ? 0 : Math.sin(heading);
        const along = (pa.x - pos.x) * hx + (pa.y - pos.y) * hy;
        const across = Math.abs(-(pa.x - pos.x) * hy + (pa.y - pos.y) * hx);
        if (driven && across > 1e-6) {
          between += across >= 2 * r ? Math.PI * r + across - 2 * r : r * (Math.PI + 4 * Math.acos((across + 2 * r) / (4 * r)));
          between += Math.abs(along);
        } else between += dist(pos, pa);
      }
      lanesStarted = true;
      stripes.push([pa, pb]);
      pos = pb;
      heading = yaw;
      direction = -direction;
      driven++;
    });
  };

  const cells = (list: Lane[][], a: number, finish: boolean) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const toMap = (x: number, y: number): Point => ({x: x * c - y * s, y: x * s + y * c});
    // first or last row, starting from either end
    const options = (cell: Lane[]) => {
      const out: {lanes: Lane[]; direction: number; entry: Point; exit: Point}[] = [];
      for (const fromLast of [false, true]) {
        const lanes = visitOrder(fromLast ? [...cell].reverse() : cell, laneOrder, r, lateral);
        const firstLane = lanes[0];
        const lastLane = lanes[lanes.length - 1];
        for (const direction of [1, -1]) {
          const out_ = lanes.length % 2 ? direction : -direction;
          out.push({
            lanes,
            direction,
            entry: toMap(direction > 0 ? firstLane.x0 : firstLane.x1, firstLane.y),
            exit: toMap(out_ > 0 ? lastLane.x1 : lastLane.x0, lastLane.y),
          });
        }
      }
      return out;
    };
    // turning round to the first lane costs about as much as driving the turn's arc
    const turning = (direction: number) => (heading === null ? 0 : r * angleDiff(direction > 0 ? a : a + Math.PI, heading));
    let pending = list.filter((cell) => cell.length);
    let reserved: Lane[] | null = null;
    if (finish && end && pending.length) {
      // the cell that can end closest to the end point goes last
      const far = pending.map((cell) => Math.min(...options(cell).map((o) => dist(end, o.exit))));
      reserved = pending.splice(far.indexOf(Math.min(...far)), 1)[0];
    }
    while (pending.length || reserved) {
      let lastCell = false;
      if (!pending.length) {
        pending = [reserved!];
        reserved = null;
        lastCell = true;
      }
      let best: {cost: number; ci: number; lanes: Lane[]; direction: number} | null = null;
      pending.forEach((cell, ci) => {
        for (const o of options(cell)) {
          let cost = dist(pos, o.entry) + turning(o.direction);
          if (lastCell && end) cost += 1000 * dist(end, o.exit);
          if (!best || cost < best.cost - 1e-9) best = {cost, ci, lanes: o.lanes, direction: o.direction};
        }
      });
      const chosen = best!;
      pending.splice(chosen.ci, 1);
      driveLanes(chosen.lanes, chosen.direction, a);
    }
  };

  passes.forEach(({a, cells: list}, i) => cells(list, a, !prep.loopsEnd && i === passes.length - 1));
  const chosen = {lane_spacing: spacing, perimeter_passes: prep.passes, mode: input.spacingMode ?? 'fixed'};
  return {loops: prep.loops, stripes, angle, between, chosen};
}
