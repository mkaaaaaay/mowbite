import type {Point} from '@/hooks/useMowerMap';

// like the per area range in MowingBehavior.cpp: past an end the angle bounces back
export function angleInRange(angle: number, min?: number, max?: number): number {
  if (min === undefined || max === undefined) return angle;
  const full = 2 * Math.PI;
  let width = max - min;
  // max < min is a range across ±180°
  if (width < 0) width += full;
  if (width === 0) return min;
  if (width >= full) return angle;
  // the same direction can be written ±360° apart, use the one closest to the middle of the range
  const mid = min + width / 2;
  const r = (angle - mid) % full;
  angle = mid + (r > Math.PI ? r - full : r < -Math.PI ? r + full : r);
  let t = (angle - min) % (2 * width);
  if (t < 0) t += 2 * width;
  return min + (t <= width ? t : 2 * width - t);
}

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
