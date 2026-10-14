import type {MapArea, MowerMap, Point} from '@/hooks/useMowerMap';
import {containsPoint, shareInside} from './geometry';

// Where the mower doesn't get through, with a planner that keeps its body off the edges and obstacles (collision
// mode): between an obstacle and the edge of the mowing area it lies in, or between two obstacles. The lines of the
// map are where the middle of the mower drove, so between two lines it needs both distances, the grass in between
// stays standing otherwise (closer calls the planner decides, its plan shows them). Obstacles are the ones the planner
// keeps its distance to: the active obstacles and the areas not mowed that are mowed around. Where another mowing area
// lies next to the edge there's no edge for the body, the planner lets it reach over into that one.

// a hint, not a warning: the mower plans and drives right, it only leaves the grass there
export type Narrow = {
  kind: 'narrow';
  level: 'hint';
  // the obstacle
  areaId: string;
  // the mowing area whose edge it's close to (edge), or the other obstacle
  otherId: string;
  edge: boolean;
  // the middle of the gap
  at: Point;
  // m between the lines, and what it needs
  gap: number;
  need: number;
};

// the planner's distances for all areas (edge_margin, obstacle_margin) and the mower's width (robot_width), m
export type Margins = {edge: number; obstacle: number; width: number};

// closer than this the lines touch, it's drawn shut on purpose
const SHUT = 0.01;

type Seg = {a: Point; b: Point; minX: number; maxX: number; minY: number; maxY: number};
type Gap = {d: number; p: Point; q: Point};

const segments = (o: Point[]): Seg[] =>
  o.map((a, i) => {
    const b = o[(i + 1) % o.length];
    return {a, b, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y)};
  });

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

// the point of segment ab closest to p
function onSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return {x: a.x + t * dx, y: a.y + t * dy};
}

function segmentGap(s: Seg, t: Seg): Gap {
  const d1 = cross(t.a, t.b, s.a);
  const d2 = cross(t.a, t.b, s.b);
  const d3 = cross(s.a, s.b, t.a);
  const d4 = cross(s.a, s.b, t.b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return {d: 0, p: s.a, q: s.a};
  }
  let best: Gap | null = null;
  for (const [p, q] of [
    [s.a, onSegment(s.a, t.a, t.b)],
    [s.b, onSegment(s.b, t.a, t.b)],
    [onSegment(t.a, s.a, s.b), t.a],
    [onSegment(t.b, s.a, s.b), t.b],
  ]) {
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || d < best.d) best = {d, p, q};
  }
  return best!;
}

// the narrowest place between two outlines, null if they're limit or further apart. Sorted by x and only compared
// while the ranges are closer than the best so far, recorded outlines with many points stay quick
function narrowest(a: Point[], b: Point[], limit: number): Gap | null {
  const others = segments(b).sort((s, t) => s.minX - t.minX);
  let best: Gap | null = null;
  for (const s of segments(a)) {
    for (const t of others) {
      if (t.minX > s.maxX + limit) break;
      if (t.maxX < s.minX - limit || t.minY > s.maxY + limit || t.maxY < s.minY - limit) continue;
      const g = segmentGap(s, t);
      if (g.d < limit) {
        best = g;
        limit = g.d;
        if (!limit) return best;
      }
    }
  }
  return best;
}

// outlines are kept per area object, a pair the editor didn't change isn't measured again (unless asked for more)
const measured = new WeakMap<Point[], WeakMap<Point[], {limit: number; gap: Gap | null}>>();
function gapOf(a: Point[], b: Point[], limit: number): Gap | null {
  let row = measured.get(a);
  if (!row) measured.set(a, (row = new WeakMap()));
  let hit = row.get(b);
  if (!hit || hit.limit < limit) row.set(b, (hit = {limit, gap: narrowest(a, b, limit)}));
  return hit.gap && hit.gap.d < limit ? hit.gap : null;
}

const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// how far p is from the outline o
function distance(p: Point, o: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < o.length; i++) {
    const q = onSegment(p, o[i], o[(i + 1) % o.length]);
    best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
  }
  return best;
}

export function narrowPassages(map: MowerMap, margins: Margins): Narrow[] {
  const out: Narrow[] = [];
  const areas = map.areas.filter((a) => a.outline.length > 2 && a.properties.active !== false);
  const lawns = areas.filter((a) => a.properties.type === 'mow' && a.properties.mowable !== false);
  const obstacles = areas.filter(
    (a) => a.properties.type === 'obstacle' || (a.properties.type === 'mow' && a.properties.mowable === false && a.properties.mow_around === true),
  );
  const done = new Set<string>();
  // the body reaches over into a mowing area within its width of the edge
  const shared = (lawn: MapArea, at: Point) =>
    lawns.some((l) => l !== lawn && (containsPoint(l.outline, at.x, at.y) || distance(at, l.outline) < margins.width));
  const found = (a: MapArea, b: MapArea, edge: boolean, need: number) => {
    const g = gapOf(a.outline, b.outline, need);
    if (!g || g.d < SHUT || (edge && shared(b, g.q))) return;
    out.push({kind: 'narrow', level: 'hint', areaId: a.id, otherId: b.id, edge, at: {x: (g.p.x + g.q.x) / 2, y: (g.p.y + g.q.y) / 2}, gap: g.d, need});
  };
  // one inside the other, there's no lawn between them
  const nested = (a: MapArea, b: MapArea) => containsPoint(b.outline, a.outline[0].x, a.outline[0].y) || containsPoint(a.outline, b.outline[0].x, b.outline[0].y);
  for (const lawn of lawns) {
    // the area's own planner settings first, an obstacle's own distance before those
    const own = lawn.properties.planner ?? {};
    const edge = number(own.edge_margin) ?? margins.edge;
    const keep = number(own.obstacle_margin) ?? margins.obstacle;
    const marginOf = (o: MapArea) => {
      const m = number(o.properties.margin);
      return m !== undefined && m >= 0 && m <= 1 ? m : keep;
    };
    const inside = obstacles.filter((o) => o !== lawn && shareInside(o.outline, lawn.outline) > 0);
    for (const o of inside) found(o, lawn, true, edge + marginOf(o));
    for (let i = 0; i < inside.length; i++) {
      for (let j = i + 1; j < inside.length; j++) {
        const [a, b] = [inside[i], inside[j]];
        const key = [a.id, b.id].sort().join(' ');
        if (done.has(key) || nested(a, b)) continue;
        done.add(key);
        found(a, b, false, marginOf(a) + marginOf(b));
      }
    }
  }
  return out;
}
