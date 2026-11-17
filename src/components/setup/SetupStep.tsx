'use client';

import {BackIcon} from '@/components/icons';
import {reasonSentence} from '@/lib/events';
import {tr} from '@/lib/i18n';
import {
  isDone,
  keepStep,
  KEEP_MS,
  moves,
  releasesBlade,
  nameById,
  nameOf,
  OPEN_SCREENS,
  unmet,
  words,
  type Blocked,
  type Setup,
  type SetupStep as Step,
  type Sizes,
} from '@/lib/setup';
import Link from 'next/link';
import {Fragment, useEffect, useState} from 'react';
import {ConfirmSheet} from './ConfirmSheet';
import {EmergencyBlock} from './EmergencyBlock';
import {RestartWait} from './RestartWait';
import {SkipSheet} from './SkipSheet';
import {StateMark} from './StateMark';
import {StepFigure} from './StepFigure';
import {StepInputs} from './StepInputs';
import {StepLines} from './StepLines';
import {StepParts} from './StepParts';
import {StepValues} from './StepValues';
import styles from './SetupStep.module.css';

export interface StepActions {
  start: (step: string, confirm: string[]) => void;
  answer: (step: string, values: Record<string, unknown>) => void;
  skip: (step: string, reason: string, note: string) => void;
  abort: (step: string) => void;
}

// what keeps the step from going on, the steps it names linked, those of them skipped apart
function BlockedNote({b, steps, lang}: {b: Blocked; steps: Step[]; lang: string}) {
  const skipped = b.skipped ?? [];
  const due = (b.steps ?? []).filter((id) => !skipped.includes(id));
  const links = (label: string, ids: string[]) =>
    ids.length > 0 && (
      <span className={styles.links} data-list={label}>
        {tr(label)}{' '}
        {ids.map((id, i) => (
          <Fragment key={id}>
            {i > 0 && ', '}
            <Link href={`/setup?step=${encodeURIComponent(id)}`}>{nameById(steps, id, lang)}</Link>
          </Fragment>
        ))}
      </span>
    );
  return (
    <p className={styles.note} data-tone="warn" data-blocked={b.reason}>
      {reasonSentence(b.reason, 'SETUP_BLOCKED', b)}
      {links('Not passed yet:', due)}
      {links('Skipped:', skipped)}
    </p>
  );
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
  const restarting = step.restart && setup.restart_pending;
  const done = isDone(step.state);
  const needs = step.state === 'locked' ? unmet(step.needs, setup.steps) : [];
  // repeating a passed safety step while the lock is open: failing it closes the lock again
  const risky = !!step.safety && step.state === 'ok' && setup.safety.open;
  const start = () => (step.confirm.length || moves(step.motion) || risky ? setSheet('confirm') : act.start(step.id, []));
  const kept = running && moves(step.motion);
  useEffect(() => {
    if (!kept) return;
    // only while the page is seen: a phone put away or a closed tab lets the step end and the wheels stop
    const keep = () => document.visibilityState === 'visible' && keepStep(step.id).catch(() => {});
    keep();
    const timer = setInterval(keep, KEEP_MS);
    return () => clearInterval(timer);
  }, [kept, step.id]);
  const r = step.result;
  const releases = releasesBlade(step);
  const canStart = step.start && !running && step.state !== 'locked';
  const opens = step.open && !done ? OPEN_SCREENS[step.open] : null;
  const advanced = step.inputs.filter((i) => i.advanced);
  const plain = step.inputs.filter((i) => !i.advanced);
  const answer = (values: Record<string, unknown>) => act.answer(step.id, values);
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
          {restarting && <RestartWait />}
        </div>
        <div className={styles.content} data-held={emergency || undefined}>
          <div className={styles.lead}>
            <h2 id={`step-${step.id}`}>{w.name || step.id}</h2>
            {w.help && <p>{w.help}</p>}
          </div>
          {r && !r.ok && r.reason && (
            <div className={styles.result} data-result="failed">
              <div className={styles.verdict}>
                <StateMark state="failed" size="big" />
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
          {step.ask && (
            <p className={styles.note} data-asked-line={step.ask.line}>
              {tr(step.ask.active_high ? '{part}: seen on line {line}, it switches high' : '{part}: seen on line {line}, it switches low', {
                part: nameById(step.parts, step.ask.part, lang),
                line: step.ask.line,
              })}
            </p>
          )}
          <StepInputs
            key={running ? 'ask' : 'all'}
            inputs={running ? step.inputs.filter((i) => i.ask) : step.state === 'locked' ? [] : plain}
            lang={lang}
            busy={busy}
            onAnswer={answer}
          />
          <StepLines lines={step.lines} />
          {step.state === 'ok' && advanced.length > 0 && (
            <details className={styles.advanced}>
              <summary>{tr('Advanced')}</summary>
              <StepInputs key="advanced" inputs={advanced} lang={lang} busy={busy} onAnswer={answer} />
            </details>
          )}
          {r?.skip && (
            <p className={styles.note} data-result="skipped">
              {tr('Skipped: {why}', {why: nameById(step.skip_reasons, r.skip, lang)})}
              {r.note && ` (${r.note})`}
            </p>
          )}
          {releases && !setup.restart_pending && (
            <p className={styles.note} data-releases>
              {tr('At the first start the blade is released and MowBite OS restarts; then tap Start again.')}
            </p>
          )}
          {needs.length > 0 && (
            <p className={styles.note}>
              {tr('First: {steps}', {steps: needs.map((n) => nameById(setup.steps, n, lang)).join(', ')})}
            </p>
          )}
          {others.map((b) => (
            <BlockedNote key={b.reason} b={b} steps={setup.steps} lang={lang} />
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
        {running && !restarting && (
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
          steps={setup.steps}
          lang={lang}
          busy={busy}
          risky={risky}
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
