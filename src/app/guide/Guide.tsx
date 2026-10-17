'use client';

import {dockIcon} from '@/components/mapIcons';
import {settingsStore} from '@/lib/settings';
import {tr, useLang} from '@/lib/i18n';
import {useRouter} from 'next/navigation';
import {useRef, useState, useSyncExternalStore} from 'react';
import type {ArtProps} from './art';
import styles from './page.module.css';

export interface GuideStep {
  title: string;
  text: string;
  Art: React.ComponentType<ArtProps>;
}

// a list with a picture each, under the last step
export interface GuideItem {
  key: string;
  icon: (dock: ArtProps['dock']) => React.ReactNode;
  title: string;
  text: string;
}

// the abstract markers of the map don't look like a station in a garden, those get a drawn one
const ABSTRACT = ['dot'];

// a guide page: a drawing, a few lines and next, step by step. done: where the last step leads
export default function Guide({steps, items, itemsTitle, done}: {steps: GuideStep[]; items?: GuideItem[]; itemsTitle?: string; done: {label: string; href: string}}) {
  useLang();
  const router = useRouter();
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const station = dockIcon(settings.icons?.dock);
  const dock = ABSTRACT.includes(station.key) ? dockIcon('yardforce') : station;
  const [step, setStep] = useState(0);
  const last = step === steps.length - 1;
  const {Art} = steps[step];

  const go = (to: number) => {
    if (to < 0) return window.history.length > 1 ? router.back() : router.push(done.href);
    if (to >= steps.length) return router.push(done.href);
    setStep(to);
    window.scrollTo({top: 0});
  };

  // a swipe on the drawing turns the page
  const swipe = useRef<{x: number; y: number} | null>(null);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.head}>
          <button className={styles.back} onClick={() => go(step - 1)} aria-label={tr('Back')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1>{tr(steps[step].title)}</h1>
        </header>

        <div
          className={styles.art}
          onPointerDown={(e) => (swipe.current = {x: e.clientX, y: e.clientY})}
          onPointerUp={(e) => {
            const s = swipe.current;
            swipe.current = null;
            if (!s) return;
            const dx = e.clientX - s.x;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(step + (dx < 0 ? 1 : -1));
          }}
        >
          <Art key={step} dock={dock} />
        </div>

        <div className={styles.progress}>
          <span>
            {step + 1}/{steps.length}
          </span>
          <div className={styles.dots} aria-hidden="true">
            {steps.map((_, i) => (
              <i key={i} className={i === step ? styles.on : undefined} />
            ))}
          </div>
        </div>

        <p className={styles.text}>{tr(steps[step].text)}</p>
        {last && items && (
          <section className={styles.legend}>
            {itemsTitle && <h2>{tr(itemsTitle)}</h2>}
            <ul>
              {items.map((l) => (
                <li key={l.key}>
                  {l.icon(dock)}
                  <div>
                    <strong>{tr(l.title)}</strong>
                    <span>{tr(l.text)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <button className={styles.next} onClick={() => go(step + 1)}>
          {last ? tr(done.label) : tr('Next')}
        </button>
      </main>
    </div>
  );
}
