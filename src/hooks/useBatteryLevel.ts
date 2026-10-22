'use client';

import {loadLevel} from '@/lib/battery';
import {useEffect, useState} from 'react';

// how full the battery is in % from the container (battery.cgi?level), every 20 s while the page is open. undefined:
// not known, OpenMower's percentage is shown then
export function useBatteryLevel(): number | undefined {
  const [pct, setPct] = useState<number>();
  useEffect(() => {
    let alive = true;
    const get = () => void loadLevel().then((p) => alive && setPct(p ?? undefined));
    get();
    const every = setInterval(get, 20000);
    return () => {
      alive = false;
      clearInterval(every);
    };
  }, []);
  return pct;
}
