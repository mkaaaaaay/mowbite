'use client';

import {ChevronIcon} from '@/components/icons';
import {useSetup} from '@/hooks/useSetup';
import {tr, useLang} from '@/lib/i18n';
import {isDone, nameOf, stepHref} from '@/lib/setup';
import Link from 'next/link';
import styles from './SetupCard.module.css';

// on the dashboard while the setup program isn't complete: where it stands, and the way there
export function SetupCard() {
  const lang = useLang();
  const setup = useSetup();
  if (!setup || setup.complete) return null;
  const done = setup.steps.filter((s) => isDone(s.state)).length;
  const next = setup.steps.find((s) => s.id === setup.current);
  return (
    <section className={styles.card} data-card="setup">
      <div className={styles.head}>
        <h2>{tr('Setup')}</h2>
        <span>{tr('{done} of {of} steps done', {done, of: setup.steps.length})}</span>
      </div>
      <div className={styles.bar} aria-hidden="true">
        <i style={{width: `${(done / setup.steps.length) * 100}%`}} />
      </div>
      {next && <p>{tr('next: {step}', {step: nameOf(next, lang)})}</p>}
      <Link href={next ? stepHref(next.id) : '/setup'} className={styles.pillButton}>
        {tr('Go on with the setup')}
        <ChevronIcon size={18} />
      </Link>
    </section>
  );
}
