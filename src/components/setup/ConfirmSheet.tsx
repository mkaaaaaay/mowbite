'use client';

import {tr} from '@/lib/i18n';
import {nameOf, words, type SetupStep} from '@/lib/setup';
import {useState} from 'react';
import {Sheet} from './Sheet';

// what moves in a step, as its start button says it
function startLabel(motion: SetupStep['motion']): string {
  if (motion?.blade) return tr('Let the blade turn');
  if (motion?.wheels) return tr('Let the wheels turn');
  return tr('Start');
}

// Before a start: every point of the step ticked off, the start names what moves
export function ConfirmSheet({step, lang, busy, onStart, onClose}: {step: SetupStep; lang: string; busy: boolean; onStart: (confirm: string[]) => void; onClose: () => void}) {
  const [ticked, setTicked] = useState<string[]>([]);
  const all = step.confirm.every((c) => ticked.includes(c.id));
  return (
    <Sheet title={words(step.texts, lang).name} onClose={onClose}>
      {step.confirm.map((c) => (
        <label key={c.id} data-point={c.id}>
          <input
            type="checkbox"
            checked={ticked.includes(c.id)}
            onChange={(e) => setTicked(e.target.checked ? [...ticked, c.id] : ticked.filter((t) => t !== c.id))}
          />
          {nameOf(c, lang)}
        </label>
      ))}
      <button type="button" disabled={busy || !all} onClick={() => onStart(ticked)}>
        {startLabel(step.motion)}
      </button>
    </Sheet>
  );
}
