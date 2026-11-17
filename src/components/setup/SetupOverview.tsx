'use client';

import {tr} from '@/lib/i18n';
import {words, type Setup} from '@/lib/setup';
import {useState} from 'react';
import styles from './SetupOverview.module.css';

// The program as a whole: whether the lock of driving alone is open, how far it got, the stages, and the steps of the
// one open (the stage of the chosen step, else the first with something to do)
export function SetupOverview({setup, lang, selected, onSelect}: {setup: Setup; lang: string; selected: string | null; onSelect: (step: string) => void}) {
  const chosenStage = setup.steps.find((s) => s.id === selected)?.stage;
  const [open, setOpen] = useState<string | null>(null);
  const shown = open ?? chosenStage ?? setup.stage ?? setup.stages[0]?.id;
  const done = setup.steps.filter((s) => s.state === 'ok' || s.state === 'skipped').length;
  return (
    <section className={styles.overview} aria-label={tr('Setup')}>
      <p className={styles.safety} data-open={setup.safety.open}>
        {setup.safety.open ? tr('Safety measured on {date}', {date: setup.safety.date ?? ''}) : tr('No safety measurement yet: the mower drives only while you watch')}
      </p>
      <p className={styles.progress}>
        {setup.complete ? tr('Setup complete') : tr('{done} of {of} steps done', {done, of: setup.steps.length})}
      </p>
      <ol className={styles.stages}>
        {setup.stages.map((st) => (
          <li key={st.id} data-state={st.state}>
            <button type="button" className={styles.stage} aria-expanded={shown === st.id} onClick={() => setOpen(st.id)}>
              {words(st.texts, lang).name || st.id}
            </button>
            {shown === st.id && (
              <ol className={styles.steps}>
                {setup.steps
                  .filter((s) => s.stage === st.id)
                  .map((s) => (
                    <li key={s.id} data-state={s.state}>
                      <button type="button" className={styles.step} aria-current={s.id === selected || undefined} onClick={() => onSelect(s.id)}>
                        {words(s.texts, lang).name || s.id}
                      </button>
                    </li>
                  ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
