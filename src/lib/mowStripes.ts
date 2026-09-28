import type {Point} from '@/hooks/useMowerMap';

// like the per area range in MowingBehavior.cpp: past an end the angle bounces back
export function angleInRange(angle: number, min?: number, max?: number): number {
  if (min === undefined || max === undefined) return angle;
  const width = max - min;
  if (width <= 0) return min;
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
