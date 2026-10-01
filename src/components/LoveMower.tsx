'use client';

import {useRef, useState} from 'react';
import LogoMark from './Logo';
import {OPENMOWER_PATHS} from './openmowerArt';
import grass from './Grass.module.css';
import styles from './LoveMower.module.css';

const DURATION = 8500;

// the mower from the openmower logo, faces left
function MowerArt() {
  return (
    <svg width="64" height="29" viewBox="32 29 474 214" fill="currentColor" aria-hidden="true">
      {OPENMOWER_PATHS.map((p, i) => (
        <path key={i} transform={p.transform} d={p.d} />
      ))}
    </svg>
  );
}

// a little flower, they come up in the stubble after the kiss
function Flower({color}: {color: string}) {
  return (
    <svg width="10" height="12" viewBox="-5 -5 10 12">
      <path d="M0 1 L0 7" stroke="#558b2f" strokeWidth="1" />
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx="0" cy="-2.3" rx="1.5" ry="2.3" fill={color} transform={`rotate(${a})`} />
      ))}
      <circle r="1.4" fill="#ffd54f" />
    </svg>
  );
}

const FLOWERS = Array.from({length: 12}, (_, i) => ({
  left: (i * 8.3 + 2 + ((i * 7) % 5)) % 100,
  color: ['#ffffff', '#f48fb1', '#90caf9', '#ce93d8'][i % 4],
  delay: (i * 137) % 600,
}));

// sparks flying out from the heart, where to
const SPARKS = [
  [-30, -18],
  [30, -20],
  [-40, 6],
  [42, 4],
  [-14, -34],
  [16, -36],
];

// bits of grass flying up behind a mower while it cuts
function Bits() {
  return (
    <span className={styles.bits}>
      <i style={{'--bx': '18px', '--by': '-16px'} as React.CSSProperties} />
      <i style={{'--bx': '10px', '--by': '-22px', animationDelay: '0.2s', background: '#9ccc65'} as React.CSSProperties} />
      <i style={{'--bx': '24px', '--by': '-10px', animationDelay: '0.4s', background: '#558b2f'} as React.CSSProperties} />
    </span>
  );
}

// the top right corner of the dashboard: double tap it and a strip of lawn grows, our lawn eater leaves
// the title and mows it from the left, an openmower from the right, until they meet and kiss. flowers come up
// in the stubble, and the two drive off together
export default function LoveMower() {
  const [run, setRun] = useState<{top: number; mid: number; lawn: {left: number; width: number}[]; id: number} | null>(null);
  const busy = useRef(false);
  const lastTap = useRef(0);
  const gap = useRef<HTMLSpanElement>(null);

  const start = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (busy.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // two quick taps, like the grass at the bottom
    if (e.timeStamp - lastTap.current > 400) {
      lastTap.current = e.timeStamp;
      return;
    }
    lastTap.current = 0;
    busy.current = true;
    const r = e.currentTarget.getBoundingClientRect();
    const g = gap.current?.getBoundingClientRect() ?? r;
    // the lawn stands on the top edge of the first card below the title, they meet in the middle of the
    // empty space next to the title
    const main = e.currentTarget.closest('main');
    const card = main?.querySelector('section');
    const top = card ? card.getBoundingClientRect().top : r.bottom + 14;
    // the grass only grows on the cards in that row, not in the gaps or over the side bar
    const lawn = card
      ? [...main!.querySelectorAll('section')]
          .map((s) => s.getBoundingClientRect())
          .filter((b) => Math.abs(b.top - top) < 3)
          .map((b) => ({left: b.left, width: b.width}))
      : [];
    setRun({top, mid: (g.left + r.right) / 2, lawn, id: Date.now()});
    // the eater in the title is the one driving, so it's gone from there meanwhile
    const logo = e.currentTarget.parentElement?.querySelector<SVGElement>('svg');
    if (logo) {
      logo.style.transition = 'opacity 0.3s';
      logo.style.opacity = '0';
    }
    setTimeout(() => {
      if (logo) logo.style.opacity = '';
    }, DURATION - 300);
    setTimeout(() => {
      busy.current = false;
      setRun(null);
    }, DURATION + 100);
  };

  return (
    <>
      <span ref={gap} className={styles.gap} />
      <button className={styles.spot} onClick={start} tabIndex={-1} aria-hidden="true" />
      {run && (
        <div className={styles.lane} style={{top: run.top, '--dur': `${DURATION}ms`, '--mid': `${run.mid}px`} as React.CSSProperties} key={run.id}>
          <div
            className={styles.field}
            style={
              run.lawn.length
                ? {
                    maskImage: run.lawn.map(() => 'linear-gradient(#000 0 0)').join(','),
                    maskSize: run.lawn.map((l) => `${l.width}px 100%`).join(','),
                    maskPosition: run.lawn.map((l) => `${l.left}px 0`).join(','),
                    maskRepeat: 'no-repeat',
                  }
                : undefined
            }
          >
            <div className={grass.short} />
            <div className={[grass.tall, styles.leftHalf].join(' ')} />
            <div className={[grass.tall, styles.rightHalf].join(' ')} />
            {FLOWERS.map((f, i) => (
              <span key={i} className={styles.flower} style={{left: `${f.left}%`, animationDelay: `${f.delay}ms`}}>
                <Flower color={f.color} />
              </span>
            ))}
          </div>
          <div className={styles.eater}>
            <Bits />
            <div className={styles.joy}>
              <LogoMark size={56} bare chomp />
            </div>
          </div>
          <div className={styles.mower}>
            <Bits />
            <div className={styles.wiggle}>
              <MowerArt />
            </div>
            <span className={styles.trail}>♥</span>
            <span className={[styles.trail, styles.t2].join(' ')}>♥</span>
          </div>
          <span className={styles.heart}>♥</span>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <span key={n} className={[styles.small, styles[`s${n}`]].join(' ')}>
              ♥
            </span>
          ))}
          {SPARKS.map(([x, y], i) => (
            <span key={i} className={styles.spark} style={{'--sx': `${x}px`, '--sy': `${y}px`} as React.CSSProperties}>
              ✦
            </span>
          ))}
        </div>
      )}
    </>
  );
}
