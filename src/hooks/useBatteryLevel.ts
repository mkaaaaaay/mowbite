'use client';

import {loadLevel} from '@/lib/battery';
import {containerHas, mowerHas, useUpdates} from '@/lib/updates';
import {useEffect, useState} from 'react';

// the last one read and when battery.awk worked it out: a page opened again shows it right away, a read that fails
// keeps it until it's two minutes old
let last: {pct: number; at: number} | null = null;
const kept = () => (last && Date.now() - last.at <= 120000 ? last.pct : undefined);

// how full the battery is in % from the container (battery.cgi?level), every 20 s while the page is open. undefined:
// not known (an older container, MowBite not running as one, another board), OpenMower's percentage is shown then
export function useBatteryLevel(): number | undefined {
  const level = useUpdates().level;
  const enabled = containerHas(level, 'level');
  const [pct, setPct] = useState(kept);
  // the container's version not known yet (the mower wasn't there when the app came up): asked again
  useEffect(() => {
    if (level !== null) return;
    const every = setInterval(() => void mowerHas('level'), 20000);
    return () => clearInterval(every);
  }, [level]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const get = () =>
      void loadLevel().then((l) => {
        if (l) last = {pct: l.pct, at: Date.now() - l.age * 1000};
        else if (l === null) last = null;
        if (alive) setPct(kept());
      });
    get();
    const every = setInterval(get, 20000);
    return () => {
      alive = false;
      clearInterval(every);
    };
  }, [enabled]);
  return enabled ? pct : undefined;
}
