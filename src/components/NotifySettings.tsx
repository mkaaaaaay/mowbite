'use client';

import {clock} from '@/lib/dates';
import {tr, useLang} from '@/lib/i18n';
import {apiBase} from '@/lib/mowers';
import {isApp} from '@/lib/native';
import {
  defaultNotify,
  loadNotify,
  NOTIFY_EVENTS,
  notifyLog,
  randomTopic,
  saveNotify,
  snoozeNotify,
  testNotify,
  validServer,
  validTopic,
  type NotifyConfig,
  type NotifyEvent,
  type NotifyLog,
} from '@/lib/notify';
import type {Settings} from '@/lib/settings';
import {useEffect, useState} from 'react';
import local from './NotifySettings.module.css';

// Push messages on the phone when the mower needs someone, sent by the container on the mower through ntfy, also when
// no app is open and away from home. Kept on the mower for every device.

type Styles = Record<string, string>;

const REMIND = [0, 15, 30, 60];
const EMERGENCY_WAIT = [0, 10, 30, 60];

export function NotifySettings({settings, styles}: {settings: Settings; styles: Styles}) {
  const lang = useLang();
  // undefined while asking, null without the container
  const [form, setForm] = useState<NotifyConfig | null | undefined>(undefined);
  const [saved, setSaved] = useState<NotifyConfig | null>(null);
  const [state, setState] = useState<{busy?: boolean; error?: string; done?: string}>({});
  const [log, setLog] = useState<NotifyLog[]>([]);
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    // where MowBite is for this device, the message's button opens it there
    const url = isApp() ? apiBase() : window.location.origin;
    const fallback = defaultNotify(lang, url, settings.thisName ?? '');
    void loadNotify(fallback).then((c) => {
      setForm(c);
      setSaved(c);
    });
    void notifyLog().then(setLog);
    // the snooze runs out while the page is open
    const timer = setInterval(() => setNow(Date.now() / 1000), 30000);
    return () => clearInterval(timer);
    // the defaults only matter until the mower answers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (form === undefined) return null;
  if (form === null) {
    return (
      <section className={styles.card}>
        <h2>{tr('Push messages')}</h2>
        <p className={styles.dim}>
          {tr('Only with the MowBite container on the mower: it watches the mower and sends the messages, also when no app is open.')}
        </p>
      </section>
    );
  }

  const set = (patch: Partial<NotifyConfig>) => {
    setForm({...form, ...patch});
    setState({});
  };
  const toggle = (e: NotifyEvent) =>
    set({events: form.events.includes(e) ? form.events.filter((x) => x !== e) : [...form.events, e]});

  const save = async () => {
    if (form.topic && !validTopic(form.topic.trim())) return setState({error: tr('The topic may only hold letters, digits, - and _.')});
    if (!validServer(form.server)) return setState({error: tr('The server needs to be an address starting with http:// or https://.')});
    setState({busy: true});
    try {
      const c = await saveNotify(form);
      setForm(c);
      setSaved(c);
      setState({
        done: !c.enabled ? tr('Saved. Switched off, nothing is sent.') : c.topic ? tr('Saved. Send a test to see it arrives.') : tr('Saved. No topic, no messages.'),
      });
    } catch {
      setState({error: tr('The mower did not answer.')});
    }
  };

  const test = async () => {
    setState({busy: true});
    try {
      const r = await testNotify();
      setState(r === 'sent' ? {done: tr('Sent. It should be on the phone in a moment.')} : {error: tr("The mower couldn't reach the ntfy server. Is the address right, and does the mower get on the internet?")});
      void notifyLog().then(setLog);
    } catch {
      setState({error: tr('The mower did not answer.')});
    }
  };

  const snooze = async (seconds: number) => {
    await snoozeNotify(seconds).catch(() => {});
    const c = await loadNotify(form);
    if (c) {
      setForm({...form, snooze: c.snooze});
      setSaved(c);
    }
    setNow(Date.now() / 1000);
  };

  const dirty = JSON.stringify({...form, snooze: 0}) !== JSON.stringify({...saved, snooze: 0});
  const live = !!saved?.topic && saved.enabled;
  const subscribe = saved?.topic ? `${saved.server.replace(/\/+$/, '')}/${saved.topic}` : null;

  return (
    <section className={styles.card}>
      <h2>{tr('Push messages')}</h2>
      <p className={styles.dim}>
        {tr(
          'A message on your phone when the mower needs you: an emergency stop, docking given up and the like. The container on the mower sends it through ntfy, also when no app is open and away from home. Install the ntfy app (Android or iOS) and subscribe to the topic below.',
        )}
      </p>
      <label className={styles.check}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => set({enabled: e.target.checked})} />
        {tr('Send push messages')}
      </label>

      <div className={local.grid}>
        <label className={styles.field}>
          {tr('ntfy server')}
          <input value={form.server} onChange={(e) => set({server: e.target.value})} placeholder="https://ntfy.sh" />
        </label>
        <label className={styles.field}>
          {tr('Topic')}
          <span className={local.row}>
            <input value={form.topic} onChange={(e) => set({topic: e.target.value})} placeholder={tr('empty: no messages')} />
            <button className={styles.pillButton} onClick={() => set({topic: randomTopic()})}>
              {tr('Random')}
            </button>
          </span>
        </label>
        <label className={styles.field}>
          {tr('Access token (optional)')}
          <input
            type="password"
            autoComplete="off"
            value={form.token === '-' ? '' : form.token}
            onChange={(e) => set({token: e.target.value})}
            placeholder={form.hasToken ? tr('saved, empty keeps it') : tr('only for a server that needs one')}
          />
        </label>
        <label className={styles.field}>
          {tr('Name in the messages')}
          <input value={form.name} onChange={(e) => set({name: e.target.value})} placeholder={tr('The mower')} />
        </label>
      </div>
      {form.hasToken && (
        <label className={styles.check}>
          <input type="checkbox" checked={form.token === '-'} onChange={(e) => set({token: e.target.checked ? '-' : ''})} />
          {tr('Remove the saved token')}
        </label>
      )}
      <p className={styles.dim}>
        {tr(
          'On ntfy.sh anyone who knows the topic can read along: take a random one, or your own server with a token. The messages only say what the mower is doing.',
        )}
      </p>

      <h3 className={local.sub}>{tr('Tell me about')}</h3>
      <div className={local.events}>
        {NOTIFY_EVENTS.map((e) => (
          <label key={e.key} className={styles.check}>
            <input type="checkbox" checked={form.events.includes(e.key)} onChange={() => toggle(e.key)} />
            {tr(e.label)}
          </label>
        ))}
      </div>

      {form.events.includes('emergency') && (
        <>
          <h3 className={local.sub}>{tr('Tell about an emergency stop')}</h3>
          <div className={styles.segment}>
            {EMERGENCY_WAIT.map((s) => (
              <button key={s} className={form.emergencyWait === s ? styles.segmentOn : undefined} onClick={() => set({emergencyWait: s})}>
                {s === 0 ? tr('right away') : s < 60 ? tr('after {n} s', {n: s}) : tr('after {n} min', {n: s / 60})}
              </button>
            ))}
          </div>
          <p className={styles.dim}>
            {tr('Only once it lasted that long: a bumper touched while docking often clears itself within seconds.')}
          </p>
        </>
      )}

      <h3 className={local.sub}>{tr('Remind me')}</h3>
      <div className={styles.segment}>
        {REMIND.map((m) => (
          <button key={m} className={form.remind === m ? styles.segmentOn : undefined} onClick={() => set({remind: m})}>
            {m ? tr('every {n} min', {n: m}) : tr('never')}
          </button>
        ))}
      </div>
      <p className={styles.dim}>
        {tr("Again and again while the mower can't get on by itself: in emergency stop, or outside the dock after it gave up. Snooze stops that for a while, also from the message (from the home network).")}
      </p>

      <h3 className={local.sub}>{tr('Language of the messages')}</h3>
      <div className={styles.segment}>
        {(
          [
            ['de', 'Deutsch'],
            ['en', 'English'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={form.lang === k ? styles.segmentOn : undefined} onClick={() => set({lang: k})}>
            {label}
          </button>
        ))}
      </div>

      <div className={local.actions}>
        <button className={styles.pillButton} onClick={save} disabled={state.busy || !dirty}>
          {tr('Save')}
        </button>
        <button className={styles.pillButton} onClick={test} disabled={state.busy || !live || dirty}>
          {tr('Send a test')}
        </button>
        {live &&
          saved?.remind !== 0 &&
          (form.snooze > now ? (
            <button className={styles.pillButton} onClick={() => void snooze(0)}>
              {tr('Snoozed until {time}, wake up', {time: clock(form.snooze)})}
            </button>
          ) : (
            <button className={styles.pillButton} onClick={() => void snooze(3600)}>
              {tr('Snooze 1 h')}
            </button>
          ))}
      </div>
      {state.done && <p className={styles.dim}>{state.done}</p>}
      {state.error && <p className={styles.error}>{state.error}</p>}
      {subscribe && (
        <p className={styles.dim}>
          {tr('Subscribe in the ntfy app to {topic} on {server}, or open it in the browser:', {topic: saved!.topic, server: saved!.server})}{' '}
          <a href={subscribe} target="_blank" rel="noreferrer">
            {subscribe}
          </a>
        </p>
      )}

      {log.length > 0 && (
        <ul className={local.log}>
          {log.slice(0, 5).map((l, i) => (
            <li key={i} className={l.sent ? undefined : styles.error}>
              <span>{clock(l.t)}</span> {l.sent ? tr('sent') : tr('failed')} · {l.title}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
