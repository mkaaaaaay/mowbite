'use client';

import {settingsStore} from '@/lib/settings';
import {usePathname} from 'next/navigation';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import LogoMark from './Logo';
import styles from './Grass.module.css';

const SPEED = 260; // px/s
const REGROW_MS = 2500;
// the hedgehog comes out and looks around before the mower starts
const PRE_MS = 1800;
// the hop over the hedgehog starts this long before the mower gets there
const HOP_LEAD = 360;

// a hedgehog that sees the lawn eater coming, trembles and curls up, and gets hopped over. side view, facing left
function Hedgehog() {
  return (
    <svg width="52" height="35" viewBox="0 0 50 34">
      <g className={styles.head}>
        <g className={styles.body}>
        <ellipse cx="27" cy="30" rx="15" ry="4" fill="#c49a6c" />
        <path d="M22 17.5 C14 17.5 8.5 21.5 2.5 26 C8.5 30.5 14 32 22 31.5 Z" fill="#d8b48a" />
        <g>
          <path d="M12.5 31.0 L16.3 29.2 L13.0 26.5 L17.2 25.6 L14.6 22.2 L18.8 22.4 L17.2 18.4 L21.2 19.6 L20.5 15.4 L24.1 17.5 L24.4 13.2 L27.5 16.2 L28.8 12.1 L31.0 15.8 L33.2 12.1 L34.5 16.2 L37.6 13.2 L37.9 17.5 L41.5 15.4 L40.8 19.6 L44.8 18.4 L43.2 22.4 L47.4 22.2 L44.8 25.6 L49.0 26.5 L45.7 29.2 L49.5 31.0 Z" fill="#5b3d22" />
          <path d="M17.0 31.0 L19.2 29.1 L17.7 26.5 L20.4 25.4 L19.7 22.5 L22.6 22.3 L22.8 19.3 L25.6 20.0 L26.7 17.2 L29.1 18.8 L31.0 16.5 L32.9 18.8 L35.3 17.2 L36.4 20.0 L39.2 19.3 L39.4 22.3 L42.3 22.5 L41.6 25.4 L44.3 26.5 L42.8 29.1 L45.0 31.0 Z" fill="#7a5433" />
        </g>
        <ellipse cx="18" cy="32.6" rx="2.6" ry="1.4" fill="#4a3220" />
        <ellipse cx="33" cy="32.8" rx="2.6" ry="1.3" fill="#3a2718" />
        <circle cx="16.5" cy="19" r="1.9" fill="#c49a6c" />
        <circle cx="3.2" cy="26" r="1.7" fill="#1b1b1b" />
        <g className={styles.eyes}>
          <circle cx="10.5" cy="23" r="2.4" fill="#fff" />
          <g className={styles.pupils}>
            <circle cx="10.3" cy="23.2" r="1.2" fill="#1b1b1b" />
          </g>
          <g className={styles.lids}>
            <rect x="7.9" y="20.4" width="5.2" height="5.2" rx="2.5" fill="#d8b48a" />
          </g>
        </g>
        <path className={styles.smile} d="M5.6 28.4 Q7.6 29.8 9.6 28.6" stroke="#7a4e2a" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        <ellipse className={styles.gasp} cx="7.6" cy="29" rx="0.9" ry="1.2" fill="#7a4e2a" />
        </g>
        {/* curled up */}
        <g className={styles.ball}>
          <path d="M38.5 22.5 L35.5 24.4 L37.4 27.5 L33.8 27.9 L34.2 31.5 L30.8 30.4 L29.6 33.7 L27.0 31.2 L24.4 33.7 L23.2 30.4 L19.8 31.5 L20.2 27.9 L16.6 27.5 L18.5 24.4 L15.5 22.5 L18.5 20.6 L16.6 17.5 L20.2 17.1 L19.8 13.5 L23.2 14.6 L24.4 11.3 L27.0 13.8 L29.6 11.3 L30.8 14.6 L34.2 13.5 L33.8 17.1 L37.4 17.5 L35.5 20.6 Z" fill="#5b3d22" />
          <path d="M35.2 23.3 L33.2 25.0 L33.4 27.6 L30.9 28.0 L29.6 30.3 L27.3 29.2 L25.0 30.5 L23.6 28.3 L21.0 28.1 L21.0 25.6 L18.9 24.0 L20.3 21.8 L19.4 19.4 L21.7 18.3 L22.3 15.8 L24.8 16.1 L26.6 14.3 L28.6 16.0 L31.1 15.4 L31.9 17.9 L34.3 18.8 L33.6 21.3 Z" fill="#7a5433" />
        </g>
      </g>
    </svg>
  );
}

// autumn in the northern half of the world, there are leaves on the lawn then
const isAutumn = () => [8, 9, 10].includes(new Date().getMonth());
const LEAF_COLORS = ['#d9822b', '#b8452a', '#e0a93b', '#8d5a2b', '#c9652a'];

function Leaf({color, size = 10}: {color: string; size?: number}) {
  return (
    <svg width={size} height={size} viewBox="-6 -7 12 14">
      <path d="M0 -6 C4 -4 5 2 0 6 C-5 2 -4 -4 0 -6 Z" fill={color} />
      <path d="M0 -5 L0 7" stroke="#5a3a1c" strokeWidth="0.8" strokeLinecap="round" />
    </svg>
  );
}

// a few leaves lying about, the same every time
const LAWN_LEAVES = Array.from({length: 11}, (_, i) => ({
  left: (i * 37 + 7) % 100,
  bottom: (i * 5) % 7,
  rot: (i * 73) % 360,
  color: LEAF_COLORS[i % LEAF_COLORS.length],
  size: 9 + (i % 3) * 2,
}));

// the heap the hedgehog sleeps under, and where each leaf flies to when it's blown away
const PILE = Array.from({length: 18}, (_, i) => {
  const row = i < 7 ? 0 : i < 12 ? 1 : i < 16 ? 2 : 3;
  const inRow = [7, 5, 4, 2][row];
  const k = i - [0, 7, 12, 16][row];
  const x = (k - (inRow - 1) / 2) * (row === 3 ? 9 : 8) + ((i * 7) % 5) - 2;
  const side = x < 0 ? -1 : 1;
  return {
    x,
    y: row * 5,
    rot: (i * 47) % 360,
    color: LEAF_COLORS[(i * 3) % LEAF_COLORS.length],
    dx: side * (40 + ((i * 29) % 70)),
    dy: -(50 + ((i * 17) % 60)),
    spin: side * (180 + ((i * 53) % 360)),
  };
});

// a few leaves drifting down behind the page, optional. the frosted cards blur them
function FallingLeaves() {
  return (
    <div className={styles.falling} aria-hidden="true">
      {[12, 31, 48, 67, 84].map((left, i) => (
        <div
          key={left}
          className={styles.fall}
          style={{left: `${left}%`, animationDuration: `${16 + i * 3}s`, animationDelay: `${i * 5 + 2}s`}}
        >
          <div className={styles.sway} style={{animationDuration: `${3 + (i % 3)}s`}}>
            <Leaf color={LEAF_COLORS[i]} size={14} />
          </div>
        </div>
      ))}
    </div>
  );
}

// the grass along the bottom. it lies behind the page, so taps on it are caught on the window:
// anything in the strip that isn't part of the ui counts. two quick taps start the mower
export default function Grass() {
  const [phase, setPhase] = useState<'idle' | 'peek' | 'mowing' | 'growing'>('idle');
  const [dur, setDur] = useState(0);
  // where the hedgehog sits and when the mower gets there (ms after it starts)
  // gap: the stretch the eater flies over, its grass stays
  const [critter, setCritter] = useState<{x: number; hit: number; gap: [number, number]; keep: [number, number]} | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const pile = useRef<HTMLDivElement>(null);
  // counts the runs, a new heap blows in after each
  const [round, setRound] = useState(0);
  const [autumn] = useState(isAutumn);
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
      // in autumn it's the middle of the heap of leaves
      const p = pile.current?.getBoundingClientRect();
      if (p && Math.abs(e.clientX - (p.left + p.width / 2)) > 22) return;
      if (e.timeStamp - lastTap.current > 400) {
        lastTap.current = e.timeStamp;
        return;
      }
      lastTap.current = 0;
      busy.current = true;
      const w = window.innerWidth;
      const ms = Math.max(3000, (w / SPEED) * 1000);
      // under the heap in autumn, it's the middle of the screen
      const x = p ? Math.round(p.left + p.width / 2) : Math.round(w * (0.45 + Math.random() * 0.1));
      // the mower drives from -80 to w + 10 px, its mouth (where the cut is) is 34 px in, the hedgehog
      // starts 26 px left of x
      const mouthAt = (t: number) => -46 + ((w + 90) * t) / ms;
      const hit = ((x - 26 + 46) / (w + 90)) * ms;
      // off the ground from about 0.2 to 0.8 s into the hop, which starts at HOP_LEAD before the hedgehog
      const up = hit - HOP_LEAD + 200;
      const down = hit - HOP_LEAD + 800;
      setDur(ms);
      setCritter({x, hit, gap: [mouthAt(up), mouthAt(down)], keep: [up, down - up]});
      setPhase('peek');
      timers.push(setTimeout(() => setPhase('mowing'), PRE_MS));
      timers.push(setTimeout(() => setPhase('growing'), PRE_MS + ms + 1200));
      timers.push(
        setTimeout(() => {
          setPhase('idle');
          setCritter(null);
          setRound((r) => r + 1);
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

  const falling = autumn && settings.leaves === true;
  if (!shown) return falling ? <FallingLeaves /> : null;

  return (
    <>
    {falling && <FallingLeaves />}
    <div
      ref={strip}
      className={[styles.grass, phase !== 'idle' ? styles[phase] : '', dashboard ? '' : styles.desktopOnly].join(' ')}
      style={
        {
          '--dur': `${dur}ms`,
          '--t-hop': `${Math.round((critter?.hit ?? 0) - HOP_LEAD)}ms`,
          '--gap-from': `${Math.round(critter?.gap[0] ?? 0)}px`,
          '--gap-to': `${Math.round(critter?.gap[1] ?? 0)}px`,
          '--keep-at': `${Math.round(critter?.keep[0] ?? 0)}ms`,
          '--keep-dur': `${Math.round(critter?.keep[1] ?? 0)}ms`,
          '--t-panic': `${Math.round(Math.max(PRE_MS - 200, PRE_MS + (critter?.hit ?? 0) - 1000))}ms`,
          '--t-curl': `${Math.round(Math.max(PRE_MS + 300, PRE_MS + (critter?.hit ?? 0) - 500))}ms`,
          '--t-relief': `${Math.round(PRE_MS + (critter?.hit ?? 0) + 450)}ms`,
          '--t-sigh': `${Math.round(PRE_MS + (critter?.hit ?? 0) + 800)}ms`,
          '--t-exit': `${Math.round(PRE_MS + dur + 1200 + 900)}ms`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <div className={styles.short} />
      <div className={styles.tall} />
      {autumn && (
        <div className={styles.lawnLeaves}>
          {LAWN_LEAVES.map((l, i) => (
            <div key={i} style={{left: `${l.left}%`, bottom: l.bottom, transform: `rotate(${l.rot}deg)`}}>
              <Leaf color={l.color} size={l.size} />
            </div>
          ))}
        </div>
      )}
      {/* the grass under the jump, it stays when the rest is cut */}
      {critter && phase === 'mowing' && <div className={[styles.tall, styles.keep].join(' ')} />}
      {critter && (
        <div className={[styles.critter, autumn ? styles.fromPile : ''].join(' ')} style={{left: critter.x - 26}}>
          <Hedgehog />
        </div>
      )}
      {autumn && (
        <div ref={pile} key={round} className={[styles.pile, phase !== 'idle' ? styles.blown : ''].join(' ')}>
          {PILE.map((l, i) => (
            <div
              key={i}
              style={
                {
                  left: 32 + l.x - 6,
                  bottom: l.y,
                  '--rot': `${l.rot}deg`,
                  '--dx': `${l.dx}px`,
                  '--dy': `${l.dy}px`,
                  '--spin': `${l.spin}deg`,
                } as React.CSSProperties
              }
            >
              <Leaf color={l.color} size={12} />
            </div>
          ))}
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
    </>
  );
}
