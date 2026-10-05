'use client';

import {emergencyReasons, rosLogAround} from '@/lib/roslog';
import {useEffect, useState} from 'react';

// why the emergency stop is on, from the ros log (lib/roslog): asked when it comes on and every half minute while it
// lasts, more can come up (a bumper, then lifted). null while it isn't known, and on mowers that don't log it
export function useEmergencyReasons(active: boolean): string[] | null {
  const [reasons, setReasons] = useState<string[] | null>(null);
  // a new emergency stop starts without the reasons of the one before
  const [was, setWas] = useState(active);
  if (was !== active) {
    setWas(active);
    setReasons(null);
  }
  useEffect(() => {
    if (!active) return;
    let gone = false;
    const ask = () =>
      void rosLogAround(Date.now() / 1000, 12 * 3600, 60)
        .then((lines) => {
          if (!gone) setReasons(emergencyReasons(lines));
        })
        .catch(() => {});
    ask();
    const timer = setInterval(ask, 30000);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [active]);
  return active ? reasons : null;
}
