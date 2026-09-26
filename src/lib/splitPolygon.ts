import type {Point} from '@/hooks/useMowerMap';
import {containsPoint, polygonArea} from './geometry';

// where the cut path crosses the outline: position along the path and along the outline (edge + t)
interface Crossing {
  pathPos: number;
  edge: number;
  t: number;
  point: Point;
}

function segmentHit(a: Point, b: Point, c: Point, d: Point): [number, number] | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const u = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const v = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return u >= 0 && u <= 1 && v >= 0 && v < 1 ? [u, v] : null;
}

// outline vertices strictly between two positions, walking forward around the ring
function walk(outline: Point[], from: Crossing, to: Crossing): Point[] {
  const n = outline.length;
  const out: Point[] = [];
  const sameEdgeAhead = from.edge === to.edge && to.t > from.t;
  if (sameEdgeAhead) return out;
  let k = (from.edge + 1) % n;
  for (let guard = 0; guard < n; guard++) {
    out.push(outline[k]);
    if (k === to.edge) break;
    k = (k + 1) % n;
  }
  return out;
}

// Splits the outline along a drawn path. Uses the first stretch of the path that runs through the
// area, from where it enters to where it leaves, so the path can bend and may start and end outside.
export function splitByPath(outline: Point[], path: Point[]): [Point[], Point[]] | null {
  if (outline.length < 3 || path.length < 2) return null;

  const hits: Crossing[] = [];
  for (let s = 0; s + 1 < path.length; s++) {
    for (let e = 0; e < outline.length; e++) {
      const h = segmentHit(path[s], path[s + 1], outline[e], outline[(e + 1) % outline.length]);
      if (!h) continue;
      const [u, t] = h;
      hits.push({
        pathPos: s + u,
        edge: e,
        t,
        point: {x: path[s].x + u * (path[s + 1].x - path[s].x), y: path[s].y + u * (path[s + 1].y - path[s].y)},
      });
    }
  }
  hits.sort((a, b) => a.pathPos - b.pathPos);

  const pointAt = (pos: number): Point => {
    const s = Math.min(Math.floor(pos), path.length - 2);
    const u = pos - s;
    return {x: path[s].x + u * (path[s + 1].x - path[s].x), y: path[s].y + u * (path[s + 1].y - path[s].y)};
  };

  for (let i = 0; i + 1 < hits.length; i++) {
    const a = hits[i];
    const b = hits[i + 1];
    if (b.pathPos - a.pathPos < 1e-9) continue;
    const mid = pointAt((a.pathPos + b.pathPos) / 2);
    if (!containsPoint(outline, mid.x, mid.y)) continue;

    // path corners between entry and exit
    const inner: Point[] = [];
    for (let k = Math.floor(a.pathPos) + 1; k <= Math.floor(b.pathPos) && k < path.length; k++) {
      if (k > a.pathPos && k < b.pathPos) inner.push(path[k]);
    }

    const ringA = [a.point, ...inner, b.point, ...walk(outline, b, a)];
    const ringB = [b.point, ...[...inner].reverse(), a.point, ...walk(outline, a, b)];
    if (ringA.length < 3 || ringB.length < 3 || polygonArea(ringA) < 0.01 || polygonArea(ringB) < 0.01) return null;
    return [ringA, ringB];
  }
  return null;
}

export function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
