'use client';

import {ChevronIcon, line} from '@/components/icons';
import {reasonSentence} from '@/lib/events';
import {tr} from '@/lib/i18n';
import {isDone, nameById, nameOf, unmet, type Setup, type SetupStep, type StepState} from '@/lib/setup';
import Link from 'next/link';
import {useState} from 'react';
import {StateMark, stateWord} from './StateMark';
import styles from './SetupOverview.module.css';

const LockIcon = ({open}: {open: boolean}) => (
  <svg viewBox="0 0 24 24" {...line} aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d={open ? 'M8 11V7a4 4 0 0 1 7.5-2' : 'M8 11V7a4 4 0 0 1 8 0v4'} />
  </svg>
);

// the line under a stage: what keeps it locked, how far it got, or its state
function stageLine(state: StepState, steps: SetupStep[], all: SetupStep[], lang: string): string {
  if (state === 'locked') {
    const needs = unmet([...new Set(steps.flatMap((s) => s.needs))], all).filter((n) => !steps.some((s) => s.id === n));
    if (needs.length) return tr('First: {steps}', {steps: needs.map((n) => nameById(all, n, lang)).join(', ')});
  }
  if (state === 'open' || state === 'running') {
    const done = steps.filter((s) => isDone(s.state)).length;
    return done ? tr('{done} of {of} done', {done, of: steps.length}) : tr('{n} steps', {n: steps.length});
  }
  return stateWord(state);
}

// The program as a whole: whether the lock of driving alone is open, how far it got, the stages, and the steps of the
// one open (the stage of the chosen step, else the first with something to do)
export function SetupOverview({setup, lang, selected, onSelect}: {setup: Setup; lang: string; selected: string | null; onSelect: (step: string) => void}) {
  const chosenStage = setup.steps.find((s) => s.id === selected)?.stage;
  const [open, setOpen] = useState<string | null>(null);
  const shown = open ?? chosenStage ?? setup.stage ?? setup.stages[0]?.id;
  const done = setup.steps.filter((s) => isDone(s.state)).length;
  const skipped = setup.steps.filter((s) => s.state === 'skipped').length;
  const next = setup.steps.find((s) => s.id === setup.current);
  const {safety} = setup;
  return (
    <section className={styles.overview} aria-label={tr('Setup')}>
      <p className={styles.lock} data-open={safety.open}>
        <LockIcon open={safety.open} />
        {safety.open ? (
          <span>
            <b>{tr('Safety measured')}</b>
            {safety.date && <span>{tr('Safety measured on {date}', {date: safety.date})}</span>}
          </span>
        ) : (
          <span>
            <b>{tr('Safety measurement missing')}</b>
            <span>{safety.why ? reasonSentence(safety.why, 'SETUP') : tr('No safety measurement yet: the mower drives only while you watch')}</span>
          </span>
        )}
      </p>
      <div className={styles.card}>
        <div className={styles.progress}>
          <p className={styles.count}>
            <b>{setup.complete ? tr('Setup complete') : tr('{done} of {of} steps done', {done, of: setup.steps.length})}</b>
            {skipped > 0 && <span>{tr('{n} skipped', {n: skipped})}</span>}
          </p>
          <div className={styles.segments} style={{gridTemplateColumns: `repeat(${setup.steps.length}, minmax(0, 1fr))`}} aria-hidden="true">
            {setup.steps.map((s) => (
              <i key={s.id} data-state={s.state} />
            ))}
          </div>
        </div>
        {next && next.id !== selected && (
          <Link href={`/setup?step=${encodeURIComponent(next.id)}`} className={styles.next} data-primary>
            {tr('Go on: {step}', {step: nameOf(next, lang)})}
          </Link>
        )}
        <ol className={styles.stages}>
          {setup.stages.map((st) => {
            const steps = setup.steps.filter((s) => s.stage === st.id);
            const isShown = shown === st.id;
            return (
              <li key={st.id} data-state={st.state}>
                <button type="button" className={styles.stage} aria-expanded={isShown} onClick={() => setOpen(isShown ? '' : st.id)}>
                  <StateMark state={st.state} />
                  <span className={styles.text}>
                    <b>{nameOf(st, lang)}</b>
                    <span>{stageLine(st.state, steps, setup.steps, lang)}</span>
                  </span>
                  <ChevronIcon size={16} />
                </button>
                {isShown && (
                  <ol className={styles.steps}>
                    {steps.map((s) => (
                      <li key={s.id} data-state={s.state}>
                        <button type="button" className={styles.step} aria-current={s.id === selected || undefined} onClick={() => onSelect(s.id)}>
                          <StateMark state={s.state} size="small" />
                          <span className={styles.name}>{nameOf(s, lang)}</span>
                          <span className={styles.note}>
                            {s.state === 'running' && s.progress ? tr('{n} of {m}', {n: s.progress.n, m: s.progress.of}) : stateWord(s.state)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
