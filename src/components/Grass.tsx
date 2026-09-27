'use client';

import {settingsStore} from '@/lib/settings';
import {usePathname} from 'next/navigation';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import LogoMark from './Logo';
import styles from './Grass.module.css';

const SPEED = 260; // px/s
const REGROW_MS = 2500;
// the flower comes up and looks around before the mower starts
const PRE_MS = 1800;
// the hop over the flower starts this long before the mower gets there
const HOP_LEAD = 360;

// a flower that sees the lawn eater coming, panics, and gets hopped over
function Flower() {
  return (
    <svg width="28" height="46" viewBox="0 0 34 56">
      <path d="M17 54 V30" stroke="#3f9a4a" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M17 46 Q8 44 6 37 Q14 37 17 43" fill="#4cbf72" />
      <path d="M17 41 Q26 39 28 32 Q20 32 17 38" fill="#4cbf72" />
      <g className={styles.head}>
        {[0, 72, 144, 216, 288].map((a) => (
          <circle
            key={a}
            cx={17 + 9 * Math.sin((a * Math.PI) / 180)}
            cy={17 - 9 * Math.cos((a * Math.PI) / 180)}
            r="6.5"
            fill="#ff8fb3"
          />
        ))}
        <circle cx="17" cy="17" r="8" fill="#ffd54a" />
        <g className={styles.eyes}>
          <circle cx="13.6" cy="15.5" r="2.6" fill="#fff" />
          <circle cx="20.4" cy="15.5" r="2.6" fill="#fff" />
          <g className={styles.pupils}>
            <circle cx="13.6" cy="15.7" r="1.3" fill="#1b1b1b" />
            <circle cx="20.4" cy="15.7" r="1.3" fill="#1b1b1b" />
          </g>
          <g className={styles.lids}>
            <rect x="10.8" y="12.8" width="5.6" height="5.4" rx="2.6" fill="#ffd54a" />
            <rect x="17.6" y="12.8" width="5.6" height="5.4" rx="2.6" fill="#ffd54a" />
          </g>
        </g>
        <path className={styles.smile} d="M14.6 20 Q17 22 19.4 20" stroke="#8a5a00" strokeWidth="1" fill="none" strokeLinecap="round" />
        <ellipse className={styles.gasp} cx="17" cy="20.8" rx="1.3" ry="1.6" fill="#8a5a00" />
      </g>
    </svg>
  );
}

// the grass along the bottom. it lies behind the page, so taps on it are caught on the window:
// anything in the strip that isn't part of the ui counts. two quick taps start the mower
export default function Grass() {
  const [phase, setPhase] = useState<'idle' | 'flower' | 'mowing' | 'growing'>('idle');
  const [dur, setDur] = useState(0);
  // where the flower stands and when the mower gets there (ms after it starts)
  // gap: the stretch the eater flies over, its grass stays
  const [flower, setFlower] = useState<{x: number; hit: number; gap: [number, number]; keep: [number, number]} | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const lastTap = useRef(0);
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const shown = settings.grass !== false;
  // on phones only on the dashboard, elsewhere it would sit on top of the content above the tab bar
  const dashboard = usePathname().replace(/(.)\/$/, '$1') === '/';

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
      const w = window.innerWidth;
      const ms = Math.max(3000, (w / SPEED) * 1000);
      const x = Math.round(w * (0.45 + Math.random() * 0.1));
      // the mower drives from -80 to w + 10 px, its mouth (where the cut is) is 34 px in, the flower
      // starts 10 px left of x
      const mouthAt = (t: number) => -46 + ((w + 90) * t) / ms;
      const hit = ((x - 10 + 46) / (w + 90)) * ms;
      // off the ground from about 0.2 to 0.8 s into the hop, which starts at HOP_LEAD before the flower
      const up = hit - HOP_LEAD + 200;
      const down = hit - HOP_LEAD + 800;
      setDur(ms);
      setFlower({x, hit, gap: [mouthAt(up), mouthAt(down)], keep: [up, down - up]});
      setPhase('flower');
      timers.push(setTimeout(() => setPhase('mowing'), PRE_MS));
      timers.push(setTimeout(() => setPhase('growing'), PRE_MS + ms + 1200));
      timers.push(
        setTimeout(() => {
          setPhase('idle');
          setFlower(null);
          busy.current = false;
        }, PRE_MS + ms + 1200 + REGROW_MS),
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
      className={[styles.grass, phase !== 'idle' ? styles[phase] : '', dashboard ? '' : styles.desktopOnly].join(' ')}
      style={
        {
          '--dur': `${dur}ms`,
          '--t-hop': `${Math.round((flower?.hit ?? 0) - HOP_LEAD)}ms`,
          '--gap-from': `${Math.round(flower?.gap[0] ?? 0)}px`,
          '--gap-to': `${Math.round(flower?.gap[1] ?? 0)}px`,
          '--keep-at': `${Math.round(flower?.keep[0] ?? 0)}ms`,
          '--keep-dur': `${Math.round(flower?.keep[1] ?? 0)}ms`,
          '--t-panic': `${Math.round(Math.max(PRE_MS - 200, PRE_MS + (flower?.hit ?? 0) - 1000))}ms`,
          '--t-relief': `${Math.round(PRE_MS + (flower?.hit ?? 0) + 450)}ms`,
          '--t-exit': `${Math.round(PRE_MS + dur + 1200 + 900)}ms`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <div className={styles.short} />
      <div className={styles.tall} />
      {/* the grass under the jump, it stays when the rest is cut */}
      {flower && phase === 'mowing' && <div className={[styles.tall, styles.keep].join(' ')} />}
      {flower && (
        <div className={styles.bloom} style={{left: flower.x - 14}}>
          <Flower />
        </div>
      )}
      {phase === 'mowing' && (
        <div className={styles.mower}>
          <div className={styles.hop}>
            <LogoMark size={64} chomp bare />
          </div>
        </div>
      )}
    </div>
  );
}
