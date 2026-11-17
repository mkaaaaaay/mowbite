'use client';

import {useSetup} from '@/hooks/useSetup';
import {tr, useLang} from '@/lib/i18n';
import {isDone, nameOf, stepHref} from '@/lib/setup';
import Link from 'next/link';

// on the dashboard while the setup program isn't complete: where it stands, and the way there
export function SetupCard({styles}: {styles: Record<string, string>}) {
  const lang = useLang();
  const setup = useSetup();
  if (!setup || setup.complete) return null;
  const done = setup.steps.filter((s) => isDone(s.state)).length;
  const next = setup.steps.find((s) => s.id === setup.current);
  return (
    <section className={styles.card} data-card="setup">
      <h2>{tr('Setup')}</h2>
      <p className={styles.dim}>
        {tr('{done} of {of} steps done', {done, of: setup.steps.length})}
        {next && ` · ${tr('next: {step}', {step: nameOf(next, lang)})}`}
      </p>
      <Link href={next ? stepHref(next.id) : '/setup'} className={styles.pillButton}>
        {tr('Go on with the setup')}
      </Link>
    </section>
  );
}
