'use client';

import {settingsStore} from '@/lib/settings';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import LogoMark from './Logo';
import styles from './Grass.module.css';

const SPEED = 260; // px/s
const REGROW_MS = 2500;

// the grass along the bottom. it lies behind the page, so taps on it are caught on the window:
// anything in the strip that isn't part of the ui counts. two quick taps start the mower
export default function Grass() {
  const [phase, setPhase] = useState<'idle' | 'mowing' | 'growing'>('idle');
  const [dur, setDur] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const lastTap = useRef(0);
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const shown = settings.grass !== false;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const onClick = (e: MouseEvent) => {
      const r = strip.current?.getBoundingClientRect();
      if (!r || busy.current || e.clientY < r.top || e.clientY > r.bottom) return;
      const target = e.target as Element;
      if (target.closest('button, a, input, select, textarea, label, section, article, nav, svg, [role]')) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (e.timeStamp - lastTap.current > 400) {
        lastTap.current = e.timeStamp;
        return;
      }
      lastTap.current = 0;
      busy.current = true;
      const ms = Math.max(3000, (window.innerWidth / SPEED) * 1000);
      setDur(ms);
      setPhase('mowing');
      timers.push(setTimeout(() => setPhase('growing'), ms + 1200));
      timers.push(
        setTimeout(() => {
          setPhase('idle');
          busy.current = false;
        }, ms + 1200 + REGROW_MS),
      );
    };
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('click', onClick);
      timers.forEach(clearTimeout);
    };
  }, []);

  if (!shown) return null;

  return (
    <div
      ref={strip}
      className={[styles.grass, phase !== 'idle' ? styles[phase] : ''].join(' ')}
      style={{'--dur': `${dur}ms`} as React.CSSProperties}
      aria-hidden="true"
    >
      <div className={styles.short} />
      <div className={styles.tall} />
      {phase === 'mowing' && (
        <div className={styles.mower}>
          <LogoMark size={64} chomp bare />
        </div>
      )}
    </div>
  );
}
