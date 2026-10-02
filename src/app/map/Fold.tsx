'use client';

import {useState} from 'react';
import styles from './page.module.css';

// A part of the editor that folds away. On a phone it sits right under the map and starts folded, so the map
// stays in view while it's open (its content scrolls on its own); on a wide screen it starts open. Open or not is
// kept per device.
export function Fold({id, title, children}: {id: string; title: string; children: React.ReactNode}) {
  const key = 'mapFold.' + id;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      if (v === '1' || v === '0') return v === '1';
    } catch {}
    return typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches;
  });
  return (
    <details
      className={styles.fold}
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (now === open) return;
        setOpen(now);
        try {
          localStorage.setItem(key, now ? '1' : '0');
        } catch {}
      }}
    >
      <summary>{title}</summary>
      <div className={styles.foldBody}>{children}</div>
    </details>
  );
}
