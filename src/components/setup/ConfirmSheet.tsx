'use client';

import {fmt, tr} from '@/lib/i18n';
import {dayText, isSummary, moves, nameById, nameOf, releasesBlade, summaryPreview, words, type SetupStep} from '@/lib/setup';
import {useState} from 'react';
import {Sheet} from './Sheet';
import styles from './Sheet.module.css';
import {StepSymbol} from './StepSymbol';
import {valueText} from './StepValues';

// what moves in a step, as its start button says it; a blade still locked is released first
function startLabel(step: SetupStep): string {
  const {motion} = step;
  if (motion?.blade) return releasesBlade(step) ? tr('Release the blade') : tr('Let the blade turn');
  if (motion?.wheels) return motion.raised ? tr('Let the wheels turn') : tr('Let the mower drive');
  if (isSummary(step)) return tr('Release the mower');
  return tr('Start');
}

// one thing that moves (or stays still) in the step, with its sign
const Move = ({sign, still, children}: {sign: string; still?: boolean; children: React.ReactNode}) => (
  <p className={styles.move} data-still={still || undefined}>
    <StepSymbol name={sign} size={20} />
    {children}
  </p>
);

// Before a start: what moves or what the release writes, every point of the step ticked off, the start names what moves
export function ConfirmSheet(props: {
  step: SetupStep;
  steps: SetupStep[];
  lang: string;
  busy: boolean;
  risky: boolean;
  onStart: (confirm: string[]) => void;
  onClose: () => void;
}) {
  const {step, lang, busy, risky, onStart, onClose} = props;
  const summary = isSummary(step) ? summaryPreview(props.steps) : null;
  const [ticked, setTicked] = useState<string[]>([]);
  const all = step.confirm.every((c) => ticked.includes(c.id));
  const m = moves(step.motion) ? step.motion : null;
  const ground = !!m?.wheels && !m.raised;
  return (
    <Sheet title={m ? tr('The mower moves in a moment') : words(step.texts, lang).name} onClose={onClose}>
      {m && (
        <div className={styles.list}>
          {!!m.wheels && m.raised && <Move sign="wheels">{tr('The wheels turn in the air')}</Move>}
          {ground && <Move sign="ground">{tr('The mower drives')}</Move>}
          {m.wheels === false && (
            <Move sign="wheels" still>
              {tr('The wheels stay still')}
            </Move>
          )}
          {!!m.blade && <Move sign="blade">{tr('The blade turns')}</Move>}
          {m.blade === false && (
            <Move sign="blade" still>
              {tr('The blade stays off')}
            </Move>
          )}
          {ground && (
            <>
              <p className={styles.limit}>
                {m.max_speed
                  ? tr('At most {n} m/s and without the borders of the map, like the remote control', {n: fmt(m.max_speed, 2)})
                  : tr('Without the borders of the map, like the remote control')}
              </p>
              <p className={styles.warn} data-ground>
                {tr('Before the start: a lawn without obstacles and a soft obstacle at hand, such as a cushion.')}
              </p>
            </>
          )}
          {!!m.max_time && <p className={styles.limit}>{tr('Each move at most {n} s, then it stops by itself', {n: m.max_time})}</p>}
          <p className={styles.limit}>{tr('Keep this page open: if it closes, the mower stops.')}</p>
        </div>
      )}
      {summary && (
        <div className={styles.list} data-summary>
          <p className={styles.limit}>{tr('The mower records:')}</p>
          <p className={styles.written}>
            <span>{nameById(step.values, 'date', lang)}</span>
            <b>{dayText(summary.date)}</b>
          </p>
          <p className={styles.written}>
            <span>{nameById(step.values, 'failsafe', lang)}</span>
            <b>{valueText(summary.failsafe, 's')}</b>
          </p>
          <p className={styles.limit}>{tr('MowBite OS restarts once, the lock opens when it is back.')}</p>
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
          {startLabel(step)}
        </button>
      </div>
    </Sheet>
  );
}
