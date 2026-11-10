// plannerEstimate's geometry: clipper's integer paths, offsets, the free space of an area, simplified lines and rings
import * as ClipperLib from 'clipper-lib';
import type {Point} from '@/hooks/useMowerMap';

// clipper works in integers, this is 0.01 mm
const SCALE = 1e5;
export type Paths = ClipperLib.Paths;
export const EDGE_MARGIN = 1e-4;
// how far a rounded corner may be off a true arc, for an offset by d: like shapely's 9 segments a quarter circle
const arcTolerance = (d: number) => Math.max(0.25, Math.abs(d) * SCALE * (1 - Math.cos(Math.PI / 36)));
export const toPath = (o: Point[]) => o.map((p) => ({X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE)}));
export const fromPath = (p: ClipperLib.Path): Point[] => p.map((q) => ({x: q.X / SCALE, y: q.Y / SCALE}));
// counter-clockwise, so overlapping ones add up (clipper's non-zero filling)
export const ccw = (p: ClipperLib.Path) => (ClipperLib.Clipper.Orientation(p) ? p : [...p].reverse());

// shrunk by d (grown if negative), round where it bends around inside corners, like the planner's inset()
export function inset(paths: Paths, d: number): Paths {
  if (d === 0) return paths;
  const co = new ClipperLib.ClipperOffset(2, arcTolerance(d));
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out: Paths = [];
  co.Execute(out, -d * SCALE);
  return out;
}

export const area = (p: ClipperLib.Path) => ClipperLib.Clipper.Area(p) / (SCALE * SCALE);

// the area minus the obstacles, simplified by tolerance like the planner does (douglas-peucker of each ring from its
// first point), without slivers smaller than the blade
export function freeSpace(outline: Point[], holes: Point[][], half: number, tolerance: number): {paths: Paths; rings: Point[][]} {
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
export function simplifyLine(points: Point[], tolerance: number): Point[] {
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
export function simplifyRings(rings: Point[][], tolerance: number): Point[][] {
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

export const ringsOf = (paths: Paths) => paths.map(fromPath).filter((r) => r.length >= 3);

export function clip(subject: Paths, clipPaths: Paths, type: number): Paths {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  if (clipPaths.length) c.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);
  const out: Paths = [];
  c.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out;
}

// the polygons of some paths, each its outline with its holes
export function partsOf(paths: Paths): Paths[] {
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

export const partArea = (part: Paths) => part.reduce((s, p) => s + area(p), 0);

export function grow(paths: Paths, d: number, join: number): Paths {
  const co = new ClipperLib.ClipperOffset(5, arcTolerance(d));
  co.AddPaths(paths, join, ClipperLib.EndType.etClosedPolygon);
  const out: Paths = [];
  co.Execute(out, d * SCALE);
  return out;
}

// m, the loops on the map are simplified this much: a fraction of the points, and nothing to see
const DRAWN = 0.005;

// the rings of the paths, closed: the map draws them as loops
export const closed = (paths: Paths) => ringsOf(paths).map((r) => simplifyLine([...r, r[0]], DRAWN));

export const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
export const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
