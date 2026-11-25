'use client';

import {tr} from '@/lib/i18n';
import {jobOpenNow} from '@/lib/mowerBody';
import {useState} from 'react';
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
              onYes();
              onClose();
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

// a change to the planner asks first while it holds a mow's plans (job_open, read anew), ask() says whether to go on
export function useJobAsk() {
  const [held, setHeld] = useState<((yes: boolean) => void) | null>(null);
  const ask = async () => (await jobOpenNow()) ? new Promise<boolean>((done) => setHeld(() => done)) : true;
  const answer = (yes: boolean) => {
    held?.(yes);
    setHeld(null);
  };
  const sheet = held && (
    <AskSheet
      title={tr('Save during a mow?')}
      lines={[tr('A mow is under way or paused.'), tr('An area whose plan this changes starts again from its beginning.')]}
      yes={tr('Save anyway')}
      onYes={() => answer(true)}
      onClose={() => answer(false)}
    />
  );
  return {ask, sheet};
}
