'use client';

import {tr} from '@/lib/i18n';
import {answerError} from '@/lib/rpcText';
import {rereadOnVersion, resetSetup, type Setup} from '@/lib/setup';
import {useState} from 'react';
import {Sheet} from './Sheet';
import sheet from './Sheet.module.css';
import step from './SetupStep.module.css';
import styles from './SetupOverview.module.css';

// the whole setup from the start: every result goes back and the lock of the safety closes, asked before
export function SetupReset({setup}: {setup: Setup}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!setup.steps.some((s) => s.state !== 'open' && s.state !== 'locked')) return null;
  const reset = () => {
    setAsking(false);
    setBusy(true);
    setError(null);
    resetSetup(setup)
      .catch((e) => {
        setError(answerError(e));
        rereadOnVersion(e);
      })
      .finally(() => setBusy(false));
  };
  return (
    <>
      <button type="button" className={styles.reset} disabled={busy} onClick={() => setAsking(true)}>
        {tr('Start the setup over')}
      </button>
      {error && (
        <p className={step.note} data-tone="bad" role="alert">
          {error}
        </p>
      )}
      {asking && (
        <Sheet title={tr('Start the setup over?')} onClose={() => setAsking(false)}>
          <p className={sheet.warn}>
            {tr('Everything checked in the setup so far is taken back. The mower drives only while you watch until its safety is measured again.')}
          </p>
          <p className={sheet.limit}>{tr('All steps are open again.')}</p>
          <div className={sheet.buttons}>
            <button type="button" className={sheet.button} onClick={() => setAsking(false)}>
              {tr('Cancel')}
            </button>
            <button type="button" className={sheet.button} data-primary onClick={reset}>
              {tr('Start over')}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
