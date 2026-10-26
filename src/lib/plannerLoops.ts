// plannerEstimate's outline passes: the loops round the area and its obstacles, joined into one route
import * as ClipperLib from 'clipper-lib';
import type {Point} from '@/hooks/useMowerMap';
import {CELL, cellKey, CORNER_ANGLE} from './plannerBody';
import {angleDiff, ccw, dist, fromPath, partsOf, type Paths} from './plannerGeometry';

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
export type RouteState = {pos: Point; heading: number | null; started: boolean};

// the rings of the paths in the planner's order (rings()): the polygons by their lower left corner (minx, miny), each
// outline (counter-clockwise) and then its holes (clockwise) by theirs
export function ringsWithKind(paths: Paths, depth: number): Ring[] {
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
export class LoopRoute {
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
