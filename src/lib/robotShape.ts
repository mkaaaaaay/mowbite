// How the mower looks from above (robot_shape of robot.geometry, api 42), in m of base_link: shown only, never a
// distance from it (robot_outline stays the body). null where it has none or it's beyond the limits of the interface
export const SHAPE_KINDS = ['body', 'wheel', 'caster', 'bumper', 'button', 'sensor', 'handle'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
export interface ShapePart {
  id: string;
  kind: ShapeKind;
  points: [number, number][];
  closed: boolean;
}
export const SHAPE_LIMITS = {parts: 32, partPoints: 200, points: 1000};

export function robotShape(v: unknown): ShapePart[] | null {
  if (!Array.isArray(v) || !v.length || v.length > SHAPE_LIMITS.parts) return null;
  let all = 0;
  const parts: ShapePart[] = [];
  for (const p of v) {
    const {id, kind, points, closed = true} = (p ?? {}) as Partial<ShapePart>;
    if (typeof id !== 'string' || !SHAPE_KINDS.includes(kind as ShapeKind) || !Array.isArray(points) || typeof closed !== 'boolean') return null;
    if (points.length < 2 || points.length > SHAPE_LIMITS.partPoints) return null;
    if (!points.every((q) => Array.isArray(q) && q.length === 2 && q.every((n) => typeof n === 'number' && Number.isFinite(n)))) return null;
    all += points.length;
    parts.push({id, kind: kind as ShapeKind, points, closed});
  }
  return all > SHAPE_LIMITS.points ? null : parts;
}

// a rectangle from x0 to x1 ahead and y0 to y1 left
export const box = (x0: number, x1: number, y0: number, y1: number): [number, number][] => [[x1, y1], [x0, y1], [x0, y0], [x1, y0]];

// the drive wheels from above, left and right
export const wheelBoxes = (track: number, radius: number, width: number) => ({
  wheel_left: box(-radius, radius, track / 2 - width / 2, track / 2 + width / 2),
  wheel_right: box(-radius, radius, -track / 2 - width / 2, -track / 2 + width / 2),
});

// an svg path of points in m of base_link, seen from above with the front up: x ahead goes up, y left goes left
export const shapePath = (points: [number, number][], closed: boolean) =>
  points.map(([x, y], i) => `${i ? 'L' : 'M'}${(-y).toFixed(4)} ${(-x).toFixed(4)}`).join(' ') + (closed ? ' Z' : '');
