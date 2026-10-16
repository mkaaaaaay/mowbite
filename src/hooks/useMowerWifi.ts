'use client';

import {loadSystem} from '@/lib/system';
import {useEffect, useState} from 'react';

// the mower's wifi signal in dBm from the container (system.cgi), every 30 s while the page is open. undefined: not
// known (an older container, MowBite not running on the mower, no wifi)
export function useMowerWifi(): number | undefined {
  const [dbm, setDbm] = useState<number>();
  useEffect(() => {
    let alive = true;
    const get = () => void loadSystem().then((s) => alive && setDbm(s && !s.remote ? s.wifiSignal : undefined));
    get();
    const every = setInterval(get, 30000);
    return () => {
      alive = false;
      clearInterval(every);
    };
  }, []);
  return dbm;
}
