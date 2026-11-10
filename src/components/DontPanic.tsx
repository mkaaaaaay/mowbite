'use client';

import {tr} from '@/lib/i18n';
import {useEffect, useState} from 'react';
import styles from './DontPanic.module.css';

// next to the progress when a mow is exactly 42 % done: a towel, the one thing a hitchhiker shouldn't be without.
// tapped it says what's written on the guide's cover
export function DontPanic() {
  const [say, setSay] = useState(false);
  useEffect(() => {
    if (!say) return;
    const t = setTimeout(() => setSay(false), 3500);
    return () => clearTimeout(t);
  }, [say]);
  return (
    <button type="button" className={styles.towel} onClick={() => setSay(!say)} title={tr("Don't panic.")} aria-label={tr("Don't panic.")}>
      <svg viewBox="0 0 20 18" width="17" height="15" aria-hidden="true">
        <path d="M2 3 H18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
        <g className={styles.sway}>
          <path d="M5 3 H15 V14.2 H5 Z" fill="#f3e3b0" stroke="#c9b06a" strokeWidth="0.7" strokeLinejoin="round" />
          <path d="M5 3 V9 H15 V3" fill="#e8d495" opacity="0.6" />
          <path d="M5 11 H15 M5 12.6 H15" stroke="#4f74e3" strokeWidth="0.9" />
          <path d="M6 14.2 v1.6 M8 14.2 v1.6 M10 14.2 v1.6 M12 14.2 v1.6 M14 14.2 v1.6" stroke="#c9b06a" strokeWidth="0.6" strokeLinecap="round" />
        </g>
      </svg>
      {say && <b className={styles.bubble}>{tr("Don't panic.")}</b>}
    </button>
  );
}
