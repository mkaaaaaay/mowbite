'use client';

import {reasonSentence} from '@/lib/events';
import {tr} from '@/lib/i18n';
import {OPEN_SCREENS, words, type Setup, type SetupStep as Step, type ShapePart} from '@/lib/setup';
import Link from 'next/link';
import {useState} from 'react';
import {ConfirmSheet} from './ConfirmSheet';
import {EmergencyBlock} from './EmergencyBlock';
import {RestartWait} from './RestartWait';
import {SkipSheet} from './SkipSheet';
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
  shape: ShapePart[] | null;
  sizes: Parameters<typeof StepFigure>[0]['sizes'];
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
  const done = step.state === 'ok' || step.state === 'skipped';
  const needs = step.state === 'locked' ? step.needs.filter((n) => setup.steps.find((s) => s.id === n)?.state !== 'ok') : [];
  const start = () => (step.confirm.length || step.motion ? setSheet('confirm') : act.start(step.id, []));
  const r = step.result;
  return (
    <section className={styles.step} data-state={step.state} data-step={step.id} aria-labelledby={`step-${step.id}`}>
      <p className={styles.where}>
        {tr('{stage} · step {n} of {of}', {stage: words(stage?.texts, lang).name || step.stage, n: own.indexOf(step) + 1, of: own.length})}
      </p>
      <h2 id={`step-${step.id}`}>{w.name || step.id}</h2>
      {emergency ? <EmergencyBlock /> : <StepFigure step={step} shape={props.shape} sizes={props.sizes} />}
      {step.restart && setup.restart_pending && <RestartWait />}
      {w.help && <p className={styles.help}>{w.help}</p>}
      <StepParts parts={step.parts} lang={lang} />
      <StepValues values={step.values} lang={lang} />
      {!running && step.inputs.length > 0 && step.state !== 'locked' && (
        <StepInputs inputs={step.inputs} lang={lang} busy={busy} onAnswer={(values) => act.answer(step.id, values)} />
      )}
      {running && step.inputs.some((i) => i.ask) && (
        <StepInputs inputs={step.inputs.filter((i) => i.ask)} lang={lang} busy={busy} onAnswer={(values) => act.answer(step.id, values)} />
      )}
      {r && !r.ok && r.reason && (
        <div className={styles.result} data-result="failed">
          <p>{reasonSentence(r.reason, 'SETUP_STEP')}</p>
          {w.fix && <p className={styles.fix}>{w.fix}</p>}
        </div>
      )}
      {r?.skip && (
        <p className={styles.result} data-result="skipped">
          {tr('Skipped: {why}', {why: words(step.skip_reasons.find((s) => s.id === r.skip)?.texts, lang).name || r.skip})}
          {r.note && ` (${r.note})`}
        </p>
      )}
      {needs.length > 0 && (
        <p className={styles.hint}>
          {tr('First: {steps}', {steps: needs.map((n) => words(setup.steps.find((s) => s.id === n)?.texts, lang).name || n).join(', ')})}
        </p>
      )}
      {others.map((b) => (
        <p key={b.reason} className={styles.hint} data-blocked={b.reason}>
          {reasonSentence(b.reason, 'SETUP_BLOCKED')}
        </p>
      ))}
      {props.error && (
        <p className={styles.error} role="alert">
          {props.error}
        </p>
      )}
      <div className={styles.buttons}>
        {step.open && !done && (
          <Link href={OPEN_SCREENS[step.open].href} className={styles.open}>
            {tr(OPEN_SCREENS[step.open].label)}
          </Link>
        )}
        {step.start && !running && step.state !== 'locked' && (
          <button type="button" disabled={busy} onClick={start}>
            {step.state === 'open' && !r ? tr('Start') : tr('Repeat')}
          </button>
        )}
        {running && (
          <button type="button" disabled={busy} onClick={() => act.abort(step.id)}>
            {tr('Stop')}
          </button>
        )}
        {step.skippable && !done && !running && (
          <button type="button" disabled={busy} onClick={() => setSheet('skip')}>
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
