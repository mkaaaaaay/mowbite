'use client';

import {tr} from '@/lib/i18n';
import {useEffect, useState} from 'react';
import styles from './Clock.module.css';

// seconds left until the part of now gives up, again every second
export function useLeft(endsAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (endsAt === null) return;
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  return endsAt === null ? null : Math.max(0, Math.round(endsAt - now));
}

const clockOf = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// the time left as a ring that empties, out of the most seen since the part began
export function Clock({left, className}: {left: number; className?: string}) {
  const [most, setMost] = useState(left);
  if (left > most) setMost(left);
  const share = most ? left / most : 0;
  return (
    <span className={`${styles.clock} ${className ?? ''}`} role="img" aria-label={tr('{time} left', {time: clockOf(left)})}>
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r="24" className={styles.track} />
        <circle cx="28" cy="28" r="24" className={styles.ring} pathLength={100} strokeDasharray={`${share * 100} 100`} />
      </svg>
      <b aria-hidden="true">{clockOf(left)}</b>
    </span>
  );
}
