'use client';

import {tr, useLang} from '@/lib/i18n';
import {useEffect} from 'react';
import styles from './error.module.css';

// A page that failed while it was drawn: the tabs stay, this says so instead of an empty page and can try again
export default function PageError({error, retry}: {error: Error & {digest?: string}; retry: () => void}) {
  useLang();
  useEffect(() => console.error(error), [error]);
  return (
    <main className={styles.main}>
      <section className={styles.card}>
        <h1>{tr('This page ran into an error.')}</h1>
        <p>{tr('The other tabs still work. If it happens again, the line below helps with a bug report.')}</p>
        <code>{error.message || String(error)}</code>
        <div className={styles.actions}>
          <button onClick={() => retry()}>{tr('Try again')}</button>
          <button onClick={() => window.location.reload()}>{tr('Reload the app')}</button>
        </div>
      </section>
    </main>
  );
}
