'use client';

import {useState} from 'react';
import styles from './page.module.css';

// open or not while the app runs: every start they're folded again
const opened = new Map<string, boolean>();

// A part of the editor that folds away, like the groups of the settings: its title and in a line under it what's inside
export function Fold({id, title, hint, children}: {id: string; title: string; hint?: string; children: React.ReactNode}) {
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
      <summary>
        <span className={styles.foldTitle}>
          {title}
          {hint && <small>{hint}</small>}
        </span>
      </summary>
      <div className={styles.foldBody}>{children}</div>
    </details>
  );
}
