'use client';

import {tr} from '@/lib/i18n';
import {createPortal} from 'react-dom';
import shared from './AutoUpdate.module.css';
import local from './AskSheet.module.css';

// asked before a setting goes where it needs a second thought: the recorded outline pass on, a protection off
export function AskSheet({title, lines, yes, onYes, onClose}: {title: string; lines: string[]; yes: string; onYes: () => void; onClose: () => void}) {
  return createPortal(
    <div className={local.backdrop} onClick={onClose}>
      <section className={local.sheet} role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
        <div className={shared.row}>
          <button
            className={[shared.control, shared.primary].join(' ')}
            onClick={() => {
              onClose();
              onYes();
            }}
          >
            {yes}
          </button>
          <button className={shared.control} onClick={onClose}>
            {tr('Cancel')}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
