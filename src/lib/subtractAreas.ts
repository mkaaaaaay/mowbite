import type {Point} from '@/hooks/useMowerMap';
// the esm build only has a default export, despite what its types say
import polygonClipping, {type Polygon, type Ring} from 'polygon-clipping';
import {polygonArea} from './geometry';
import {pointInside} from './splitPolygon';

const toRing = (o: Point[]): Ring => o.map((p) => [p.x, p.y]);
// rings come back closed, first point repeated at the end
const fromRing = (r: Ring): Point[] => r.slice(0, -1).map(([x, y]) => ({x, y}));
// 0.01 mm, polygon-clipping gives up now and then on outlines that run along each other within a hair
const snap = (o: Point[]): Point[] => o.map((p) => ({x: Math.round(p.x * 1e5) / 1e5, y: Math.round(p.y * 1e5) / 1e5}));

const areaOf = (polygon: Polygon) => polygon.reduce((sum, r, i) => sum + (i ? -1 : 1) * polygonArea(fromRing(r)), 0);
const lengthOf = (r: Ring) => r.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - r[i][0], y - r[i][1]), 0);

export interface Subtracted {
  // what's left of the area, biggest first, none when the other one covers all of it
  pieces: Point[][];
  // the other one lay inside a piece: that piece got cut open through it, as often as this
  cut: number;
}

// What's left of outline a where b lies over it, null when they don't overlap (or the outlines can't be worked with)
export function subtractOutline(a: Point[], b: Point[]): Subtracted | null {
  try {
    return subtract(a, b);
  } catch {
    try {
      return subtract(snap(a), snap(b));
    } catch {
      return null;
    }
  }
}

function subtract(a: Point[], b: Point[]): Subtracted | null {
  const whole = polygonClipping.union([toRing(a)]);
  const rest = polygonClipping.difference([toRing(a)], [toRing(b)]);
  const before = whole.reduce((sum, p) => sum + areaOf(p), 0);
  const after = rest.reduce((sum, p) => sum + areaOf(p), 0);
  if (before - after < 0.01) return null;
  const opened = rest.flatMap((p) => cutOpen(p));
  return {
    pieces: opened
      .filter((p) => areaOf(p) >= 0.01)
      .sort((x, y) => areaOf(y) - areaOf(x))
      .map((p) => fromRing(p[0])),
    cut: rest.reduce((n, p) => n + p.length - 1, 0),
  };
}

// An area can't have a hole: a piece with one is cut in two straight through it, in the direction where the cut is
// shortest, and so on until no piece has a hole left
function cutOpen(polygon: Polygon, depth = 0): Polygon[] {
  if (polygon.length === 1) return [polygon];
  const at = pointInside(fromRing(polygon[1]));
  if (!at || depth > 20) throw new Error('hole not cut');
  const far = 1000;
  let best: {parts: Polygon[]; length: number} | null = null;
  for (let deg = 0; deg < 180; deg += 5) {
    const r = (deg * Math.PI) / 180;
    const [dx, dy] = [Math.cos(r) * far, Math.sin(r) * far];
    const side = (k: number): Ring => [
      [at.x - dx, at.y - dy],
      [at.x + dx, at.y + dy],
      [at.x + dx - k * dy, at.y + dy + k * dx],
      [at.x - dx - k * dy, at.y - dy + k * dx],
    ];
    let parts: Polygon[];
    try {
      parts = [...polygonClipping.intersection(polygon, [side(1)]), ...polygonClipping.intersection(polygon, [side(-1)])];
    } catch {
      continue;
    }
    if (parts.length < 2 || parts.some((p) => areaOf(p) < 0.01)) continue;
    // the outline and the holes are the same every time, what differs is the cut
    const length = parts.reduce((sum, p) => sum + lengthOf(p[0]), 0);
    if (!best || length < best.length - 1e-6) best = {parts, length};
  }
  if (!best) throw new Error('hole not cut');
  return best.parts.flatMap((p) => cutOpen(p, depth + 1));
}
