import * as ClipperLib from 'clipper-lib';
import type {Point} from '@/hooks/useMowerMap';

// What slic3r_coverage_planner does with an area, so the editor can show where the mower will drive:
// the first outline pass is the area shrunk by outline_offset, every further one by one tool width.
// The stripes fill the pass number (outline_count - 1 - overlap), so they reach under that many
// passes. Obstacles grow the same way and get their own passes. Like the planner (Slic3r) the
// shapes are offset with Clipper, mitered corners. How it links the stripes up isn't copied, only
// where they are.

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
