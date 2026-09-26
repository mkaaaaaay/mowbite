'use client';

import {clock, dayKey, dayLabel, duration} from '@/lib/dates';
import {describe, explain, groupRuns, OUTCOMES, withState, type Entry, type MowerEvent, type Run} from '@/lib/events';
import {useDragScroll} from '@/hooks/useDragScroll';
import {callRpc} from '@/lib/rpc';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import styles from './page.module.css';

// "20260926" -> Date
const parseDay = (d: string) => new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));

function Timeline({events}: {events: MowerEvent[]}) {
  return (
    <ol className={styles.timeline}>
      {withState(events).map(({event, state}) => {
        const {text, severity} = describe(event, state);
        return (
          <li key={event.id} className={styles[severity]}>
            <span className={styles.time}>{clock(event.t, true)}</span>
            <span>{text}</span>
          </li>
        );
      })}
    </ol>
  );
}

// the events carry a position, so we can at least tell whether it moved and whether gps was there
function problemFacts(run: Run, e: MowerEvent, next?: Run): string[] {
  const facts: string[] = [];
  const first = run.events[0];
  if (e.x !== undefined && first.x !== undefined && e.y !== undefined && first.y !== undefined) {
    const d = Math.hypot(e.x - first.x, e.y - first.y);
    facts.push(d < 0.1 ? `Hadn't moved (${Math.round(d * 100)} cm)` : `${d.toFixed(1)} m from where the run started`);
  }
  const gps = run.events.filter((g) => g.type === 'GPS' && g.t <= e.t).pop();
  facts.push(gps ? (gps.available ? 'GPS fix' : 'no GPS fix') : 'GPS still off');
  if (e.type === 'UNDOCKING_FAILED' && next && next.start - e.t < 600) {
    const worked = next.outcome !== 'undock_failed';
    const gap = next.start - e.t;
    facts.push(`Tried again ${gap < 60 ? `${Math.round(gap)} s` : duration(gap)} later, ${worked ? 'that worked' : 'failed again'}`);
  }
  return facts;
}

function Problems({run, next}: {run: Run; next?: Run}) {
  const list = withState(run.events).filter(({event, state}) => describe(event, state).severity !== 'info');
  if (!list.length) return null;
  return (
    <ul className={styles.problemList}>
      {list.map(({event, state}) => {
        const {text, severity} = describe(event, state);
        const hint = explain(event, state);
        return (
          <li key={event.id} className={styles[severity]}>
            <div>
              <span className={styles.time}>{clock(event.t, true)}</span>
              <strong>{text}</strong>
            </div>
            {hint && <p>{hint}</p>}
            <p className={styles.facts}>{problemFacts(run, event, next).join(' · ')}</p>
          </li>
        );
      })}
    </ul>
  );
}

function RunCard({run, next}: {run: Run; next?: Run}) {
  const [open, setOpen] = useState(false);
  const outcome = OUTCOMES[run.outcome];
  return (
    <article className={[styles.run, styles[`tone-${outcome.tone}`]].join(' ')}>
      <header onClick={() => setOpen(!open)}>
        <div className={styles.runTime}>
          <strong>
            {clock(run.start)} – {clock(run.end)}
          </strong>
          <span className={styles.dim}>{duration(run.end - run.start)}</span>
        </div>
        <span className={styles.badge}>{outcome.label}</span>
      </header>

      <div className={styles.runFacts}>
        {run.areas.map((a) => (
          <span key={a} className={styles.area}>
            {a}
          </span>
        ))}
        {run.bladeSeconds > 0 && <span className={styles.dim}>mowed {duration(run.bladeSeconds)}</span>}
      </div>

      <Problems run={run} next={next} />

      <div className={styles.runActions}>
        <button onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Details'}</button>
        {run.jobId && <Link href={`/map?job=${run.jobId}`}>Show track</Link>}
      </div>

      {open && <Timeline events={run.events} />}
    </article>
  );
}

export default function ActivityPage() {
  const [days, setDays] = useState<string[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [events, setEvents] = useState<MowerEvent[] | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [failed, setFailed] = useState(false);
  const daysRef = useDragScroll<HTMLDivElement>();

  useEffect(() => {
    callRpc<string[]>('events.history.list').then(
      (list) => {
        setDays(list);
        setDay((d) => d ?? list[0] ?? null);
      },
      () => setFailed(true),
    );
  }, []);

  const shown = day ?? days?.[0] ?? null;
  const isToday = !!shown && dayKey(parseDay(shown)) === dayKey(new Date());

  useEffect(() => {
    if (!shown) return;
    let alive = true;
    const load = () =>
      callRpc<MowerEvent[]>('events.history', {date: shown}, 20000).then(
        (e) => alive && setEvents(e),
        () => alive && setFailed(true),
      );
    void load();
    // today keeps growing, the mower has no live event topic, so ask again now and then
    const timer = isToday ? setInterval(load, 30000) : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [shown, isToday]);

  // outside of runs only start/shutdown and real problems are interesting, not gps toggling in the dock
  const entries: Entry[] = (events ? groupRuns(events, isToday).reverse() : []).filter(
    (e) => e.kind === 'run' || ['BOOTED', 'SHUTDOWN'].includes(e.event.type) || describe(e.event).severity !== 'info',
  );
  const runs = entries.flatMap((e) => (e.kind === 'run' ? [e.run] : []));
  const mowed = runs.reduce((s, r) => s + r.bladeSeconds, 0);
  const problems = runs.reduce((s, r) => s + r.problems, 0);
  const visible = entries.filter((e) =>
    !onlyProblems ? true : e.kind === 'run' ? e.run.problems > 0 : describe(e.event).severity !== 'info',
  );

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>Activity</h1>

        {failed && !days && <p className={styles.dim}>This mower doesn&apos;t keep an event history.</p>}

        {days && (
          <div className={styles.days} ref={daysRef}>
            {days.slice(0, 60).map((d) => (
              <button
                key={d}
                className={d === shown ? styles.on : undefined}
                onClick={() => {
                  setEvents(null);
                  setDay(d);
                }}
              >
                {dayLabel(parseDay(d))}
              </button>
            ))}
          </div>
        )}

        {events && (
          <div className={styles.summary}>
            <div>
              <strong>{duration(mowed)}</strong>
              <span>mowed</span>
            </div>
            <div>
              <strong>{runs.length}</strong>
              <span>{runs.length === 1 ? 'run' : 'runs'}</span>
            </div>
            <div className={problems ? styles.bad : undefined}>
              <strong>{problems}</strong>
              <span>{problems === 1 ? 'problem' : 'problems'}</span>
            </div>
            <label className={styles.filter}>
              <input type="checkbox" checked={onlyProblems} onChange={() => setOnlyProblems(!onlyProblems)} />
              only problems
            </label>
          </div>
        )}

        {shown && !events && <p className={styles.dim}>loading…</p>}
        {events && visible.length === 0 && <p className={styles.dim}>Nothing here.</p>}

        <div className={styles.list}>
          {visible.map((e) =>
            e.kind === 'run' ? (
              <RunCard key={e.run.events[0].id} run={e.run} next={runs[runs.indexOf(e.run) - 1]} />
            ) : (
              <div key={e.event.id} className={[styles.loose, styles[describe(e.event).severity]].join(' ')}>
                <span className={styles.time}>{clock(e.event.t)}</span>
                {describe(e.event).text}
              </div>
            ),
          )}
        </div>
      </main>
    </div>
  );
}
