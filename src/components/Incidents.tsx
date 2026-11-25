'use client';

import {useRpcMethods} from '@/hooks/useRpcMethods';
import {useSure} from '@/hooks/useSure';
import {size} from '@/lib/autoUpdate';
import {clock, dayLabel} from '@/lib/dates';
import {reasonText, type MowerEvent} from '@/lib/events';
import {fmt, tr} from '@/lib/i18n';
import {
  deleteIncidents,
  downloadIncident,
  incidentOf,
  loadIncident,
  loadIncidents,
  loadJournal,
  markIncident,
  type Incident,
  type IncidentDetail,
  type JournalStatus,
  type Trigger,
} from '@/lib/incidents';
import {MAX_NOTE} from '@/lib/incidentLimits';
import {RPC} from '@/lib/openmower';
import {answerError} from '@/lib/rpcText';
import {savePieces} from '@/lib/saveFile';
import Link from 'next/link';
import {useEffect, useState, useSyncExternalStore} from 'react';
import logStyles from './RosLog.module.css';
import styles from './Incidents.module.css';

// the incidents of MowBite OS on the activity page: a list with the journal's state, and next to a problem the one it
// set off. one copy for all of them, asked again after a change and every 15 s while one is still being collected

type Kept = {list: Incident[]; status: JournalStatus};
let cached: Kept | null = null;
let askedAt = 0;
let asking: Promise<void> | null = null;
// one more after the one going on, asked for while it was out (a delete, a mark)
let after: Promise<void> | null = null;
let poll: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
// a done incident doesn't change any more
const details = new Map<string, IncidentDetail>();
// ids an event named that the list didn't have yet, asked for once
const looked = new Set<string>();

function refresh(): Promise<void> {
  if (asking)
    return (after ??= asking.then(() => {
      after = null;
      return refresh();
    }));
  const again = (on: boolean) => {
    clearTimeout(poll);
    if (listeners.size && on) poll = setTimeout(refresh, 15000);
  };
  return (asking = Promise.all([loadIncidents(), loadJournal()])
    .then(([list, status]) => {
      cached = {list, status};
      askedAt = Date.now();
      listeners.forEach((f) => f());
      again(list.some((i) => i.state !== 'done'));
    })
    .catch(() => again(!cached || cached.list.some((i) => i.state !== 'done')))
    .finally(() => (asking = null)));
}
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};

function useIncidents(): Kept | null | undefined {
  const methods = useRpcMethods();
  const on = !!methods?.has(RPC.incidentsList) && methods.has(RPC.journalStatus);
  const kept = useSyncExternalStore(subscribe, () => cached, () => null);
  useEffect(() => {
    if (on && Date.now() - askedAt > 5000) void refresh();
  }, [on]);
  // undefined: not on this mower, null: loading
  return on ? kept : undefined;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// a kind of trigger in words, as the event INCIDENT names it
const kindText = (kind: string) => capital(reasonText({id: '', t: 0, type: 'INCIDENT', reason: kind}));
// the note of a mark in quotes
const quoted = (s: string) => `„${s}“`;
// what's new in a trigger next to its kind (the title says that): the reason or the note, else the kind
const triggerText = (t: Trigger, withKind: boolean) => {
  const said = t.kind === 'MARK' && t.reason ? quoted(t.reason) : t.reason;
  return !said ? kindText(t.kind) : withKind ? `${kindText(t.kind)}: ${said}` : said;
};

const DOWNLOAD_FAILED: Record<string, string> = {
  checksum: 'The download came in broken, try again.',
  timeout: 'The mower took too long to pack it, try again later.',
};

type Said = {text: string; error?: boolean} | null;
const Note = ({note}: {note: Said}) => (note ? <p className={note.error ? styles.error : styles.dim}>{note.text}</p> : null);
const failed = (set: (n: Said) => void) => (e: unknown) => set({text: answerError(e), error: true});

function Details({incident}: {incident: Incident}) {
  const [detail, setDetail] = useState<IncidentDetail | null | 'failed'>(() => details.get(incident.id) ?? null);
  const [course, setCourse] = useState(false);
  const [place, setPlace] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Said>(null);
  const {sure, confirm} = useSure();
  const done = incident.state === 'done';
  useEffect(() => {
    if (details.has(incident.id)) return;
    let stop = false;
    loadIncident(incident.id).then(
      (d) => {
        if (done) details.set(incident.id, d);
        if (!stop) setDetail(d);
      },
      () => !stop && setDetail('failed'),
    );
    return () => {
      stop = true;
    };
  }, [incident.id, done]);

  const download = async () => {
    setNote(null);
    setBusy(tr('Packing on the mower…'));
    try {
      const progress = (got: number, all: number) => setBusy(tr('Downloading, {pct} %…', {pct: Math.round((got / all) * 100)}));
      await savePieces(`mowbite-incident-${incident.id}.tar`, 'application/x-tar', (put) => downloadIncident(incident.id, place, progress, put));
    } catch (e) {
      const own = e instanceof Error ? DOWNLOAD_FAILED[e.message] : undefined;
      setNote({text: own ? tr(own) : answerError(e), error: true});
    }
    setBusy(null);
  };
  const remove = () => deleteIncidents(incident.id).then(() => refresh(), failed(setNote));
  const mixed = detail && detail !== 'failed' && new Set(detail.triggers.map((t) => t.kind)).size > 1;

  return (
    <div className={styles.details}>
      {detail === null && <span className={styles.dim}>{tr('loading…')}</span>}
      {detail === 'failed' && <span className={styles.error}>{tr('The mower did not answer.')}</span>}
      {detail && detail !== 'failed' && (
        <>
          <p className={styles.dim}>
            {tr('Kept from {from} to {to}, {n} processes.', {from: clock(detail.from, true), to: clock(detail.to, true), n: detail.processes})}
          </p>
          <ul className={styles.triggers}>
            {detail.triggers.map((t, i) => (
              <li key={i}>
                <span className={styles.time}>{clock(t.t, true)}</span>
                <span>{triggerText(t, !!mixed)}</span>
              </li>
            ))}
            {detail.more > 0 && <li className={styles.dim}>{tr('and {n} more', {n: detail.more})}</li>}
          </ul>
          <div className={`${logStyles.log} ${styles.full}`}>
            {detail.log.length === 0 && <span>{tr('No warnings or errors logged in this time.')}</span>}
            {detail.log.map((l, i) => (
              <span key={i} className={logStyles[l.level]}>
                {clock(l.t, true)} {l.level} {l.text}
              </span>
            ))}
          </div>
          {detail.timeline.length > 0 && (
            <button className={logStyles.link} onClick={() => setCourse(!course)}>
              {course ? tr('Hide what the processes did') : tr('What the processes did')}
            </button>
          )}
          {course && (
            <div className={`${logStyles.log} ${styles.full}`}>
              {detail.timeline.map((l, i) => (
                <span key={i}>
                  {clock(l.t, true)} {l.process} {l.text}
                </span>
              ))}
              {detail.left > 0 && <span>{tr('{n} lines left out by the mower, they are in the download.', {n: detail.left})}</span>}
            </div>
          )}
        </>
      )}
      {done ? (
        <>
          <div className={`${styles.actions} ${styles.full}`}>
            <button className={styles.button} disabled={!!busy} onClick={() => void download()}>
              {busy ?? tr('Download')}
            </button>
            <label className={styles.check}>
              <input type="checkbox" checked={place} onChange={(e) => setPlace(e.target.checked)} />
              {tr('With position and date')}
            </label>
            {/* away from the tick, a tap beside it mustn't ask to delete */}
            <button className={`${logStyles.link} ${styles.end}`} onClick={() => confirm('one', () => void remove())}>
              {sure === 'one' ? tr('Sure? Delete') : tr('Delete')}
            </button>
          </div>
          {!place && <p className={styles.dim}>{tr('Without the tick the download leaves out the place and the real date, so it can be passed on safely.')}</p>}
        </>
      ) : (
        <p className={styles.dim}>{tr('Still being collected, it can be downloaded once that is done.')}</p>
      )}
      <Note note={note} />
    </div>
  );
}

// next to a problem on the activity page: the incident it set off, if the mower still keeps it
export function IncidentOf({event, events}: {event: MowerEvent; events: readonly MowerEvent[]}) {
  const id = incidentOf(event, events);
  return id ? <IncidentLink id={id} /> : null;
}

// opens the incident with this id, if the mower still keeps it
export function IncidentLink({id}: {id: string}) {
  const list = useIncidents()?.list;
  const [open, setOpen] = useState(false);
  const incident = list?.find((i) => i.id === id);
  // one that came after the list was asked for
  useEffect(() => {
    if (!list || incident || looked.has(id)) return;
    looked.add(id);
    void refresh();
  }, [id, list, incident]);
  if (!incident) return null;
  return (
    <>
      <button className={logStyles.link} onClick={() => setOpen(!open)}>
        {open ? tr('Hide Blackbox') : tr('Blackbox')}
      </button>
      {open && <Details incident={incident} />}
    </>
  );
}

function Row({incident}: {incident: Incident}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={incident.safety ? styles.safety : undefined} data-incident={incident.id}>
      <div className={styles.head} onClick={() => setOpen(!open)} role="button" aria-expanded={open}>
        <span className={styles.time}>
          {dayLabel(new Date(incident.created * 1000))} {clock(incident.created)}
        </span>
        <strong>
          {incident.triggers.map(kindText).join(', ')}
          {incident.triggers[0] === 'MARK' && incident.reason && `: ${quoted(incident.reason)}`}
        </strong>
        {incident.safety && <span className={styles.badge}>{tr('Safety')}</span>}
        {incident.state !== 'done' && <span className={styles.dim}>{tr('collecting…')}</span>}
      </div>
      {open && <Details incident={incident} />}
    </li>
  );
}

// the list with what the journal keeps, a moment to mark and deleting all of them
export function Blackbox() {
  const kept = useIncidents();
  const [text, setText] = useState('');
  const [marking, setMarking] = useState(false);
  const [note, setNote] = useState<Said>(null);
  const {sure, confirm} = useSure();
  if (kept === undefined) return null;

  const mark = () => {
    setMarking(true);
    setNote(null);
    markIncident(text.trim())
      .then(() => {
        setText('');
        setNote({text: tr('Kept. It shows up here once it has been collected.')});
        void refresh();
      }, failed(setNote))
      .finally(() => setMarking(false));
  };
  const removeAll = () => deleteIncidents().then(() => refresh(), failed(setNote));
  const {list, status} = kept ?? {};
  const inc = status?.incidents;
  const throttled = inc?.throttled.filter((t) => t.count) ?? [];

  return (
    <section className={styles.box} id="blackbox">
      <h2>{tr('Blackbox')}</h2>
      <p className={styles.dim}>
        {tr('MowBite OS keeps what its processes did around an emergency stop, a failed docking or a crash, to look into it later or pass it on.')}
      </p>
      {status && !status.enabled && (
        <p className={styles.warn}>
          {tr('The journal is off, no incidents are kept.')} <Link href="/settings#journal">{tr('Switch it on')}</Link>
        </p>
      )}
      {status?.enabled && status.problem && <p className={styles.warn}>{tr('No incidents kept right now: {why}', {why: status.problem})}</p>}
      {!!inc?.max_bytes && !!inc.max_days && (
        <p className={styles.dim}>
          {tr('{n} kept, {size} of {max}. They stay {days} days, safety cases {safety}.', {
            n: inc.count ?? list?.length ?? 0,
            size: size(inc.bytes ?? 0),
            max: size(inc.max_bytes),
            days: inc.max_days,
            safety: inc.max_days_safety ?? inc.max_days,
          })}
        </p>
      )}
      {!!status?.max_bytes && !!status.max_days && (
        <p className={styles.dim}>
          {tr('Journal: {size} of {max}, the last {days} days.', {size: size(status.bytes ?? 0), max: size(status.max_bytes), days: status.max_days})}
        </p>
      )}
      {throttled.length > 0 && (
        <p className={styles.dim}>
          {tr('Not kept, they came too often: {what}', {what: throttled.map((t) => `${kindText(t.kind)} (${fmt(t.count ?? 0, 0)}×)`).join(', ')})}
        </p>
      )}

      {status?.enabled && !status.problem && (
        <div className={styles.mark}>
          <textarea
            value={text}
            maxLength={MAX_NOTE}
            rows={2}
            placeholder={tr('Something odd just now? What happened (optional)')}
            onChange={(e) => setText(e.target.value)}
          />
          <button className={styles.button} disabled={marking} onClick={mark}>
            {tr('Keep the last 5 minutes')}
          </button>
        </div>
      )}
      <Note note={note} />

      {!list && <p className={styles.dim}>{tr('loading…')}</p>}
      {list?.length === 0 && <p className={styles.dim}>{tr('No incidents kept.')}</p>}
      {!!list?.length && (
        <>
          <ul className={styles.list}>
            {list.map((i) => (
              <Row key={i.id} incident={i} />
            ))}
          </ul>
          <button className={logStyles.link} onClick={() => confirm('all', () => void removeAll())}>
            {sure === 'all' ? tr('Sure? Delete all {n}', {n: list.length}) : tr('Delete all')}
          </button>
        </>
      )}
    </section>
  );
}
