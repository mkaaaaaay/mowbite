'use client';

import {tr, useLang} from '@/lib/i18n';
import {apiBase} from '@/lib/mowers';
import {addPush, removePush, saveNotify, testPush, type NotifyConfig} from '@/lib/notify';
import {NTFY, pushPlugin, rememberEndpoint, waitForEndpoint, withPush, type PushChannel, type PushStatus} from '@/lib/push';
import {containerHas, useUpdates} from '@/lib/updates';
import {useCallback, useEffect, useState} from 'react';
import local from './NotifySettings.module.css';
import {UpdateCommand, versionNote} from './Updates';

// In the Android app: this mower's messages on this phone as MowBite's own (lib/push.ts), with its icon, sorted into
// problems, reminders and info, a tap opens the page. Delivered by a UnifiedPush app in the background (e.g. ntfy). What
// is told, when and how often are the settings around it, the same as for the topic. Needs a container that takes the
// phones' addresses, an older one took them for its settings

type Styles = Record<string, string>;

const CHANNELS: {key: PushChannel; label: string}[] = [
  {key: 'problems', label: 'Problems'},
  {key: 'reminders', label: 'Reminders'},
  {key: 'info', label: 'Info'},
];

// why signing up didn't work, as the connector says it
const failure = (reason: string) =>
  reason === 'timeout'
    ? tr("The delivering app didn't answer. Open it once, then try again.")
    : reason === 'NETWORK'
      ? tr("The delivering app couldn't reach its server. Is the phone online?")
      : reason === 'ACTION_REQUIRED'
        ? tr('The delivering app wants something done first, open it.')
        : tr('Signing up with the delivering app failed ({why}).', {why: reason});

export function PhonePushSettings({
  saved,
  reload,
  styles,
}: {
  saved: NotifyConfig;
  // the mower's settings asked for again, with the phones signed up
  reload: () => Promise<unknown>;
  styles: Styles;
}) {
  useLang();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [state, setState] = useState<{busy?: boolean; error?: string; done?: string}>({});
  const u = useUpdates();

  const refresh = useCallback(() => {
    void withPush((p) => p.status())
      ?.then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    refresh();
    // back from the store or from Android's settings: what changed there
    const back = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [refresh]);

  const head = (
    <>
      <h3 className={local.sub}>{tr('On this phone, as MowBite messages')}</h3>
      <p className={styles.dim}>{tr("With MowBite's icon, sorted into problems, reminders and info, a tap opens MowBite. Away from home too.")}</p>
    </>
  );
  if (u.level === null) return null;
  if (!containerHas(u.level, 'phones')) {
    return (
      <>
        {head}
        <div className={local.info}>
          <span>{tr('MowBite on the mower{old} is too old for this, it needs an update first.', {old: versionNote(u.mower)})}</span>
          <UpdateCommand />
        </div>
      </>
    );
  }
  if (!status) return null;

  const api = apiBase();
  const on = !!status.endpoint && saved.pushes.includes(status.endpoint);
  const list = status.distributors;
  const chosen = pick ?? status.distributor ?? (list.length === 1 ? list[0].id : null);
  const chosenName = list.find((d) => d.id === (status.distributor ?? chosen))?.name;

  const enable = async () => {
    setState({busy: true});
    try {
      const {native: p} = (await pushPlugin())!;
      let permission = status.permission;
      if (permission !== 'granted') permission = (await p.requestNotifications()).permission;
      if (permission !== 'granted') {
        refresh();
        return setState({error: tr("Notifications are off for MowBite. Allow them in Android's settings, then switch this on again.")});
      }
      if (!chosen) return setState({error: tr('Pick the app that delivers them.')});
      await p.register({distributor: chosen});
      const endpoint = await waitForEndpoint(p);
      // never saved on the mower, it would tell about nothing: the settings as they are shown, the problems
      if (!saved.stored) await saveNotify(saved);
      await addPush(endpoint);
      rememberEndpoint(api, endpoint);
      await reload();
      refresh();
      setState({done: tr('Signed up. Send a test to see it arrives.')});
    } catch (e) {
      refresh();
      const why = e instanceof Error ? e.message : String(e);
      setState({error: /^(timeout|NETWORK|ACTION_REQUIRED|INTERNAL_ERROR|VAPID_REQUIRED)$/.test(why) ? failure(why) : tr('The mower did not answer.')});
    }
  };

  const disable = async () => {
    if (!status.endpoint) return;
    setState({busy: true});
    try {
      await removePush(status.endpoint);
      rememberEndpoint(api, null);
      await reload();
      setState({done: tr("Signed off. This mower doesn't send to this phone any more.")});
    } catch {
      setState({error: tr('The mower did not answer.')});
    }
  };

  const test = async () => {
    if (!status.endpoint) return;
    setState({busy: true});
    try {
      const r = await testPush(status.endpoint);
      setState(
        r === 'sent'
          ? {done: tr('Sent. It should be on the phone in a moment.')}
          : r === 'failed'
            ? {error: tr("The mower couldn't reach the delivering server. Does the mower get on the internet?")}
            : {error: tr('This phone is no longer signed up with the mower. Switch it off and on again.')},
      );
    } catch {
      setState({error: tr('The mower did not answer.')});
    }
  };

  return (
    <>
      {head}
      <p className={local.info}>
        {tr(
          'All it takes is the ntfy app on this phone: install it once, no need to open it or subscribe to anything. It delivers the messages in the background. Then switch them on here.',
        )}
      </p>
      {list.length === 0 ? (
        <>
          <p className={styles.dim}>{tr('There is no such app on this phone yet.')}</p>
          <div className={local.actions}>
            <button className={styles.pillButton} onClick={() => void withPush((p) => p.openStore({id: NTFY}))}>
              {tr('Get ntfy')}
            </button>
          </div>
        </>
      ) : (
        <>
          {list.length > 1 && !on && (
            <div className={styles.segment}>
              {list.map((d) => (
                <button key={d.id} className={chosen === d.id ? styles.segmentOn : undefined} onClick={() => setPick(d.id)}>
                  {d.name}
                </button>
              ))}
            </div>
          )}
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={on}
              disabled={state.busy || (!on && !saved.enabled)}
              onChange={(e) => void (e.target.checked ? enable() : disable())}
            />
            {tr('Messages from this mower on this phone')}
          </label>
          {!saved.enabled && <p className={styles.dim}>{tr('Push messages are switched off above.')}</p>}
          {on && chosenName && <p className={styles.dim}>{tr('Delivered by {app}.', {app: chosenName})}</p>}
          {/* ntfy shows a lasting notification while it waits for messages, android wants one for that */}
          {on && (status.distributor ?? chosen) === NTFY && (
            <p className={styles.dim}>
              {tr(
                "ntfy keeps a notification 'Listening for incoming notifications' up for it. To hide it, press and hold it and switch off only its category 'Background service', the messages still come.",
              )}
            </p>
          )}
          {status.permission === 'denied' && (
            <p className={styles.error}>
              {tr("Notifications are off for MowBite in Android's settings.")}{' '}
              <button className={styles.pillButton} onClick={() => void withPush((p) => p.openSettings({}))}>
                {tr("Android's settings")}
              </button>
            </p>
          )}
          {on && (
            <>
              <div className={local.actions}>
                <button className={styles.pillButton} onClick={test} disabled={state.busy}>
                  {tr('Send a test to this phone')}
                </button>
              </div>
              <h3 className={local.sub}>{tr('Sound and importance')}</h3>
              <p className={styles.dim}>
                {tr('Set in Android for each kind: sound, vibration, popping up, do not disturb. To begin with problems and reminders ring and vibrate, info stays silent.')}
              </p>
              <div className={local.actions}>
                {CHANNELS.map((c) => (
                  <button key={c.key} className={styles.pillButton} onClick={() => void withPush((p) => p.openSettings({channel: c.key}))}>
                    {tr(c.label)}
                  </button>
                ))}
              </div>
              {saved.topic && (
                <p className={styles.dim}>
                  {tr('Is the topic subscribed in the ntfy app on this phone as well? Then every message comes twice, unsubscribe it there.')}
                </p>
              )}
            </>
          )}
        </>
      )}
      {state.done && <p className={styles.dim}>{state.done}</p>}
      {state.error && <p className={styles.error}>{state.error}</p>}
    </>
  );
}
