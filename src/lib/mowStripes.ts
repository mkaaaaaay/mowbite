import type {Point} from '@/hooks/useMowerMap';

// same as MowingBehavior.cpp: direction from the first outline point to the first one more than 2 m away
export function autoMowAngle(outline: Point[]): number {
  const first = outline[0];
  for (const p of outline) {
    const dx = p.x - first.x;
    const dy = p.y - first.y;
    if (Math.hypot(dx, dy) > 2) return Math.atan2(dy, dx);
  }
  return 0;
}

type Interval = [number, number];

// where a horizontal line at y is inside the ring (even-odd)
function crossings(ring: Point[], y: number): Interval[] {
  const xs: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  xs.sort((p, q) => p - q);
  const out: Interval[] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

function subtract(from: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of from) {
    if (cut[1] <= a || cut[0] >= b) {
      out.push([a, b]);
      continue;
    }
    if (cut[0] > a) out.push([a, cut[0]]);
    if (cut[1] < b) out.push([cut[1], b]);
  }
  return out;
}

// Parallel lines at `angle` (rad, 0 = +x, ccw), `spacing` apart, inside the outline minus the holes.
// The planner insets the area by the outline passes first, this doesn't, so it shows direction and
// spacing, not the exact path.
export function mowStripes(outline: Point[], holes: Point[][], angle: number, spacing: number): [Point, Point][] {
  if (outline.length < 3 || spacing <= 0) return [];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // rotate by -angle so the stripes become horizontal
  const toLocal = (p: Point): Point => ({x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos});
  const toWorld = (p: Point): Point => ({x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos});

  const ring = outline.map(toLocal);
  const holeRings = holes.map((h) => h.map(toLocal));
  const ys = ring.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const mid = (minY + maxY) / 2;
  const count = Math.floor((maxY - minY) / 2 / spacing);
  if (count > 2000) return [];

  const out: [Point, Point][] = [];
  for (let k = -count; k <= count; k++) {
    const y = mid + k * spacing;
    let parts = crossings(ring, y);
    for (const h of holeRings) for (const cut of crossings(h, y)) parts = subtract(parts, cut);
    for (const [a, b] of parts) out.push([toWorld({x: a, y}), toWorld({x: b, y})]);
  }
  return out;
}
