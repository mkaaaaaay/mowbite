'use client';

import {useState} from 'react';
import styles from './page.module.css';

// open or not while the app runs: every start they're folded again
const opened = new Map<string, boolean>();

// A part of the editor that folds away. On a phone it sits right under the map, so the map stays in view while it's
// open (its content scrolls on its own).
export function Fold({id, title, children}: {id: string; title: string; children: React.ReactNode}) {
  const [open, setOpen] = useState(() => opened.get(id) ?? false);
  return (
    <details
      id={'fold-' + id}
      className={styles.fold}
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (now === open) return;
        setOpen(now);
        opened.set(id, now);
      }}
    >
      <summary>{title}</summary>
      <div className={styles.foldBody}>{children}</div>
    </details>
  );
}
