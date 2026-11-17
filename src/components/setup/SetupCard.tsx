'use client';

import {useSetup} from '@/hooks/useSetup';
import {tr, useLang} from '@/lib/i18n';
import {words} from '@/lib/setup';
import Link from 'next/link';

// on the dashboard while the setup program isn't complete: where it stands, and the way there
export function SetupCard({styles}: {styles: Record<string, string>}) {
  const lang = useLang();
  const setup = useSetup();
  if (!setup || setup.complete) return null;
  const done = setup.steps.filter((s) => s.state === 'ok' || s.state === 'skipped').length;
  const next = setup.steps.find((s) => s.id === setup.current);
  return (
    <section className={styles.card} data-card="setup">
      <h2>{tr('Setup')}</h2>
      <p className={styles.dim}>
        {tr('{done} of {of} steps done', {done, of: setup.steps.length})}
        {next && ` · ${tr('next: {step}', {step: words(next.texts, lang).name || next.id})}`}
      </p>
      <Link href={next ? `/setup?step=${encodeURIComponent(next.id)}` : '/setup'} className={styles.pillButton}>
        {tr('Go on with the setup')}
      </Link>
    </section>
  );
}
