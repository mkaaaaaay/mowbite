'use client';

import {tr} from '@/lib/i18n';
import {createPortal} from 'react-dom';
import styles from './Sheet.module.css';

// a sheet from below over the page, closed by its button or a tap beside it
export function Sheet({title, onClose, children}: {title: string; onClose: () => void; children: React.ReactNode}) {
  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>
            {tr('Cancel')}
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
