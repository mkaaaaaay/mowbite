'use client';

import {useRpcMethods} from '@/hooks/useRpcMethods';
import {dayDate, nearClock} from '@/lib/dates';
import {fmt, tr} from '@/lib/i18n';
import {RPC} from '@/lib/openmower';
import {activityText, loadStops, perBladeHour, reasonsOf, stopReasonText, type Stops} from '@/lib/stops';
import {useEffect, useState} from 'react';
import {IncidentLink} from './Incidents';
import styles from './Incidents.module.css';

// the last ones shown before "all"
const SHORT = 5;

// MowBite OS's stop book on the activity page: stops without a command by week and per blade hour, their reasons, and
// the last ones no event explained with the incident kept about them
export default function StopBook() {
  const on = !!useRpcMethods()?.has(RPC.statsStops);
  const [book, setBook] = useState<Stops | 'failed' | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    loadStops().then(
      (b) => alive && setBook(b),
      () => alive && setBook('failed'),
    );
    return () => {
      alive = false;
    };
  }, [on]);
  if (!on) return null;

  const got = book === 'failed' ? null : book;
  const weeks = got ? [...got.weeks].reverse() : [];
  const reasons = got ? reasonsOf(got.weeks) : [];
  const open = got ? got.last.filter((e) => e.kind !== 'standstill' && !e.explained) : [];

  return (
    <section className={styles.box} id="stops">
      <h2>{tr('Stop book')}</h2>
      <p className={styles.dim}>{tr('Mowing, docking or a drive that ended without a command, by week.')}</p>
      {book === null && <p className={styles.dim}>{tr('loading…')}</p>}
      {book === 'failed' && <p className={styles.error}>{tr('The mower did not answer.')}</p>}
      {got && weeks.length === 0 && <p className={styles.dim}>{tr('No stops counted yet.')}</p>}

      {weeks.length > 0 && (
        <ul className={styles.list}>
          {weeks.map((w) => {
            const per = perBladeHour(w);
            return (
              <li key={w.week} className={styles.row}>
                <span className={styles.time}>{tr('Week of {date}', {date: dayDate(new Date(w.start * 1000))})}</span>
                <strong>{w.stops === 1 ? tr('1 stop') : tr('{n} stops', {n: w.stops})}</strong>
                {per !== null && <span>{tr('{n} per blade hour', {n: fmt(per, 1)})}</span>}
                {w.unexplained > 0 && <span className={styles.badge}>{tr('{n} unexplained', {n: w.unexplained})}</span>}
                {w.standstills > 0 && <span className={styles.dim}>{tr('stood still {n}×', {n: w.standstills})}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {reasons.length > 0 && (
        <>
          <p>
            <strong>{tr('Why it stopped')}</strong>
          </p>
          <ul className={styles.list} data-stop-reasons>
            {reasons.map((r) => (
              <li key={r.reason} className={styles.row}>
                <strong>{fmt(r.count, 0)}×</strong>
                <span>{stopReasonText(r.reason)}</span>
                {r.class === 'symptom' && <span className={styles.dim}>{tr('says what ended, not why')}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {open.length > 0 && (
        <>
          <p>
            <strong>{tr('Not explained')}</strong>
          </p>
          <ul className={styles.list} data-stop-open>
            {(all ? open : open.slice(0, SHORT)).map((e) => (
              <li key={`${e.t}-${e.kind}`} className={styles.row}>
                <span className={styles.time}>{nearClock(e.t)}</span>
                <span>{activityText(e.activity)}</span>
                <span className={styles.dim}>{stopReasonText(e.reason)}</span>
                {e.incident && <IncidentLink id={e.incident} />}
              </li>
            ))}
          </ul>
          {open.length > SHORT && (
            <button className={styles.button} onClick={() => setAll(!all)}>
              {all ? tr('Show less') : tr('Show more')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
