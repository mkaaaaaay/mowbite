'use client';

import {tr} from '@/lib/i18n';
import {nameOf, words, type SetupStep} from '@/lib/setup';
import {useState} from 'react';
import {Sheet} from './Sheet';
import styles from './Sheet.module.css';
import {StepSymbol} from './StepSymbol';

// what moves in a step, as its start button says it
function startLabel(motion: SetupStep['motion']): string {
  if (motion?.blade) return tr('Let the blade turn');
  if (motion?.wheels) return tr('Let the wheels turn');
  return tr('Start');
}

// one thing that moves (or stays still) in the step, with its sign
const Move = ({sign, still, children}: {sign: string; still?: boolean; children: React.ReactNode}) => (
  <p className={styles.move} data-still={still || undefined}>
    <StepSymbol name={sign} size={20} />
    {children}
  </p>
);

// Before a start: what moves, every point of the step ticked off, the start names what moves
export function ConfirmSheet({step, lang, busy, onStart, onClose}: {step: SetupStep; lang: string; busy: boolean; onStart: (confirm: string[]) => void; onClose: () => void}) {
  const [ticked, setTicked] = useState<string[]>([]);
  const all = step.confirm.every((c) => ticked.includes(c.id));
  const m = step.motion;
  return (
    <Sheet title={m ? tr('The mower moves in a moment') : words(step.texts, lang).name} onClose={onClose}>
      {m && (
        <div className={styles.list}>
          {!!m.wheels && <Move sign="wheels">{tr('The wheels turn')}</Move>}
          {!!m.blade && <Move sign="blade">{tr('The blade turns')}</Move>}
          {m.blade === false && (
            <Move sign="blade" still>
              {tr('The blade stays off')}
            </Move>
          )}
        </div>
      )}
      {step.confirm.length > 0 && (
        <div className={styles.list}>
          {step.confirm.map((c) => (
            <label key={c.id} className={styles.check} data-point={c.id}>
              <input
                type="checkbox"
                checked={ticked.includes(c.id)}
                onChange={(e) => setTicked(e.target.checked ? [...ticked, c.id] : ticked.filter((t) => t !== c.id))}
              />
              {nameOf(c, lang)}
            </label>
          ))}
        </div>
      )}
      <div className={styles.buttons}>
        <button type="button" className={styles.button} onClick={onClose}>
          {tr('Cancel')}
        </button>
        <button type="button" className={styles.button} data-primary disabled={busy || !all} onClick={() => onStart(ticked)}>
          {startLabel(step.motion)}
        </button>
      </div>
    </Sheet>
  );
}
