import type {Point} from '@/hooks/useMowerMap';
import * as ClipperLib from 'clipper-lib';
// the esm build only has a default export, despite what its types say
import polygonClipping, {type Polygon, type Ring} from 'polygon-clipping';
import {polygonArea} from './geometry';
import {pointInside} from './splitPolygon';

const toRing = (o: Point[]): Ring => o.map((p) => [p.x, p.y]);
// rings come back closed, first point repeated at the end
const fromRing = (r: Ring): Point[] => r.slice(0, -1).map(([x, y]) => ({x, y}));
// 0.01 mm, polygon-clipping gives up now and then on outlines that run along each other within a hair
const snap = (o: Point[]): Point[] => o.map((p) => ({x: Math.round(p.x * 1e5) / 1e5, y: Math.round(p.y * 1e5) / 1e5}));

// a piece left over with less than this of it at least this wide (a wobbly path taken out of a lawn) is no area to mow
const SLIVER_AREA = 0.25; // m²
const SLIVER_WIDTH = 0.1; // m
// clipper works in integers, this is 0.01 mm
const SCALE = 1e5;

const areaOf = (polygon: Polygon) => polygon.reduce((sum, r, i) => sum + (i ? -1 : 1) * polygonArea(fromRing(r)), 0);
const lengthOf = (r: Ring) => r.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - r[i][0], y - r[i][1]), 0);

export interface Subtracted {
  // what's left of the area, biggest first, none when the other one covers all of it
  pieces: Point[][];
  // the other one lay inside a piece: that piece got cut open through it, as often as this
  cut: number;
  // slivers left over, too small or too narrow to be an area, left out
  dropped: number;
  // the two outlines couldn't be worked with (polygon-clipping gave up, as it can where they share an edge exactly,
  // or a hole couldn't be cut open), no pieces then
  failed?: boolean;
}

// What's left of outline a where b lies over it, null when they don't overlap. slivers: narrow pieces besides the biggest
// are dropped (an area to mow), an obstacle keeps them all
export function subtractOutline(a: Point[], b: Point[], slivers = true): Subtracted | null {
  try {
    return subtract(a, b, slivers);
  } catch {
    try {
      return subtract(snap(a), snap(b), slivers);
    } catch {
      return {pieces: [], cut: 0, dropped: 0, failed: true};
    }
  }
}

const offset = (paths: ClipperLib.Paths, by: number) => {
  const co = new ClipperLib.ClipperOffset();
  co.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const out: ClipperLib.Paths = [];
  co.Execute(out, by * SCALE);
  return out;
};

// how much of it is at least the width: shrunk by half of it and grown back, the narrower strips are gone then (m²)
function wideArea(o: Point[]): number {
  const path = o.map((p) => ({X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE)}));
  const opened = offset(offset([path], -SLIVER_WIDTH / 2), SLIVER_WIDTH / 2);
  return opened.reduce((sum, p) => sum + ClipperLib.Clipper.Area(p), 0) / (SCALE * SCALE);
}

function subtract(a: Point[], b: Point[], slivers: boolean): Subtracted | null {
  const whole = polygonClipping.union([toRing(a)]);
  const rest = polygonClipping.difference([toRing(a)], [toRing(b)]);
  const before = whole.reduce((sum, p) => sum + areaOf(p), 0);
  const after = rest.reduce((sum, p) => sum + areaOf(p), 0);
  if (before - after < 0.01) return null;
  const left = rest
    .flatMap((p) => cutOpen(p))
    .sort((x, y) => areaOf(y) - areaOf(x))
    .map((p) => fromRing(p[0]))
    // under 0.01 m² it's a crumb of the computing, no piece at all
    .filter((o) => polygonArea(o) >= 0.01);
  // the biggest piece stays even when it's a sliver (a path taken out of a post), only other slivers are dropped
  const pieces = slivers ? left.filter((o, i) => !i || wideArea(o) >= SLIVER_AREA) : left;
  return {pieces, cut: rest.reduce((n, p) => n + p.length - 1, 0), dropped: left.length - pieces.length};
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
