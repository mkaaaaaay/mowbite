'use client';

import {useEffect, useRef, useState} from 'react';
import LogoMark from './Logo';
import styles from './Grass.module.css';

const SPEED = 260; // px/s
const REGROW_MS = 2500;

// the grass along the bottom. it lies behind the page, so taps on it are caught on the window:
// anything in the strip that isn't part of the ui counts
export default function Grass() {
  const [phase, setPhase] = useState<'idle' | 'mowing' | 'growing'>('idle');
  const [dur, setDur] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const onClick = (e: MouseEvent) => {
      const r = strip.current?.getBoundingClientRect();
      if (!r || busy.current || e.clientY < r.top || e.clientY > r.bottom) return;
      const target = e.target as Element;
      if (target.closest('button, a, input, select, textarea, label, section, article, nav, svg, [role]')) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
          <LogoMark size={40} chomp bare />
        </div>
      )}
    </div>
  );
}
