import type {Point} from '@/hooks/useMowerMap';

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
