import type {Point} from '@/hooks/useMowerMap';

export function polygonArea(o: Point[]): number {
  let sum = 0;
  for (let i = 0; i < o.length; i++) {
    const a = o[i];
    const b = o[(i + 1) % o.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum / 2);
}

export function containsPoint(o: Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
    if (o[i].y > y !== o[j].y > y && x < ((o[j].x - o[i].x) * (y - o[i].y)) / (o[j].y - o[i].y) + o[i].x) {
      inside = !inside;
    }
  }
  return inside;
}

// how much of outline a lies inside outline b, by its points (0..1)
export function shareInside(a: Point[], b: Point[]): number {
  if (!a.length) return 0;
  return a.filter((p) => containsPoint(b, p.x, p.y)).length / a.length;
}

// recording an outline: the mower went round and is back where the line started, so it can be closed. it has to
// have been away (at least away m from the start, length m driven) and be within near m of the start now
export function backAtStart(line: Point[], at: Point, near = 0.35, away = 1, length = 2.5): boolean {
  if (line.length < 3) return false;
  const start = line[0];
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  if (dist(at, start) > near) return false;
  let driven = 0;
  let far = 0;
  for (let i = 1; i < line.length; i++) {
    driven += dist(line[i - 1], line[i]);
    far = Math.max(far, dist(line[i], start));
  }
  return driven >= length && far >= away;
}

// the smallest convex ring around the points, counter-clockwise
export function convexHull(points: Point[]): Point[] {
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
