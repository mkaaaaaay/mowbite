import {tr} from '@/lib/i18n';
import type {PartState, StepState} from '@/lib/setup';
import styles from './StateMark.module.css';

type State = StepState | PartState;

const SIGNS: Partial<Record<State, React.ReactNode>> = {
  ok: <path d="M5 12l5 5 9-10" strokeWidth={3} />,
  failed: <path d="M7 7l10 10M17 7 7 17" strokeWidth={3} />,
  skipped: <path d="M5 12h12M13 7l5 5-5 5" />,
  stale: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  locked: (
    <>
      <rect x="6" y="11" width="12" height="9" rx="2" />
      <path d="M9 11V8a3 3 0 0 1 6 0v3" />
    </>
  ),
};

// the state of a step or part in a word, nothing for one still open
export function stateWord(s: State): string {
  const words: Partial<Record<State, string>> = {
    ok: tr('Passed'),
    failed: tr('Not passed'),
    skipped: tr('Skipped for now'),
    stale: tr('Has to be repeated'),
    running: tr('Running'),
    waiting: tr('Waiting for you'),
    locked: tr('Locked'),
  };
  return words[s] ?? '';
}

// the state as a round sign: tick, cross, arrow on, clock, lock; a ring while open, running or waiting
export function StateMark({state, big = false}: {state: State; big?: boolean}) {
  const sign = SIGNS[state];
  return (
    <span className={styles.mark} data-state={state} data-big={big || undefined} aria-hidden="true">
      {sign && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          {sign}
        </svg>
      )}
    </span>
  );
}
