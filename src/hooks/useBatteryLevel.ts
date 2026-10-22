'use client';

import {loadLevel} from '@/lib/battery';
import {containerHas, useUpdates} from '@/lib/updates';
import {useEffect, useState} from 'react';

// the last one read and when: a page opened again shows it right away, a read that fails keeps it two minutes
let last: {pct: number; at: number} | null = null;
const kept = () => (last && Date.now() - last.at <= 120000 ? last.pct : undefined);

// how full the battery is in % from the container (battery.cgi?level), every 20 s while the page is open. undefined:
// not known (an older container, MowBite not running as one, another board), OpenMower's percentage is shown then
export function useBatteryLevel(): number | undefined {
  const enabled = containerHas(useUpdates().level, 'level');
  const [pct, setPct] = useState(kept);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const get = () =>
      void loadLevel().then((p) => {
        if (p !== null) last = {pct: p, at: Date.now()};
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
