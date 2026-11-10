'use client';

import {standOn, type Stand} from '@/lib/dockGuide';
import {DRIFT_MIN, headingDrift} from '@/lib/drift';
import {onTopic} from '@/lib/mqttClient';
import {TOPIC} from '@/lib/openmower';
import {useEffect, useState} from 'react';

// the stick let go this long ago: it stands (the wheels stop a moment after the last command)
const STILL_MS = 1500;
// the last this many seconds of a stand count
const KEEP_S = 20;

// how fast OpenMower's heading runs away while the mower stands (rad/s), null while it doesn't. watched while on, from
// the position as it comes, while the stick is let go (movedAt: when it last drove it) and the mower stays where it is.
// once seen it stays until a stand shows none: the gyro's zero is wrong until OpenMower starts again
export function useHeadingDrift(on: boolean, movedAt: React.RefObject<number>): number | null {
  const [drift, setDrift] = useState<number | null>(null);
  useEffect(() => {
    if (!on) return;
    let stand: Stand | null = null;
    let headings: {t: number; heading: number}[] = [];
    let looked = 0;
    return onTopic(TOPIC.position, (payload) => {
      let p: {x: number; y: number; heading: number};
      try {
        const raw = JSON.parse(payload.toString());
        if (typeof raw.x !== 'number' || typeof raw.y !== 'number' || typeof raw.heading !== 'number') return;
        p = raw;
      } catch {
        return;
      }
      const now = performance.now();
      const t = now / 1000;
      const next = now - movedAt.current < STILL_MS ? null : standOn(stand, {x: p.x, y: p.y, t});
      // a new stand, or none while it drives
      if (!next || next.t0 !== stand?.t0) headings = [];
      stand = next;
      if (!stand) return;
      headings.push({t, heading: p.heading});
      if (headings[0].t < t - KEEP_S) headings = headings.filter((h) => h.t >= t - KEEP_S);
      if (now - looked < 1000) return;
      looked = now;
      const d = headingDrift(headings);
      if (d?.drift) setDrift(d.rate);
      else if (d && Math.abs(d.rate) < DRIFT_MIN / 2) setDrift(null);
    });
  }, [on, movedAt]);
  return on ? drift : null;
}
