'use client';

import {fmt, tr} from '@/lib/i18n';
import {moves, nameOf, words, type SetupStep} from '@/lib/setup';
import {useState} from 'react';
import {Sheet} from './Sheet';
import styles from './Sheet.module.css';
import {StepSymbol} from './StepSymbol';

// what moves in a step, as its start button says it
function startLabel(motion: SetupStep['motion']): string {
  if (motion?.blade) return tr('Let the blade turn');
  if (motion?.wheels) return motion.raised ? tr('Let the wheels turn') : tr('Let the mower drive');
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
export function ConfirmSheet(props: {step: SetupStep; lang: string; busy: boolean; risky: boolean; onStart: (confirm: string[]) => void; onClose: () => void}) {
  const {step, lang, busy, risky, onStart, onClose} = props;
  const [ticked, setTicked] = useState<string[]>([]);
  const all = step.confirm.every((c) => ticked.includes(c.id));
  const m = moves(step.motion) ? step.motion : null;
  return (
    <Sheet title={m ? tr('The mower moves in a moment') : words(step.texts, lang).name} onClose={onClose}>
      {m && (
        <div className={styles.list}>
          {!!m.wheels &&
            (m.raised ? (
              <Move sign="wheels">{tr('The wheels turn in the air')}</Move>
            ) : (
              <Move sign="ground">{tr('The mower drives')}</Move>
            ))}
          {!!m.blade && <Move sign="blade">{tr('The blade turns')}</Move>}
          {m.blade === false && (
            <Move sign="blade" still>
              {tr('The blade stays off')}
            </Move>
          )}
          {!!m.wheels && !m.raised && (
            <>
              <p className={styles.limit}>
                {m.max_speed
                  ? tr('At most {n} m/s and without the borders of the map, like the remote control', {n: fmt(m.max_speed, 2)})
                  : tr('Without the borders of the map, like the remote control')}
              </p>
              <p className={styles.warn} data-ground>
                {tr('Before the start: a lawn without obstacles, 3 m clear in front of and behind the mower, a soft obstacle at hand such as a cushion.')}
              </p>
            </>
          )}
          {!!m.max_time && <p className={styles.limit}>{tr('Each move at most {n} s, then it stops by itself', {n: m.max_time})}</p>}
          <p className={styles.limit}>{tr('Keep this page open: if it closes, the mower stops.')}</p>
        </div>
      )}
      {risky && (
        <p className={styles.warn} data-risky>
          {tr("If it doesn't pass this time, the mower stays locked until it passes again.")}
        </p>
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
