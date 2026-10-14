'use client';

import {datumFromParams, useMowerParams} from '@/hooks/useMowerParams';
import {useDocked, useMowerStateValue} from '@/hooks/useMowerState';
import {useRecentRuns} from '@/hooks/useRecentRuns';
import {isNightTime} from './schedule';
import {sunTimes} from './sun';
import {useEffect, useState, useSyncExternalStore} from 'react';

// a link can set both, to show them to someone: #eggs=rain,towel&eggnow=2026-10-31T21:30 (eggs=off clears them)
if (typeof window !== 'undefined') {
  const h = new URLSearchParams(window.location.hash.slice(1));
  try {
    const eggs = h.get('eggs');
    const now = h.get('eggnow');
    if (eggs === 'off') {
      localStorage.removeItem('eggForce');
      localStorage.removeItem('eggNow');
    } else if (eggs !== null) localStorage.setItem('eggForce', eggs);
    if (now !== null) localStorage.setItem('eggNow', now);
  } catch {}
}

// the hidden extras that come with a date or the time of day. "eggNow" in localStorage (an ISO time like
// 2026-10-31T21:30) stands in for the clock, so they can be seen out of season
export function eggNow(): Date {
  try {
    const v = localStorage.getItem('eggNow');
    const d = v ? new Date(v) : null;
    if (d && !Number.isNaN(d.getTime())) return d;
  } catch {}
  return new Date();
}

export const isHalloween = (d: Date) => d.getMonth() === 9 && d.getDate() === 31;

// "eggForce" in localStorage (e.g. "rain,towel") shows those now, to see them without rain or a mow at 42 %
const forced = (name: string) => {
  try {
    return (localStorage.getItem('eggForce') ?? '').split(',').includes(name);
  } catch {
    return false;
  }
};
const noChange = () => () => {};
export const useEggForced = (name: string) => useSyncExternalStore(noChange, () => forced(name), () => false);

const clock = (d: Date) => d.toTimeString().slice(0, 5);

// halloween on the viewer's calendar, and whether it's dark at the mower (sunset to sunrise there, 6 pm to 6 am
// without its position). asked again every minute, the night comes in while the page is open
export function useHalloween(): {day: boolean; night: boolean} {
  const datum = datumFromParams(useMowerParams());
  const lat = datum?.lat;
  const lon = datum?.lon;
  const [now, setNow] = useState<{day: boolean; night: boolean}>({day: false, night: false});
  useEffect(() => {
    const check = () => {
      const d = eggNow();
      const day = isHalloween(d);
      const sun = lat !== undefined && lon !== undefined ? sunTimes(lat, lon) : null;
      const night = day && isNightTime(clock(d), sun);
      setNow((was) => (was.day === day && was.night === night ? was : {day, night}));
    };
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, [lat, lon]);
  return now;
}

export const stillPreferred = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// in the dock sitting out the rain: the sensor is wet, or the last run was sent home by the rain in the last 3 hours
export function useUmbrella(): boolean {
  const docked = useDocked();
  const wet = useMowerStateValue((l) => !!l.state?.rain_detected);
  const current = useMowerStateValue((l) => l.state?.current_state);
  const last = useRecentRuns(current)?.latest[0];
  const now = useSyncExternalStore(onMinute, minuteNow, () => 0);
  const force = useEggForced('rain');
  return force || (docked && (wet || (last?.outcome === 'rain' && now / 1000 - last.end < 3 * 3600)));
}

// a clock that moves on once a minute, the same for everyone who asks
let minute = 0;
const minuteListeners = new Set<() => void>();
let minuteTimer: ReturnType<typeof setInterval> | undefined;
function onMinute(listener: () => void) {
  minuteListeners.add(listener);
  minuteTimer ??= setInterval(() => {
    minute = Date.now();
    minuteListeners.forEach((l) => l());
  }, 60000);
  return () => {
    minuteListeners.delete(listener);
    if (!minuteListeners.size) {
      clearInterval(minuteTimer);
      minuteTimer = undefined;
    }
  };
}
const minuteNow = () => (minute ||= Date.now());
