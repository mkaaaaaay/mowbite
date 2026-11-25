'use client';

import {tr} from '@/lib/i18n';
import {nameOf, SKIP_TEXT, type SetupStep} from '@/lib/setup';
import {useState} from 'react';
import {Sheet} from './Sheet';
import styles from './Sheet.module.css';

// Skipping a step: one of its reasons, a text of the user's own with other
export function SkipSheet({step, lang, busy, onSkip, onClose}: {step: SetupStep; lang: string; busy: boolean; onSkip: (reason: string, note: string) => void; onClose: () => void}) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const ready = !!reason && (reason !== 'other' || !!note.trim());
  return (
    <Sheet title={tr('Skip “{step}”?', {step: nameOf(step, lang)})} sub={tr('You can do it later at any time.')} onClose={onClose}>
      <fieldset className={styles.list}>
        <legend>{tr('Why?')}</legend>
        {step.skip_reasons.map((r) => (
          <label key={r.id} className={styles.choice}>
            <input type="radio" name="skip" checked={reason === r.id} onChange={() => setReason(r.id)} />
            {nameOf(r, lang)}
          </label>
        ))}
      </fieldset>
      {reason === 'other' && (
        <label className={styles.field}>
          {tr('What is it? (up to {n} characters)', {n: SKIP_TEXT})}
          <textarea maxLength={SKIP_TEXT} value={note} onChange={(e) => setNote(e.target.value)} aria-label={tr('Why')} />
        </label>
      )}
      <div className={styles.buttons}>
        <button type="button" className={styles.button} onClick={onClose}>
          {tr('Back')}
        </button>
        <button type="button" className={styles.button} data-primary disabled={busy || !ready} onClick={() => onSkip(reason!, reason === 'other' ? note.trim() : '')}>
          {tr('Skip')}
        </button>
      </div>
    </Sheet>
  );
}
