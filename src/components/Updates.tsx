'use client';

import {copyText} from '@/lib/clipboard';
import {tr} from '@/lib/i18n';
import {isDemo} from '@/lib/mowers';
import {isApp} from '@/lib/native';
import {
  APP_VERSION,
  FROM_STORE,
  behindKey,
  checkNow,
  compareVersions,
  dismissBehind,
  dismissUpdate,
  isNewer,
  missingOnMower,
  setBehindNote,
  setUpdateCheck,
  useUpdates,
} from '@/lib/updates';
import Link from 'next/link';
import {useEffect, useState, useSyncExternalStore} from 'react';
import {useMowerActions} from '@/hooks/useMowerActions';
import {ACTION, RPC} from '@/lib/openmower';
import {rpcMethods} from '@/lib/rpc';
import styles from './Updates.module.css';
import {DockgeUpdateGuide} from './AutoUpdate';
import {CreditsTrigger} from './Credits';

// the newest version, then the old image goes (and any other no container uses and no name points to)
const UPDATE_COMMAND = 'docker compose pull && docker compose up -d && docker image prune -f';
const PRIVACY_URL = 'https://github.com/mkaaaaaay/mowbite/blob/main/PRIVACY.md';
const LICENSE_URL = 'https://github.com/mkaaaaaay/mowbite#license';

const noop = () => () => {};

// what's out of date: the android app itself, and the container on the mower
function useOutdated() {
  const u = useUpdates();
  // (as the page was built ahead first, else the page put together in the app doesn't match it)
  const app = useSyncExternalStore(noop, isApp, () => false);
  // in the browser the page comes from the container, so its version is the mower's
  const mower = u.mower ?? (app ? null : APP_VERSION);
  const latest = u.latest?.version;
  // in the browser the page comes from the container, it has what it needs
  const missing = app && !isDemo() ? missingOnMower(u.level) : [];
  return {
    u,
    app,
    mower,
    missing,
    appOld: !FROM_STORE && !!latest && app && isNewer(latest, APP_VERSION),
    // from the Play Store the store brings it, nothing to download here
    storeOld: FROM_STORE && !!latest && app && isNewer(latest, APP_VERSION),
    // the demo has no container to update
    mowerOld: !isDemo() && !!latest && !!mower && isNewer(latest, mower),
  };
}

// what the app leaves out because the mower's OpenMower doesn't have it yet. only when the mower can tell
// (rpc.methods) and its actions arrived, things only some forks have aren't mentioned
function NewerOpenMower() {
  const {knowsAction} = useMowerActions();
  const [methods, setMethods] = useState<Set<string> | null>(null);
  useEffect(() => {
    void rpcMethods().then(setMethods);
  }, []);
  if (!methods || !knowsAction(ACTION.resetEmergency)) return null;
  const missing = [
    ...(methods.has(RPC.areaPlan)
      ? []
      : ['progress and time left while mowing', 'the mowing plan from the mower in the map editor', "areas set to don't mow"]),
    ...(methods.has(RPC.logs) ? [] : ['the ROS log next to problems']),
    ...(knowsAction(ACTION.resetJob) ? [] : ['dropping an interrupted job']),
  ];
  if (!missing.length) return null;
  return <p className={styles.versions}>{tr('A newer OpenMower on the mower also brings: {list}.', {list: missing.map((m) => tr(m)).join(', ')})}</p>;
}

// a command to run on the mower, with a button that copies it
export function CopyCommand({command}: {command: string}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.command}>
      <code>{command}</code>
      <button
        className={styles.button}
        onClick={() => {
          copyText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? tr('copied') : tr('Copy')}
      </button>
    </div>
  );
}

// how MowBite on the mower gets the newest version: in dockge, or the command for a terminal
export function UpdateCommand() {
  return (
    <>
      <DockgeUpdateGuide />
      <details>
        <summary className={styles.versions}>{tr('Or in a terminal on the mower, in the mowbite folder:')}</summary>
        <CopyCommand command={UPDATE_COMMAND} />
      </details>
    </>
  );
}

// the version after a name, when the mower told it (one from before doesn't)
export const versionNote = (v: string | null) => (v ? ` (${v})` : '');

// the app is newer than MowBite on the mower, and some of it needs that one newer too
const behindText = (mower: string | null, missing: string[]) =>
  tr("MowBite on the mower{old} is older than this app. Until it's updated, this doesn't work yet: {list}.", {
    old: versionNote(mower),
    list: missing.map((m) => tr(m)).join(', '),
  });

export function UpdateSettings({cardClass, checkClass}: {cardClass: string; checkClass: string}) {
  const {u, app, mower, missing, appOld, mowerOld, storeOld} = useOutdated();

  return (
    <section className={cardClass} id="updates">
      <h2>{tr('This app')}</h2>
      <CreditsTrigger className={styles.versions}>
        {app ? `${tr('App')} ${APP_VERSION} · ${tr('Mower')} ${mower ?? (u.level === 0 ? tr('older version') : '?')}` : `MowBite ${APP_VERSION}`}
      </CreditsTrigger>
      <NewerOpenMower />
      <label className={checkClass}>
        <input type="checkbox" checked={u.enabled} onChange={(e) => setUpdateCheck(e.target.checked)} />
        {tr('Look for updates once a day (asks GitHub, which sees your IP address)')}
      </label>
      {app && (
        <label className={checkClass}>
          <input type="checkbox" checked={!u.behindNever} onChange={(e) => setBehindNote(e.target.checked)} />
          {tr('A note on the dashboard when MowBite on the mower is too old for something in the app')}
        </label>
      )}
      <div className={styles.status}>
        <button className={[styles.button, styles.even].join(' ')} onClick={() => void checkNow()} disabled={u.checking}>
          {u.checking ? tr('checking…') : tr('Check now')}
        </button>
        <span className={styles.versions}>
          {u.failed
            ? tr("Couldn't reach GitHub.")
            : u.latest
              ? appOld || mowerOld
                ? ''
                : storeOld
                  ? tr('Version {v} is out, the app gets it from the Play Store.', {v: u.latest.version})
                  : compareVersions(APP_VERSION, u.latest.version) > 0
                  ? tr("You're on a pre-release, the newest published one is {v}.", {v: u.latest.version})
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

      {((u.latest && mowerOld) || missing.length > 0) && (
        <div className={styles.news}>
          {u.latest && mowerOld && (
            <span>
              {tr('The mower runs MowBite {old}, {v} is out.', {old: mower ?? '', v: u.latest.version})}{' '}
              <a href={u.latest.url} target="_blank" rel="noreferrer">
                {tr("What's new")}
              </a>
            </span>
          )}
          {missing.length > 0 && <span>{behindText(mower, missing)}</span>}
          <UpdateCommand />
        </div>
      )}
    </section>
  );
}

// on the dashboard, when MowBite on the mower is too old for some of the app or a check found something, and it wasn't
// waved away
export function UpdateBanner() {
  const {u, mower, missing, appOld, mowerOld} = useOutdated();
  if (missing.length > 0 && !u.behindNever && u.behindDismissed !== behindKey(mower)) {
    return (
      <div className={[styles.banner, styles.behind].join(' ')}>
        <div>
          <span>{behindText(mower, missing)}</span>
          <UpdateCommand />
          <label className={styles.never}>
            <input type="checkbox" onChange={(e) => e.target.checked && setBehindNote(false)} />
            {tr("Don't show again")}
          </label>
        </div>
        <button onClick={() => dismissBehind(behindKey(mower))} aria-label="close">
          ×
        </button>
      </div>
    );
  }
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

// privacy and license, small at the foot of the settings
export function LegalFooter({className}: {className?: string}) {
  return (
    <footer className={[styles.versions, styles.legal, className].join(' ')}>
      <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
        {tr('Privacy policy')}
      </a>
      <span>
        © 2026 mkay · {tr('Free software under the GPL-3.0: you may pass it on and change it under its terms. It comes without any warranty.')}{' '}
        <a href={LICENSE_URL} target="_blank" rel="noreferrer">
          {tr('License and source code')}
        </a>
      </span>
    </footer>
  );
}
