'use client';

import {BackIcon} from '@/components/icons';
import {reasonSentence} from '@/lib/events';
import {tr} from '@/lib/i18n';
import {isDone, nameOf, OPEN_SCREENS, words, type Setup, type SetupStep as Step, type Sizes} from '@/lib/setup';
import Link from 'next/link';
import {useState} from 'react';
import {ConfirmSheet} from './ConfirmSheet';
import {EmergencyBlock} from './EmergencyBlock';
import {RestartWait} from './RestartWait';
import {SkipSheet} from './SkipSheet';
import {StateMark} from './StateMark';
import {StepFigure} from './StepFigure';
import {StepInputs} from './StepInputs';
import {StepParts} from './StepParts';
import {StepValues} from './StepValues';
import styles from './SetupStep.module.css';

export interface StepActions {
  start: (step: string, confirm: string[]) => void;
  answer: (step: string, values: Record<string, unknown>) => void;
  skip: (step: string, reason: string, note: string) => void;
  abort: (step: string) => void;
}

// One step: where it is in its stage, what to do, its parts and values, what keeps it from going on, and its buttons
export function SetupStep(props: {
  setup: Setup;
  step: Step;
  lang: string;
  sizes: Sizes | null;
  busy: boolean;
  error: string | null;
  act: StepActions;
}) {
  const {setup, step, lang, busy, act} = props;
  const [sheet, setSheet] = useState<'confirm' | 'skip' | null>(null);
  const w = words(step.texts, lang);
  const own = setup.steps.filter((s) => s.stage === step.stage);
  const stage = setup.stages.find((s) => s.id === step.stage);
  const emergency = step.blocked.some((b) => b.reason === 'EMERGENCY');
  const others = step.blocked.filter((b) => b.reason !== 'EMERGENCY');
  const running = step.state === 'running';
  const done = isDone(step.state);
  const needs = step.state === 'locked' ? step.needs.filter((n) => setup.steps.find((s) => s.id === n)?.state !== 'ok') : [];
  const start = () => (step.confirm.length || step.motion ? setSheet('confirm') : act.start(step.id, []));
  const r = step.result;
  const canStart = step.start && !running && step.state !== 'locked';
  const opens = step.open && !done ? OPEN_SCREENS[step.open] : null;
  return (
    <section className={styles.step} data-state={step.state} data-step={step.id} aria-labelledby={`step-${step.id}`}>
      <div className={styles.bar}>
        <Link href="/setup" className={styles.back} aria-label={tr('Overview')}>
          <BackIcon size={22} />
        </Link>
        <p className={styles.where}>
          <b>{stage ? nameOf(stage, lang) : step.stage}</b>
          <span>{tr('Step {n} of {of}', {n: own.indexOf(step) + 1, of: own.length})}</span>
        </p>
      </div>
      <div className={styles.body}>
        <div className={styles.visual}>
          {emergency ? <EmergencyBlock /> : <StepFigure step={step} sizes={props.sizes} />}
          {step.restart && setup.restart_pending && <RestartWait />}
        </div>
        <div className={styles.content} data-held={emergency || undefined}>
          <div className={styles.lead}>
            <h2 id={`step-${step.id}`}>{w.name || step.id}</h2>
            {w.help && <p>{w.help}</p>}
          </div>
          {r && !r.ok && r.reason && (
            <div className={styles.result} data-result="failed">
              <div className={styles.verdict}>
                <StateMark state="failed" big />
                <p>
                  <b>{tr('Not passed')}</b>
                  {r.attempt > 0 && <span>{tr('Attempt {n}', {n: r.attempt})}</span>}
                </p>
              </div>
              <p className={styles.reason}>{reasonSentence(r.reason, 'SETUP_STEP')}</p>
              {w.fix && (
                <div className={styles.fix}>
                  <h3>{tr('How to fix it')}</h3>
                  <p>{w.fix}</p>
                </div>
              )}
            </div>
          )}
          <StepParts parts={step.parts} lang={lang} />
          <StepValues values={step.values} lang={lang} />
          <StepInputs
            key={running ? 'ask' : 'all'}
            inputs={running ? step.inputs.filter((i) => i.ask) : step.state === 'locked' ? [] : step.inputs}
            lang={lang}
            busy={busy}
            onAnswer={(values) => act.answer(step.id, values)}
          />
          {r?.skip && (
            <p className={styles.note} data-result="skipped">
              {tr('Skipped: {why}', {why: nameOf(step.skip_reasons.find((s) => s.id === r.skip) ?? {id: r.skip, texts: {}}, lang)})}
              {r.note && ` (${r.note})`}
            </p>
          )}
          {needs.length > 0 && (
            <p className={styles.note}>
              {tr('First: {steps}', {steps: needs.map((n) => nameOf(setup.steps.find((s) => s.id === n) ?? {id: n, texts: {}}, lang)).join(', ')})}
            </p>
          )}
          {others.map((b) => (
            <p key={b.reason} className={styles.note} data-tone="warn" data-blocked={b.reason}>
              {reasonSentence(b.reason, 'SETUP_BLOCKED')}
            </p>
          ))}
          {props.error && (
            <p className={styles.note} data-tone="bad" role="alert">
              {props.error}
            </p>
          )}
        </div>
      </div>
      <div className={styles.dock}>
        {opens && (
          <Link href={opens.href} className={styles.button} data-primary={!canStart || undefined}>
            {tr(opens.label)}
          </Link>
        )}
        {canStart && (
          <button type="button" className={styles.button} data-primary disabled={busy} onClick={start}>
            {step.state === 'open' && !r ? tr('Start') : tr('Repeat')}
          </button>
        )}
        {running && (
          <button type="button" className={styles.button} disabled={busy} onClick={() => act.abort(step.id)}>
            {tr('Cancel')}
          </button>
        )}
        {step.skippable && !done && !running && (
          <button type="button" className={styles.button} disabled={busy} onClick={() => setSheet('skip')}>
            {tr('Skip')}
          </button>
        )}
      </div>
      {sheet === 'confirm' && (
        <ConfirmSheet
          step={step}
          lang={lang}
          busy={busy}
          onClose={() => setSheet(null)}
          onStart={(confirm) => {
            setSheet(null);
            act.start(step.id, confirm);
          }}
        />
      )}
      {sheet === 'skip' && (
        <SkipSheet
          step={step}
          lang={lang}
          busy={busy}
          onClose={() => setSheet(null)}
          onSkip={(reason, note) => {
            setSheet(null);
            act.skip(step.id, reason, note);
          }}
        />
      )}
    </section>
  );
}
