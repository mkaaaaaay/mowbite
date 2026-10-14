import type {MapArea, Point} from '@/hooks/useMowerMap';
import * as ClipperLib from 'clipper-lib';
import {shareInside} from './geometry';

// like the mower plans an area: don't mow areas with mow_around that lie in it are left out (an outline pass
// around them, no lanes across). one that covers this whole area doesn't count, the inner area does
export function mowAroundHoles(area: MapArea, areas: MapArea[]): Point[][] {
  return areas
    .filter(
      (o) =>
        o.id !== area.id &&
        o.properties.type === 'mow' &&
        o.properties.active !== false &&
        o.properties.mowable === false &&
        o.properties.mow_around === true &&
        o.outline.length > 2 &&
        shareInside(area.outline, o.outline) < 1,
    )
    .map((o) => o.outline);
}

const SCALE = 1e5;
const path = (o: Point[]) => o.map((p) => ({X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE)}));
const size = (paths: ClipperLib.Paths) => Math.abs(paths.reduce((s, p) => s + ClipperLib.Clipper.Area(p), 0)) / (SCALE * SCALE);

// how much of inner's area lies in outer (0..1)
export function areaInside(inner: Point[], outer: Point[]): number {
  const whole = size([path(inner)]);
  if (inner.length < 3 || outer.length < 3 || whole <= 0) return 0;
  const c = new ClipperLib.Clipper();
  c.AddPath(path(inner), ClipperLib.PolyType.ptSubject, true);
  c.AddPath(path(outer), ClipperLib.PolyType.ptClip, true);
  const out: ClipperLib.Paths = [];
  c.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return size(out) / whole;
}

// a mowing area lies in another (is nested) with this share of it in there at least, like the MowBite Planner's
export const NESTED_SHARE = 0.9;

// whether inner is a mowing area of its own lying in outer: the MowBite Planner (nested_areas) leaves it out of
// outer and mows round it, it gets its own plan. smaller, active and mowed, not just next to it with an edge in common
export function nestedIn(inner: MapArea, outer: MapArea): boolean {
  const p = inner.properties;
  return (
    inner.id !== outer.id &&
    p.type === 'mow' &&
    p.active !== false &&
    p.mowable !== false &&
    inner.outline.length > 2 &&
    size([path(inner.outline)]) < size([path(outer.outline)]) &&
    areaInside(inner.outline, outer.outline) >= NESTED_SHARE
  );
}

// the mowing areas lying in this one, left out of its plan with nested_areas
export function nestedAreas(area: MapArea, areas: MapArea[]): Point[][] {
  return areas.filter((o) => nestedIn(o, area)).map((o) => o.outline);
}
