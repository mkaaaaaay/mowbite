import type {Point} from '@/hooks/useMowerMap';
import {polygonArea} from './geometry';

// Snapping in the map editor: a point dragged or set near another area's corner or edge goes onto it, and an area laid
// against another one takes over its edge where they're close, so the two meet without a gap and without overlapping

export interface Nearest {
  x: number;
  y: number;
  d: number;
  // on the edge from o[i] to the next corner, t of the way along it
  i: number;
  t: number;
}

// the point of outline o nearest to p
export function nearestOnOutline(o: Point[], p: Point): Nearest | null {
  let best: Nearest | null = null;
  for (let i = 0; i < o.length; i++) {
    const a = o[i];
    const b = o[(i + 1) % o.length];
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    const [x, y] = [a.x + t * dx, a.y + t * dy];
    const d = Math.hypot(p.x - x, p.y - y);
    if (!best || d < best.d) best = {x, y, d, i, t};
  }
  return best;
}

// p put onto the nearest corner of the outlines within reach, else onto the nearest point of their edges within reach,
// null when none is that close
export function snapPoint(p: Point, outlines: Point[][], reach: number): {x: number; y: number; corner: boolean} | null {
  let corner: {x: number; y: number; d: number} | null = null;
  for (const o of outlines) {
    for (const q of o) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= reach && (!corner || d < corner.d)) corner = {x: q.x, y: q.y, d};
    }
  }
  if (corner) return {x: corner.x, y: corner.y, corner: true};
  let edge: Nearest | null = null;
  for (const o of outlines) {
    if (o.length < 2) continue;
    const n = nearestOnOutline(o, p);
    if (n && n.d <= reach && (!edge || n.d < edge.d)) edge = n;
  }
  return edge && {x: edge.x, y: edge.y, corner: false};
}

// whether two edges of the outline cross (ones next to each other only meet)
export function crossesItself(o: Point[]): boolean {
  const n = o.length;
  const side = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  for (let i = 0; i < n; i++) {
    const [a, b] = [o[i], o[(i + 1) % n]];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [c, d] = [o[j], o[(j + 1) % n]];
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true;
    }
  }
  return false;
}

export interface Laid {
  outline: Point[];
  // its corners moved onto the other's edge, the other's corners taken over
  moved: number;
  taken: number;
  // false: the outline would cross itself or come out flat
  valid: boolean;
}

// Outline a laid against b: its corners within reach of b's edge moved onto it, and where such corners follow each
// other, b's own corners between them taken over, so the two share that stretch of edge exactly. null when none of
// them is that close, or all of them are (a would fold flat onto b's edge)
export function layAgainst(a: Point[], b: Point[], reach: number): Laid | null {
  const n = a.length;
  if (n < 3 || b.length < 3) return null;
  // the nearest point of b's edge, or b's corner when that's hardly further: two areas meet at the same corner
  const near = a.map((p): Nearest => {
    const q = nearestOnOutline(b, p)!;
    let corner: Nearest | null = null;
    b.forEach((c, j) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d <= reach && d <= q.d + reach * 0.3 && (!corner || d < corner.d)) corner = {x: c.x, y: c.y, d, i: j, t: 0};
    });
    return corner ?? q;
  });
  const close = near.map((q) => q.d <= reach);
  const count = close.filter(Boolean).length;
  if (!count || count === n) return null;

  // how far along b's edge from b[0] a point on it is
  const lengths = b.map((p, i) => Math.hypot(b[(i + 1) % b.length].x - p.x, b[(i + 1) % b.length].y - p.y));
  const starts: number[] = [];
  lengths.reduce((s, l, i) => ((starts[i] = s), s + l), 0);
  const total = lengths.reduce((s, l) => s + l, 0);
  const along = (q: Nearest) => starts[q.i] + q.t * lengths[q.i];
  const ahead = (from: number, to: number) => (((to - from) % total) + total) % total;
  // b's corners passed going from one place on its edge to another, forwards (dir 1) or backwards
  const passed = (from: number, to: number, dir: number): Point[] => {
    const span = dir > 0 ? ahead(from, to) : ahead(to, from);
    return b
      .map((p, j) => ({p, off: dir > 0 ? ahead(from, starts[j]) : ahead(starts[j], from)}))
      .filter(({off}) => off > 1e-6 && off < span - 1e-6)
      .sort((x, y) => x.off - y.off)
      .map(({p}) => p);
  };

  // round from a corner that stays, runs of close corners each replaced by b's edge from the first to the last
  const first = close.indexOf(false);
  const out: Point[] = [];
  let taken = 0;
  for (let k = 0; k < n; ) {
    const i = (first + k) % n;
    if (!close[i]) {
      out.push(a[i]);
      k++;
      continue;
    }
    const run: number[] = [];
    while (k < n && close[(first + k) % n]) run.push((first + k++) % n);
    const ends = [near[run[0]], near[run[run.length - 1]]];
    if (run.length === 1) {
      out.push({x: ends[0].x, y: ends[0].y});
      continue;
    }
    // the way round b the run's corners go, and how long the run is on a
    const at = run.map((j) => along(near[j]));
    const turn = at.slice(1).reduce((s, v, j) => s + (((v - at[j] + total * 1.5) % total) - total / 2), 0);
    const dir = turn >= 0 ? 1 : -1;
    const length = run.slice(1).reduce((s, j, m) => s + Math.hypot(a[j].x - a[run[m]].x, a[j].y - a[run[m]].y), 0);
    const span = dir > 0 ? ahead(at[0], at[at.length - 1]) : ahead(at[at.length - 1], at[0]);
    if (span > 2.5 * length + 4 * reach) {
      // b's edge between them goes a long way round: only the corners onto it
      for (const j of run) out.push({x: near[j].x, y: near[j].y});
      continue;
    }
    const between = passed(at[0], at[at.length - 1], dir);
    taken += between.length;
    out.push({x: ends[0].x, y: ends[0].y}, ...between, {x: ends[1].x, y: ends[1].y});
  }

  // no point twice in a row
  const outline = out.filter((p, i) => {
    const prev = out[(i - 1 + out.length) % out.length];
    return out.length < 2 || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-4;
  });
  const valid = outline.length >= 3 && Math.abs(polygonArea(outline)) > 0.01 && !crossesItself(outline);
  return {outline, moved: count, taken, valid};
}

// which of two areas laid against each other moves and which stays: a mowing area stays, unless both are (then the
// one picked first moves)
export function movingOf<T extends {properties: {type?: string}}>(picked: T, other: T): [T, T] {
  return picked.properties.type === 'mow' && other.properties.type !== 'mow' ? [other, picked] : [picked, other];
}
