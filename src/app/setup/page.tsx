'use client';

import {GuideIcon} from '@/components/icons';
import {TitleMark} from '@/components/Logo';
import {TitleRow} from '@/components/TopWeather';
import {SetupOverview} from '@/components/setup/SetupOverview';
import {SetupStep, type StepActions} from '@/components/setup/SetupStep';
import {useRpcMethods} from '@/hooks/useRpcMethods';
import {useSetup} from '@/hooks/useSetup';
import {tick} from '@/lib/haptics';
import {tr, useLang} from '@/lib/i18n';
import {loadGeometry, type Geometry} from '@/lib/mowerBody';
import {RPC} from '@/lib/openmower';
import {RpcError} from '@/lib/rpc';
import {answerError} from '@/lib/rpcText';
import {abortStep, answerStep, loadSetup, skipStep, startStep, stepHref, type Setup} from '@/lib/setup';
import Link from 'next/link';
import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useRef, useState} from 'react';
import styles from './page.module.css';

// useSearchParams needs a suspense boundary in a static export
export default function SetupPage() {
  return (
    <Suspense>
      <SetupView />
    </Suspense>
  );
}

// a tick under the finger for every tick that comes, two for one that failed
function useTicks(setup: Setup | null | undefined) {
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!setup) return;
    const now = new Map<string, string>();
    for (const s of setup.steps) {
      now.set(s.id, s.state);
      for (const p of s.parts) now.set(`${s.id}/${p.id}`, p.state);
    }
    const before = seen.current;
    seen.current = now;
    if (!before) return;
    const changed = [...now].filter(([k, v]) => before.has(k) && before.get(k) !== v).map(([, v]) => v);
    if (changed.includes('failed')) {
      tick();
      setTimeout(tick, 150);
    } else if (changed.includes('ok')) tick();
  }, [setup]);
}

function SetupView() {
  const lang = useLang();
  const setup = useSetup();
  const methods = useRpcMethods();
  const router = useRouter();
  const selected = useSearchParams().get('step');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{step: string; text: string} | null>(null);
  const [sizes, setSizes] = useState<Geometry | null>(null);
  const hasGeometry = !!methods?.has(RPC.geometry);
  const version = setup?.version;
  useTicks(setup);
  // the sizes for the drawing of the mower, again after every change of a step (the dimensions step changes them)
  useEffect(() => {
    if (hasGeometry) loadGeometry().then(setSizes, () => {});
  }, [hasGeometry, version]);

  const call = (step: string, run: (s: Setup) => Promise<unknown>) => {
    if (!setup || busy) return;
    setBusy(true);
    setError(null);
    run(setup)
      .catch((e) => {
        setError({step, text: answerError(e)});
        // another state than the one shown: read it again
        if (e instanceof RpcError && e.data?.reason === 'VERSION') loadSetup().catch(() => {});
      })
      .finally(() => setBusy(false));
  };
  const act: StepActions = {
    start: (step, confirm) => call(step, (s) => startStep(s, step, confirm)),
    answer: (step, values) => call(step, (s) => answerStep(s, step, values)),
    skip: (step, reason, note) => call(step, (s) => skipStep(s, step, reason, note)),
    abort: (step) => call(step, () => abortStep(step)),
  };
  const step = setup?.steps.find((s) => s.id === selected) ?? null;
  const select = (id: string) => router.push(stepHref(id));

  return (
    <div className={styles.page}>
      <main className={styles.main} data-view={step ? 'step' : 'overview'}>
        <div className={styles.head}>
          <TitleRow>
            <h1>
              <TitleMark />
              {tr('Setup')}
            </h1>
          </TitleRow>
          {setup && <p className={styles.dim}>{tr('Check and set up step by step what the mower needs to mow. Every step can be repeated.')}</p>}
          {setup && (
            <Link href="/guide/setup" className={styles.link}>
              <GuideIcon size={16} />
              {tr('How the setup works')}
            </Link>
          )}
        </div>
        {setup === undefined ? (
          <p className={styles.dim}>{tr('connecting…')}</p>
        ) : setup === null ? (
          <p className={styles.dim}>{tr('This mower has no setup program.')}</p>
        ) : (
          <div className={styles.split}>
            <div className={styles.overview}>
              <SetupOverview setup={setup} lang={lang} selected={step?.id ?? null} onSelect={select} />
            </div>
            <div className={styles.step}>
              {step ? (
                <SetupStep
                  key={step.id}
                  setup={setup}
                  step={step}
                  lang={lang}
                  sizes={sizes}
                  busy={busy}
                  error={error?.step === step.id ? error.text : null}
                  act={act}
                />
              ) : (
                <p className={styles.dim}>{tr('Pick a step.')}</p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
