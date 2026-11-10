'use client';

import {useEffect, useRef, useState} from 'react';

// where something was a moment ago: follows a position (every new one is kept with its time) and plays it back lagMs
// late, every frame, smooth between the kept ones. null while off or nothing came yet
export function useTrailingPose(target: {x: number; y: number} | null, on: boolean, lagMs = 1300): {x: number; y: number} | null {
  const list = useRef<{t: number; x: number; y: number}[]>([]);
  const [pose, setPose] = useState<{x: number; y: number} | null>(null);
  const x = target?.x;
  const y = target?.y;

  useEffect(() => {
    if (!on || x === undefined || y === undefined) return;
    const now = performance.now();
    list.current.push({t: now, x, y});
    while (list.current.length > 2 && list.current[1].t < now - lagMs - 2000) list.current.shift();
  }, [on, x, y, lagMs]);

  useEffect(() => {
    if (!on) {
      list.current = [];
      return;
    }
    let frame = 0;
    const tick = () => {
      const l = list.current;
      const at = performance.now() - lagMs;
      let next: {x: number; y: number} | null = null;
      if (l.length) {
        let i = 0;
        while (i < l.length - 1 && l[i + 1].t <= at) i++;
        const a = l[i];
        const b = l[Math.min(i + 1, l.length - 1)];
        const f = b.t > a.t ? Math.min(1, Math.max(0, (at - a.t) / (b.t - a.t))) : 0;
        next = {x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f};
      }
      setPose((p) => (p && next && Math.abs(p.x - next.x) < 1e-4 && Math.abs(p.y - next.y) < 1e-4 ? p : next));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [on, lagMs]);

  return on ? pose : null;
}
