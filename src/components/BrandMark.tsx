'use client';

import {stillPreferred} from '@/lib/eggs';
import {tr} from '@/lib/i18n';
import {useState} from 'react';
import LogoMark from './Logo';
import styles from './BrandMark.module.css';
import {Towel, Umbrella, WitchHat} from './Costumes';

// the eater in the dashboard's title, dressed for the moment: a witch's hat on halloween, a towel at 42 % of a mow,
// an umbrella while it sits out the rain in the dock. all drawn in the eater's 64 box, the hat and the umbrella stick
// out over the top

const DROPS = [
  // left in px of the 40 px eater, how far down it falls, the delay; the ones over the umbrella end on it
  {x: -6, to: 46, d: 0},
  {x: 2, to: 46, d: 0.55},
  {x: 16, to: 2, d: 0.2},
  {x: 24, to: -1, d: 0.85},
  {x: 31, to: 0, d: 0.4},
  {x: 38, to: 3, d: 1.1},
  {x: 46, to: 46, d: 0.7},
  {x: 52, to: 46, d: 0.15},
];

export function BrandMark({hat, towel, umbrella}: {hat?: boolean; towel?: boolean; umbrella?: boolean}) {
  const [shaking, setShaking] = useState(false);
  const still = stillPreferred();
  const dressed = hat || towel || umbrella;
  const shake = () => {
    if (!umbrella || shaking || still) return;
    setShaking(true);
    setTimeout(() => setShaking(false), 900);
  };
  return (
    <span
      className={[styles.mark, umbrella ? styles.rainy : '', shaking ? styles.shaking : ''].join(' ')}
      onClick={shake}
      title={umbrella ? tr('Waiting for the rain to stop') : towel ? tr("Don't panic.") : undefined}
    >
      <LogoMark size={40} className={dressed ? styles.dressed : undefined}>
        {towel && <Towel />}
        {hat && <WitchHat />}
        {umbrella && <Umbrella />}
      </LogoMark>
      {umbrella && !still && (
        <span className={styles.rain} aria-hidden="true">
          {DROPS.map((r, i) => (
            <i key={i} style={{left: r.x, '--to': `${r.to}px`, animationDelay: `${r.d}s`} as React.CSSProperties} />
          ))}
          {shaking && [-1, 1, -1, 1].map((s, i) => <b key={i} style={{'--dx': `${s * (10 + i * 3)}px`, '--dy': `${-6 - i * 2}px`} as React.CSSProperties} />)}
        </span>
      )}
    </span>
  );
}
