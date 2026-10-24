'use client';

import {useEffect, useState} from 'react';
import {
  loadUpdate,
  partResult,
  requestUpdate,
  runResult,
  saveUpdateConf,
  updaterAlive,
  WEEKDAYS,
  type UpdateConf,
  type UpdateState,
} from '@/lib/autoUpdate';
import {tr} from '@/lib/i18n';
import {usePlannerSettings} from '@/lib/mowerBody';
import {copyText} from '@/lib/clipboard';
import {apiBase, isDemo} from '@/lib/mowers';
import styles from './Updates.module.css';

// the updater's part of compose.yaml, as in the repository's
const UPDATER_YAML = `  updater:
    image: ghcr.io/mkaaaaaay/mowbite-updater:latest
    container_name: mowbite-updater
    restart: unless-stopped
    volumes:
      - settings:/data
      - /var/run/docker.sock:/var/run/docker.sock
      - /opt/stacks:/opt/stacks
      - /etc/localtime:/etc/localtime:ro
`;

// dockge on the mower the app talks to
function dockgeUrl(): string {
  const base = apiBase();
  const host = base ? new URL(base).hostname : window.location.hostname;
  return `http://${host}:5001`;
}

// how to add the updater, step by step, while it isn't there
function AddUpdater() {
  const [copied, setCopied] = useState(false);
  return (
    <details className={styles.news}>
      <summary>
        <strong>{tr('Automatic updates')}</strong> <span className={styles.versions}>{tr('not set up yet, how to:')}</span>
      </summary>
      <span className={styles.versions}>
        {tr('They need a second, small container next to MowBite, the updater. It\'s added once, then everything is set here.')}
      </span>
      <ol className={styles.versions}>
        <li>
          {tr('Open Dockge on the mower:')}{' '}
          <a href={dockgeUrl()} target="_blank" rel="noreferrer">
            {dockgeUrl()}
          </a>
        </li>
        <li>{tr('Pick the stack "mowbite" and tap "Edit".')}</li>
        <li>
          {tr(
            'In compose.yaml, at the very end there\'s "volumes:" with "settings:" under it. Paste the lines below just above that "volumes:" line, as they are: they start with two spaces, like "mowbite:" further up.',
          )}
        </li>
        <li>{tr('Tap "Save", then "Update" (or "Deploy").')}</li>
        <li>{tr('After about a minute the settings for automatic updates show up here.')}</li>
      </ol>
      <pre className={styles.versions}>{UPDATER_YAML}</pre>
      <div>
        <button
          className={styles.button}
          onClick={() => {
            copyText(UPDATER_YAML);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? tr('copied') : tr('Copy')}
        </button>
      </div>
      <span className={styles.versions}>
        {tr('If your stacks aren\'t in /opt/stacks (Dockge\'s folder), change both sides of the line "/opt/stacks:/opt/stacks" to yours.')}
      </span>
    </details>
  );
}

const when = (t: string | undefined) => (t ? new Date(Number(t) * 1000).toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : null);

// a row of choices, the one set marked
function Choices<T extends string>({label, value, options, onPick}: {label: string; value: T; options: [T, string, boolean?][]; onPick: (v: T) => void}) {
  return (
    <div className={styles.status} role="radiogroup" aria-label={label}>
      <span className={styles.versions}>{label}</span>
      {options.map(([v, text, disabled]) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          className={[styles.button, value === v ? styles.primary : ''].join(' ')}
          onClick={() => onPick(v)}
        >
          {tr(text)}
        </button>
      ))}
    </div>
  );
}

// the updater on the mower (lib/autoUpdate): the channel of each part, when, and what it did
export function AutoUpdate({checkClass}: {checkClass: string}) {
  const [s, setS] = useState<UpdateState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const planner = usePlannerSettings();

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
  if (!updaterAlive(s)) return <AddUpdater />;

  const st = s!;
  const set = (patch: Partial<UpdateConf>) => {
    const conf = {...st.conf, ...patch};
    setS({...st, conf});
    setError(null);
    saveUpdateConf(conf).catch(() => setError(tr('Not saved, the mower did not answer.')));
  };
  const days = st.conf.days === 'daily' ? [] : st.conf.days.split(',').map(Number);
  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    set({days: next.length && next.length < 7 ? next.join(',') : 'daily'});
  };
  const withPlanner = !!planner;
  const result = (part: 'mowbite' | 'openmower' | 'planner') => {
    const r = partResult(st, part);
    return r && <span className={styles.versions}>{r}</span>;
  };

  return (
    <div className={styles.news}>
      <strong>{tr('Automatic updates')}</strong>
      <span className={styles.versions}>
        {tr(
          "Only with the mower idle in the dock. If a new version doesn't start, it goes back to the one before. Afterwards old images and the build cache are cleared away.",
        )}
      </span>

      <Choices
        label="MowBite"
        value={st.conf.mowbite}
        options={[
          ['off', 'Off'],
          ['beta', 'Beta'],
          ['stable', 'Stable'],
        ]}
        onPick={(v) => set({mowbite: v})}
      />
      {st.conf.mowbite === 'stable' && (
        <span className={styles.versions}>
          {tr('Stable is the newest release without "beta". It can be older than the beta that runs now, going there leaves out what came since.')}
        </span>
      )}
      {result('mowbite')}

      <Choices
        label="OpenMower"
        value={st.conf.openmower}
        options={[
          ['off', 'Off'],
          ['check', 'Only tell'],
          ['edge', 'edge'],
          ['release', 'release', withPlanner],
        ]}
        onPick={(v) => set({openmower: v})}
      />
      <span className={styles.versions}>
        {withPlanner
          ? tr('With the MowBite Planner OpenMower stays on edge, the planner needs it. ')
          : ''}
        {tr("Only when there's room for the old and the new image at once, the planner is built again on the new one right after.")}
      </span>
      {result('openmower')}

      {withPlanner && (
        <>
          <Choices
            label={tr('Planner')}
            value={st.conf.planner}
            options={[
              ['off', 'Off'],
              ['main', 'Newest'],
            ]}
            onPick={(v) => set({planner: v})}
          />
          <span className={styles.versions}>{tr('Built again on the mower from GitHub when there is something new. A planner built from a local copy is left as it is.')}</span>
          {result('planner')}
        </>
      )}

      <div className={styles.status}>
        <label className={styles.versions}>
          {tr('At')} <input type="time" value={st.conf.at} onChange={(e) => e.target.value && set({at: e.target.value})} />
        </label>
        <label className={checkClass}>
          <input type="checkbox" checked={st.conf.days === 'daily'} onChange={(e) => set({days: e.target.checked ? 'daily' : '7'})} />
          {tr('every night')}
        </label>
      </div>
      {st.conf.days !== 'daily' && (
        <div className={styles.status} role="group" aria-label={tr('Days')}>
          {WEEKDAYS.map((d, i) => (
            <button
              key={d}
              aria-pressed={days.includes(i + 1)}
              className={[styles.button, days.includes(i + 1) ? styles.primary : ''].join(' ')}
              onClick={() => toggleDay(i + 1)}
            >
              {tr(d)}
            </button>
          ))}
        </div>
      )}

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
        <span className={styles.versions}>{when(st.status.checked) && tr('Last checked {t}.', {t: when(st.status.checked)!})}</span>
      </div>
      {runResult(st) && <span className={styles.versions}>{runResult(st)}</span>}
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
