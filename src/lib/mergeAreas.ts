import type {Point} from '@/hooks/useMowerMap';
import * as ClipperLib from 'clipper-lib';
// the esm build only has a default export, despite what its types say
import polygonClipping, {type MultiPolygon, type Ring} from 'polygon-clipping';

const toRing = (o: Point[]): Ring => o.map((p) => [p.x, p.y]);

// clipper works in integers, this is 0.01 mm
const SCALE = 1e5;
// where an outline crosses itself, the loop comes back as a piece of its own that touches the rest in one point.
// closing the gaps this narrow joins them again, it changes the outline nowhere else by more than this
const JOIN = 0.005; // m
// round corners, as a disk would, to within this
const ARC = 0.0005; // m

export interface Merged {
  outline: Point[];
  // gaps enclosed between the two, filled in: an area can't have holes in map.json
  holesFilled: number;
  // loops where an outline crossed itself, joined in
  loopsJoined: number;
}

// one outline for both areas, null if they don't touch. outlines recorded by driving cross themselves now and then,
// they fall apart into pieces touching in a point, so the two touch when together they're fewer pieces than each on
// its own
export function mergeOutlines(a: Point[], b: Point[]): Merged | null {
  const result = polygonClipping.union([toRing(a)], [toRing(b)]);
  if (result.length === 1) {
    const [outer, ...holes] = result[0];
    // rings come back closed, first point repeated at the end
    return {outline: outer.slice(0, -1).map(([x, y]) => ({x, y})), holesFilled: holes.length, loopsJoined: 0};
  }
  const own = polygonClipping.union([toRing(a)]).length + polygonClipping.union([toRing(b)]).length;
  if (result.length >= own) return null;
  const joined = closeGaps(result);
  return joined && {...joined, loopsJoined: result.length - 1};
}

// the pieces grown by JOIN and shrunk back: one outline if they only touched in points, otherwise null
function closeGaps(pieces: MultiPolygon): {outline: Point[]; holesFilled: number} | null {
  const toPath = (ring: Ring) => ring.slice(0, -1).map(([x, y]) => ({X: Math.round(x * SCALE), Y: Math.round(y * SCALE)}));
  const paths = pieces.flatMap((polygon) => polygon.map(toPath));
  const grow = new ClipperLib.ClipperOffset(2, ARC * SCALE);
  grow.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const grown: ClipperLib.Paths = [];
  grow.Execute(grown, JOIN * SCALE);
  const shrink = new ClipperLib.ClipperOffset(2, ARC * SCALE);
  shrink.AddPaths(grown, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const tree = new ClipperLib.PolyTree();
  shrink.Execute(tree, -JOIN * SCALE);
  const outers = tree.Childs();
  if (outers.length !== 1) return null;
  const contour = outers[0].Contour();
  // the same way round as polygon-clipping gives it
  if (!ClipperLib.Clipper.Orientation(contour)) contour.reverse();
  return {outline: contour.map((p) => ({x: p.X / SCALE, y: p.Y / SCALE})), holesFilled: outers[0].Childs().length};
}
