'use client';

import {tr} from '@/lib/i18n';
import {nameOf, SKIP_TEXT, type SetupStep} from '@/lib/setup';
import {useState} from 'react';
import {Sheet} from './Sheet';

// Skipping a step: one of its reasons, a text of the user's own with other
export function SkipSheet({step, lang, busy, onSkip, onClose}: {step: SetupStep; lang: string; busy: boolean; onSkip: (reason: string, note: string) => void; onClose: () => void}) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const ready = !!reason && (reason !== 'other' || !!note.trim());
  return (
    <Sheet title={tr('Skip “{step}”', {step: nameOf(step, lang)})} onClose={onClose}>
      {step.skip_reasons.map((r) => (
        <label key={r.id}>
          <input type="radio" name="skip" checked={reason === r.id} onChange={() => setReason(r.id)} />
          {nameOf(r, lang)}
        </label>
      ))}
      {reason === 'other' && <textarea maxLength={SKIP_TEXT} value={note} onChange={(e) => setNote(e.target.value)} aria-label={tr('Why')} />}
      <button type="button" disabled={busy || !ready} onClick={() => onSkip(reason!, reason === 'other' ? note.trim() : '')}>
        {tr('Skip')}
      </button>
    </Sheet>
  );
}
