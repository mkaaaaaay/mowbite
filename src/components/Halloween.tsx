'use client';

import {stillPreferred} from '@/lib/eggs';
import {useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import styles from './Halloween.module.css';

// halloween in the grass at the bottom: a carved pumpkin sits in the lawn, after dark its face glows. two quick taps on
// it and a little ghost comes out with a "boo!", at night bats flutter off with it

function Pumpkin() {
  // own id, a gradient in a hidden copy would paint nothing
  const body = useId();
  return (
    <svg width="34" height="30" viewBox="0 0 34 30" aria-hidden="true">
      <defs>
        <radialGradient id={body} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#ffb74d" />
          <stop offset="0.65" stopColor="#f57c00" />
          <stop offset="1" stopColor="#c25100" />
        </radialGradient>
      </defs>
      {/* the stem and a curl of vine */}
      <path d="M16.4 6.4 C16 3.6 17 1.6 19.4 0.8 L20.2 2.2 C18.6 3 18.2 4.6 18.6 6.6 Z" fill="#5d7a2a" />
      <path d="M19.4 2.4 C22.6 1.8 24.6 3.4 23.4 5.2 C22.6 6.2 21 5.6 21.6 4.6" fill="none" stroke="#7cb342" strokeWidth="0.9" strokeLinecap="round" />
      {/* five ribs, the middle one in front */}
      <ellipse cx="9" cy="17.6" rx="8" ry="10.4" fill={`url(#${body})`} />
      <ellipse cx="25" cy="17.6" rx="8" ry="10.4" fill={`url(#${body})`} />
      <ellipse cx="13" cy="17.6" rx="7.6" ry="11" fill={`url(#${body})`} />
      <ellipse cx="21" cy="17.6" rx="7.6" ry="11" fill={`url(#${body})`} />
      <ellipse cx="17" cy="17.4" rx="7.4" ry="11.4" fill={`url(#${body})`} stroke="#c25100" strokeWidth="0.4" />
      {/* the carved face: lit from inside after dark */}
      <g className={styles.face}>
        <path d="M9.6 14.6 L12.8 10.8 L14.6 15.2 Z M19.4 15.2 L21.2 10.8 L24.4 14.6 Z" />
        <path d="M16.2 17.2 L17 15.6 L17.8 17.2 Z" />
        <path d="M8.8 19.4 Q17 25.6 25.2 19.4 L23.6 20.2 L22.6 22 L21 20.8 L19.4 23 L17.6 21.4 L15.8 23 L14 21 L12.4 22.4 L11.2 20.4 Z" />
      </g>
    </svg>
  );
}

function Ghost() {
  return (
    <svg width="26" height="30" viewBox="0 0 26 30" aria-hidden="true">
      <path
        d="M3 28 L3 13 C3 6 7.6 1.6 13 1.6 C18.4 1.6 23 6 23 13 L23 28 L19.6 25.4 L16.4 28.4 L13 25.6 L9.6 28.4 L6.4 25.4 Z"
        fill="#fafafa"
        stroke="#cfd8dc"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      <ellipse cx="9.6" cy="11.6" rx="1.7" ry="2.4" fill="#263238" />
      <ellipse cx="16.4" cy="11.6" rx="1.7" ry="2.4" fill="#263238" />
      <ellipse cx="13" cy="17.6" rx="2" ry="2.6" fill="#263238" />
      <ellipse cx="6.8" cy="15" rx="1.5" ry="0.8" fill="#f8bbd0" opacity="0.8" />
      <ellipse cx="19.2" cy="15" rx="1.5" ry="0.8" fill="#f8bbd0" opacity="0.8" />
    </svg>
  );
}

function Bat() {
  return (
    <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true">
      <g className={styles.wings}>
        <path d="M11 4 C8 0.6 4 0.4 0.6 2.8 C2.6 3.4 3.6 5 3.4 6.8 C5 5.6 7 6 8 7.6 C8.8 6.4 10 5.8 11 6 Z" fill="#212121" />
        <path d="M11 4 C14 0.6 18 0.4 21.4 2.8 C19.4 3.4 18.4 5 18.6 6.8 C17 5.6 15 6 14 7.6 C13.2 6.4 12 5.8 11 6 Z" fill="#212121" />
      </g>
      <ellipse cx="11" cy="6" rx="2.2" ry="3" fill="#212121" />
      <path d="M9.6 3.6 L10 2 L10.8 3.4 M12.4 3.6 L12 2 L11.2 3.4" fill="#212121" />
      <circle cx="10.2" cy="5.4" r="0.45" fill="#ffeb3b" />
      <circle cx="11.8" cy="5.4" r="0.45" fill="#ffeb3b" />
    </svg>
  );
}

// the bats' ways off, x and y in px from the pumpkin, and when they set off
const BATS = [
  {x: -140, y: -120, d: 0.1},
  {x: 110, y: -150, d: 0.35},
  {x: -60, y: -170, d: 0.6},
];

export function PumpkinPatch({night}: {night: boolean}) {
  const pumpkin = useRef<HTMLDivElement>(null);
  // the ghost's start, over the page: the grass lies behind the content, it would come up behind the cards
  const [boo, setBoo] = useState<{id: number; x: number; y: number} | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const p = pumpkin.current?.getBoundingClientRect();
      if (!p || !p.width || stillPreferred()) return;
      if (e.clientX < p.left - 6 || e.clientX > p.right + 6 || e.clientY < p.top - 10 || e.clientY > p.bottom + 4) return;
      if ((e.target as Element).closest('button, a, input, select, textarea, label, section, article, nav, [role]')) return;
      if (e.timeStamp - lastTap.current > 400) {
        lastTap.current = e.timeStamp;
        return;
      }
      lastTap.current = 0;
      setBoo((b) => b ?? {id: Date.now(), x: p.left, y: p.top + 14});
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    if (!boo) return;
    const t = setTimeout(() => setBoo(null), 4200);
    return () => clearTimeout(t);
  }, [boo]);

  return (
    <div className={[styles.patch, night ? styles.night : ''].join(' ')}>
      {night && <div className={styles.glow} />}
      <div ref={pumpkin} className={[styles.pumpkin, boo ? styles.jump : ''].join(' ')}>
        <Pumpkin />
      </div>
      {boo &&
        createPortal(
          <div key={boo.id} className={styles.boo} style={{left: boo.x + 4, top: boo.y}}>
            <div className={styles.ghost}>
              <Ghost />
              <b>Boo!</b>
            </div>
            {night &&
              BATS.map((b, i) => (
                <div key={i} className={styles.bat} style={{'--bx': `${b.x}px`, '--by': `${b.y}px`, animationDelay: `${b.d}s`} as React.CSSProperties}>
                  <Bat />
                </div>
              ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

// the ghost that follows the mower on the map on halloween night, drawn in a 26 by 30 box around 0,0
export function MapGhost() {
  return (
    <g transform="translate(-13 -15)">
      <path
        d="M3 28 L3 13 C3 6 7.6 1.6 13 1.6 C18.4 1.6 23 6 23 13 L23 28 L19.6 25.4 L16.4 28.4 L13 25.6 L9.6 28.4 L6.4 25.4 Z"
        fill="#fafafa"
        fillOpacity="0.85"
        stroke="#b2dfdb"
        strokeWidth="0.8"
      />
      <ellipse cx="9.6" cy="11.6" rx="1.7" ry="2.4" fill="#263238" />
      <ellipse cx="16.4" cy="11.6" rx="1.7" ry="2.4" fill="#263238" />
      <ellipse cx="13" cy="17.6" rx="2" ry="2.6" fill="#263238" />
    </g>
  );
}
