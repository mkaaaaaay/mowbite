// plannerEstimate's lanes: the direction (longest edge, narrowest width, fewest lanes), the rows across the area and their order
import type {Point} from '@/hooks/useMowerMap';
import {convexHull} from './geometry';
import {angleInRange} from './mowStripes';
import type {PlannerEstimateInput} from './plannerEstimate';
import {EDGE_MARGIN, simplifyLine} from './plannerGeometry';

// the planner simplifies an outline this much to find its longest edge
const ANGLE_SIMPLIFY = 0.1;

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

export type Lane = {x0: number; x1: number; y: number; row: number};
type Intervals = [number, number][];
export const MAX_ROWS = 20000;
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

export function optimalAngle(rings: Point[][], input: PlannerEstimateInput, fallback: number, target?: Point[][],
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

// the rows' lanes grouped into cells mowed in one zigzag, like the planner's split_cells
export function splitCells(rows: Lane[][]): Lane[][] {
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
export function visitOrder(lanes: Lane[], laneOrder: string, turnRadius: number, bladeOffset: number): Lane[] {
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
