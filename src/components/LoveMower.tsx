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

// the top right corner of the dashboard: double tap it and a strip of lawn grows, our lawn eater leaves
// the title and mows it from the left, an openmower from the right, until they meet and kiss
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
          </div>
          <div className={styles.eater}>
            <LogoMark size={56} bare chomp />
          </div>
          <div className={styles.mower}>
            <MowerArt />
          </div>
          <span className={styles.heart}>♥</span>
          <span className={[styles.small, styles.s1].join(' ')}>♥</span>
          <span className={[styles.small, styles.s2].join(' ')}>♥</span>
          <span className={[styles.small, styles.s3].join(' ')}>♥</span>
        </div>
      )}
    </>
  );
}
