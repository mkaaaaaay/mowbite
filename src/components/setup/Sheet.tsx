'use client';

import {createPortal} from 'react-dom';
import styles from './Sheet.module.css';

// a sheet from below over the page, closed by its own buttons or a tap beside it
export function Sheet({title, sub, onClose, children}: {title: string; sub?: string; onClose: () => void; children: React.ReactNode}) {
  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className={styles.grip} aria-hidden="true" />
        <div className={styles.head}>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export const sheetStyles = styles;
