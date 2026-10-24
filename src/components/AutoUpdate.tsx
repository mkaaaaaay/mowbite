'use client';

import {useEffect, useState} from 'react';
import {lastResult, loadUpdate, openMowerNews, requestUpdate, saveUpdateConf, updaterAlive, type Channel, type UpdateConf, type UpdateState} from '@/lib/autoUpdate';
import {tr} from '@/lib/i18n';
import {isDemo} from '@/lib/mowers';
import styles from './Updates.module.css';

const CHANNELS: [Channel, string][] = [
  ['off', 'Off'],
  ['beta', 'Beta'],
  ['stable', 'Stable'],
];

const when = (t: string | undefined) => (t ? new Date(Number(t) * 1000).toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : null);

// the updater on the mower (lib/autoUpdate): which MowBite it keeps, when, whether it looks at OpenMower, what it did
export function AutoUpdate({checkClass}: {checkClass: string}) {
  const [s, setS] = useState<UpdateState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isDemo()) return;
    let stop = false;
    const load = () =>
      loadUpdate().then(
        (x) => !stop && setS(x),
        () => !stop && setS(null),
      );
    void load();
    // while it's asked to update, what it does shows up
    const timer = setInterval(load, 10_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  if (isDemo() || s === undefined) return null;
  if (!updaterAlive(s))
    return (
      <p className={styles.versions}>
        {tr(
          'Automatic updates need the updater next to MowBite on the mower: the updater service in compose.yaml (see the README), then the channel and the time are set here.',
        )}
      </p>
    );

  const st = s!;
  const set = (patch: Partial<UpdateConf>) => {
    const conf = {...st.conf, ...patch};
    setS({...st, conf});
    setError(null);
    saveUpdateConf(conf).catch(() => setError(tr('Not saved, the mower did not answer.')));
  };
  const result = lastResult(st);
  const om = openMowerNews(st);

  return (
    <div className={styles.news}>
      <strong>{tr('Automatic updates')}</strong>
      <span className={styles.versions}>
        {tr('MowBite updates itself at night, only with the mower idle in the dock. If a new version doesn\'t start, it goes back to the one before, old images are cleared away.')}
      </span>
      <div className={styles.status} role="radiogroup" aria-label={tr('MowBite')}>
        <span className={styles.versions}>MowBite</span>
        {CHANNELS.map(([c, label]) => (
          <button
            key={c}
            role="radio"
            aria-checked={st.conf.mowbite === c}
            className={[styles.button, st.conf.mowbite === c ? styles.primary : ''].join(' ')}
            onClick={() => set({mowbite: c})}
          >
            {tr(label)}
          </button>
        ))}
      </div>
      {st.conf.mowbite === 'stable' && (
        <span className={styles.versions}>
          {tr('Stable is the newest release without "beta". It can be older than the beta that runs now, going there leaves out what came since.')}
        </span>
      )}
      <label className={styles.versions}>
        {tr('At')}{' '}
        <input type="time" value={st.conf.at} onChange={(e) => e.target.value && set({at: e.target.value})} />
      </label>
      <label className={checkClass}>
        <input type="checkbox" checked={st.conf.openmower === 'check'} onChange={(e) => set({openmower: e.target.checked ? 'check' : 'off'})} />
        {tr("Check whether there's a newer OpenMower image (only says so, OpenMower isn't changed)")}
      </label>
      {om && <span>{tr('A newer OpenMower image is out: {image}', {image: om})}</span>}
      <div className={styles.status}>
        <button
          className={styles.button}
          disabled={busy || st.requested}
          onClick={() => {
            setBusy(true);
            requestUpdate()
              .then(() => setS({...st, requested: true}))
              .catch(() => setError(tr('The mower did not answer.')))
              .finally(() => setBusy(false));
          }}
        >
          {st.requested ? tr('asked, within a minute…') : tr('Update now')}
        </button>
        <span className={styles.versions}>
          {result && `${result} `}
          {when(st.status.checked) && tr('Last checked {t}.', {t: when(st.status.checked)!})}
        </span>
      </div>
      {error && <span>{error}</span>}
      {st.log.length > 0 && (
        <details>
          <summary className={styles.versions}>{tr('Log')}</summary>
          <pre className={styles.versions}>{[...st.log].reverse().join('\n')}</pre>
        </details>
      )}
    </div>
  );
}
