'use client';

import {recordedLoopWarning} from '@/lib/recordedLoop';
import {tr} from '@/lib/i18n';
import {createPortal} from 'react-dom';
import shared from './AutoUpdate.module.css';
import local from './RecordedLoopAsk.module.css';

// asked before the recorded outline pass is switched on, for all areas or for one
export function RecordedLoopAsk({onYes, onClose}: {onYes: () => void; onClose: () => void}) {
  const warning = recordedLoopWarning();
  return createPortal(
    <div className={local.backdrop} onClick={onClose}>
      <section className={local.sheet} role="alertdialog" aria-modal="true" aria-label={warning.title} onClick={(e) => e.stopPropagation()}>
        <h2>{warning.title}</h2>
        {warning.lines.map((l) => (
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
            {tr('Switch on')}
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
