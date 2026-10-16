'use client';

import InfoTip from './InfoTip';
import {UpdateCommand, versionNote} from './Updates';
import {fmt, locale, tr} from '@/lib/i18n';
import {amountsOf, loadStats, partDone, partUse, setPartDue, type Part, type Period, type Stats} from '@/lib/stats';
import {containerHas, useUpdates} from '@/lib/updates';
import {useEffect, useState} from 'react';
import styles from './MowingStats.module.css';

// this week, month and year so far
const PERIODS: {key: Period; label: string}[] = [
  {key: 'week', label: 'Week'},
  {key: 'month', label: 'Month'},
  {key: 'year', label: 'Year'},
  {key: 'total', label: 'Total'},
];

// the parts the container keeps (docker/stats.sh), what seeing to them is called
const PARTS: Record<string, {label: string; done: string; ask: string}> = {
  blade: {label: 'Blades', done: 'Changed', ask: 'Blades changed? Their hours start again from 0.'},
  clean: {label: 'Cleaning', done: 'Cleaned', ask: 'Cleaned it? The hours start again from 0.'},
};

const hours = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${fmt(s / 3600, s < 360000 ? 1 : 0)} h`);
const distance = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${fmt(m / 1000, 1)} km`);
const date = (t: number) => new Date(t * 1000).toLocaleDateString(locale(), {day: 'numeric', month: 'numeric', year: 'numeric'});

function PartRow({stats, part, onStats}: {stats: Stats; part: Part; onStats: (s: Stats) => void}) {
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [due, setDue] = useState('');
  const [failed, setFailed] = useState(false);
  const meta = PARTS[part.key];
  if (!meta) return null;
  const use = partUse(stats, part);
  const answer = (s: Stats | null) => {
    setFailed(!s);
    if (s) onStats(s);
  };

  return (
    <div className={styles.part}>
      <div className={styles.partHead}>
        <span>{tr(meta.label)}</span>
        <strong className={use.due ? styles.due : undefined}>
          {tr('{used} of {due} h', {used: fmt(use.seconds / 3600, use.seconds < 36000 ? 1 : 0), due: part.dueHours})}
          {use.due && ` · ${tr('due')}`}
        </strong>
      </div>
      <div className={styles.bar}>
        <div className={[styles.fill, use.due ? styles.fillDue : ''].join(' ')} style={{width: `${Math.min(100, use.fraction * 100)}%`}} />
      </div>
      {asking ? (
        <div className={styles.row}>
          <span>{tr(meta.ask)}</span>
          <button
            className={styles.main}
            onClick={() => {
              setAsking(false);
              void partDone(part.key).then(answer);
            }}
          >
            {tr(meta.done)}
          </button>
          <button onClick={() => setAsking(false)}>{tr('Cancel')}</button>
        </div>
      ) : editing ? (
        <form
          className={styles.row}
          onSubmit={(e) => {
            e.preventDefault();
            const h = Math.round(Number(due));
            if (!(h >= 1 && h <= 5000)) return;
            setEditing(false);
            void setPartDue(part.key, h).then(answer);
          }}
        >
          <label>
            {tr('Due after')}
            <input type="number" min={1} max={5000} step={1} inputMode="numeric" value={due} onChange={(e) => setDue(e.target.value)} />
            {tr('blade hours')}
          </label>
          <button type="submit" className={styles.main}>
            {tr('Save')}
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            {tr('Cancel')}
          </button>
        </form>
      ) : (
        <div className={styles.row}>
          <span className={styles.dim}>{part.doneAt ? tr('last on {date}', {date: date(part.doneAt)}) : tr('since counting started')}</span>
          <button onClick={() => setAsking(true)}>{tr(meta.done)}</button>
          <button
            className={styles.link}
            onClick={() => {
              setDue(String(part.dueHours));
              setEditing(true);
            }}
          >
            {tr('every {n} h', {n: part.dueHours})}
          </button>
        </div>
      )}
      {failed && <span className={styles.error}>{tr("The mower didn't answer.")}</span>}
    </div>
  );
}

// mowing hours, runs and distance over a week, month, year or all the time, and the parts due by the blade hours.
// counted by MowBite's container on the mower (docker/stats.sh), so nothing older than that container is in it
export default function MowingStats() {
  const u = useUpdates();
  // undefined: loading, null: not served
  const [stats, setStats] = useState<Stats | null | undefined>(undefined);
  const [period, setPeriod] = useState<Period>('week');
  useEffect(() => {
    let alive = true;
    const get = () => void loadStats().then((s) => alive && setStats(s));
    get();
    const every = setInterval(get, 60000);
    return () => {
      alive = false;
      clearInterval(every);
    };
  }, []);

  if (u.level === null) return null;
  if (!containerHas(u.level, 'stats')) {
    return (
      <section className={styles.card}>
        <h2>{tr('Mowing hours and maintenance')}</h2>
        <span className={styles.dim}>{tr('MowBite on the mower{old} is too old for this, it needs an update first.', {old: versionNote(u.mower)})}</span>
        <UpdateCommand />
      </section>
    );
  }
  if (!stats) return null;
  const a = amountsOf(stats, period);

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h2>
          {tr('Mowing hours')}
          <InfoTip>
            {tr(
              "Counted by MowBite on the mower: how long the mow motor turned, how far the mower drove with and without it and how often it set off to mow. It counts from when MowBite got this, older runs aren't in it.",
            )}
          </InfoTip>
        </h2>
        <div className={styles.periods} role="group">
          {PERIODS.map((p) => (
            <button key={p.key} className={period === p.key ? styles.on : undefined} onClick={() => setPeriod(p.key)}>
              {tr(p.label)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.values}>
        <div>
          <strong>{hours(a.blade)}</strong>
          <span>{tr('mowed')}</span>
        </div>
        <div>
          <strong>{a.runs}</strong>
          <span>{a.runs === 1 ? tr('run') : tr('runs')}</span>
        </div>
        <div>
          <strong>{distance(a.mowed)}</strong>
          <span>{tr('with the blade')}</span>
        </div>
        <div>
          <strong>{distance(a.driven)}</strong>
          <span>{tr('without the blade')}</span>
        </div>
      </div>
      {period === 'total' && stats.since > 0 && <span className={styles.dim}>{tr('Counted since {date}.', {date: date(stats.since)})}</span>}

      {stats.parts.some((p) => PARTS[p.key]) && (
        <>
          <h3>
            {tr('Maintenance')}
            <InfoTip>
              {tr(
                'By the hours the blade turned since you last did it. When one is due, MowBite sends a push message if they are set up and "Maintenance due" is ticked there.',
              )}
            </InfoTip>
          </h3>
          {stats.parts.map((p) => (
            <PartRow key={p.key} stats={stats} part={p} onStats={setStats} />
          ))}
        </>
      )}
    </section>
  );
}
