'use client';

import {tr} from '@/lib/i18n';
import {isApp} from '@/lib/native';
import {APP_VERSION, checkNow, dismissUpdate, isNewer, setUpdateCheck, useUpdates} from '@/lib/updates';
import Link from 'next/link';
import {useState} from 'react';
import styles from './Updates.module.css';

const UPDATE_COMMAND = 'docker compose pull && docker compose up -d';

// what's out of date: the android app itself, and the container on the mower
function useOutdated() {
  const u = useUpdates();
  const app = isApp();
  // in the browser the page comes from the container, so its version is the mower's
  const mower = u.mower ?? (app ? null : APP_VERSION);
  const latest = u.latest?.version;
  return {
    u,
    app,
    mower,
    appOld: !!latest && app && isNewer(latest, APP_VERSION),
    mowerOld: !!latest && !!mower && isNewer(latest, mower),
  };
}

// copies in plain http too, where navigator.clipboard isn't there
function copy(text: string) {
  if (navigator.clipboard) return void navigator.clipboard.writeText(text).catch(() => {});
  const t = document.createElement('textarea');
  t.value = text;
  document.body.appendChild(t);
  t.select();
  document.execCommand('copy');
  t.remove();
}

export function UpdateSettings({cardClass, checkClass}: {cardClass: string; checkClass: string}) {
  const {u, app, mower, appOld, mowerOld} = useOutdated();
  const [copied, setCopied] = useState(false);

  return (
    <section className={cardClass} id="updates">
      <h2>{tr('Updates')}</h2>
      <span className={styles.versions}>
        {app ? `${tr('App')} ${APP_VERSION} · ${tr('Mower')} ${mower ?? '?'}` : `MowBite ${APP_VERSION}`}
      </span>
      <label className={checkClass}>
        <input type="checkbox" checked={u.enabled} onChange={(e) => setUpdateCheck(e.target.checked)} />
        {tr('Look for updates once a day (asks GitHub, which sees your IP address)')}
      </label>
      <div className={styles.status}>
        <button className={styles.button} onClick={() => void checkNow()} disabled={u.checking}>
          {u.checking ? tr('checking…') : tr('Check now')}
        </button>
        <span className={styles.versions}>
          {u.failed
            ? tr("Couldn't reach GitHub.")
            : u.latest
              ? appOld || mowerOld
                ? ''
                : tr('Up to date, the newest release is {v}.', {v: u.latest.version})
              : ''}
        </span>
      </div>

      {u.latest && appOld && (
        <div className={styles.news}>
          <span>
            {tr('Version {v} of the app is out.', {v: u.latest.version})}{' '}
            <a href={u.latest.url} target="_blank" rel="noreferrer">
              {tr("What's new")}
            </a>
          </span>
          {u.latest.apk && (
            <div>
              <button className={[styles.button, styles.primary].join(' ')} // the app hands links to other sites to the phone's browser, which downloads the apk
                onClick={() => (window.location.href = u.latest!.apk!)}>
                {tr('Download and install')}
              </button>
            </div>
          )}
          <span className={styles.versions}>{tr('Android asks whether to install it, your settings stay.')}</span>
        </div>
      )}

      {u.latest && mowerOld && (
        <div className={styles.news}>
          <span>
            {tr('The mower runs MowBite {old}, {v} is out.', {old: mower ?? '', v: u.latest.version})}{' '}
            <a href={u.latest.url} target="_blank" rel="noreferrer">
              {tr("What's new")}
            </a>
          </span>
          <span className={styles.versions}>{tr('To update, run this on the mower in the mowbite folder:')}</span>
          <div className={styles.command}>
            <code>{UPDATE_COMMAND}</code>
            <button
              className={styles.button}
              onClick={() => {
                copy(UPDATE_COMMAND);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? tr('copied') : tr('Copy')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// on the dashboard, only when a check found something and it wasn't waved away
export function UpdateBanner() {
  const {u, appOld, mowerOld} = useOutdated();
  if (!u.latest || !(appOld || mowerOld) || u.dismissed === u.latest.version) return null;
  const v = u.latest.version;
  return (
    <div className={styles.banner}>
      <Link href="/settings#updates">{tr('MowBite {v} is out, see the settings', {v})}</Link>
      <button onClick={() => dismissUpdate(v)} aria-label="close">
        ×
      </button>
    </div>
  );
}
