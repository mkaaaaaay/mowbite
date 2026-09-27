'use client';

import {TitleMark} from '@/components/Logo';
import {datumFromParams, useMowerParams} from '@/hooks/useMowerParams';
import {clock, dayLabel} from '@/lib/dates';
import {locale, tr, useLang} from '@/lib/i18n';
import {
  cachedSchedule,
  cachedScheduleLog,
  isNightTime,
  EMPTY_SCHEDULE,
  FORECAST_HOURS,
  loadSchedule,
  loadScheduleLog,
  nextStart,
  saveSchedule,
  type LogEntry,
  type Schedule,
} from '@/lib/schedule';
import {useEffect, useState} from 'react';
import styles from './page.module.css';
import {useMowerMap} from '@/hooks/useMowerMap';

const LOG_TEXT: Record<string, string> = {
  started: 'Started',
  waiting_battery: 'Waiting for the battery ({detail} %)',
  skip_battery: 'Not started, battery only at {detail} % after two hours',
  skip_rain: "Not started, the mower's rain sensor was wet",
  skip_forecast: 'Not started, rain was forecast',
  skip_busy: 'Not started, the mower was busy ({detail})',
  skip_emergency: 'Not started, emergency stop was active',
  skip_offline: "Not started, the mower wasn't reachable",
  skipped_area: "Skipped an area that wasn't picked",
  skip_night: 'Not started, no mowing between 6 pm and 6 am',
};

// monday first, labels from the browser so they come out in the app's language
const weekday = (d: number) => new Date(2024, 0, d).toLocaleDateString(locale(), {weekday: 'short'});

export default function SchedulePage() {
  useLang();
  const params = useMowerParams();
  const map = useMowerMap();
  // the areas a plan can pick from: mowing areas the mower actually mows
  const mowAreas = (map?.areas ?? []).filter((a) => a.properties.type === 'mow' && a.properties.active !== false);
  const datum = datumFromParams(params);
  // undefined: loading, null: not served by the container
  const [schedule, setSchedule] = useState<Schedule | null | undefined>(cachedSchedule);
  const [log, setLog] = useState<LogEntry[]>(() => cachedScheduleLog() ?? []);
  const [error, setError] = useState<string | null>(null);
  // a night time someone tried to set, it isn't taken
  const [refused, setRefused] = useState<number | null>(null);

  useEffect(() => {
    void loadSchedule().then(setSchedule);
    void loadScheduleLog().then(setLog);
    const timer = setInterval(() => void loadScheduleLog().then(setLog), 60000);
    return () => clearInterval(timer);
  }, []);

  // every change is saved right away
  const update = (next: Schedule) => {
    setSchedule(next);
    setError(null);
    saveSchedule(next, next.skipForecast && datum ? datum : undefined).catch((e) =>
      setError(e instanceof Error ? e.message : tr('failed')),
    );
  };

  const s = schedule ?? EMPTY_SCHEDULE;
  const next = nextStart(s);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>
          <TitleMark />
          {tr('Schedule')}
        </h1>

        {schedule === null && (
          <p className={styles.dim}>{tr('The schedule needs MowBite running as its container on the mower.')}</p>
        )}

        {schedule && (
          <>
            <section className={styles.card}>
              <label className={styles.switch}>
                <input type="checkbox" checked={s.enabled} onChange={(e) => update({...s, enabled: e.target.checked})} />
                <strong>{tr('Mow by schedule')}</strong>
              </label>
              <p className={styles.dim}>
                {next
                  ? tr('Next start: {when}', {when: `${dayLabel(next)}, ${clock(next.getTime() / 1000)}`})
                  : s.enabled
                    ? tr('No start planned yet.')
                    : tr('Switched off, the mower only mows when you start it.')}
              </p>
            </section>

            <section className={styles.card}>
              <h2>{tr('Start times')}</h2>
              {s.plans.length === 0 && <p className={styles.dim}>{tr('No start times yet.')}</p>}
              {s.plans.map((p, i) => (
                <div key={i} className={styles.plan}>
                  <div className={styles.days}>
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <button
                        key={d}
                        className={p.days.includes(d) ? styles.on : undefined}
                        onClick={() => {
                          const days = p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d];
                          update({...s, plans: s.plans.map((q, j) => (j === i ? {...q, days} : q))});
                        }}
                      >
                        {weekday(d)}
                      </button>
                    ))}
                  </div>
                  <input
                    type="time"
                    min="06:00"
                    max="17:59"
                    value={p.time}
                    onChange={(e) => {
                      const time = e.target.value;
                      if (!time) return;
                      if (isNightTime(time)) return setRefused(i);
                      setRefused(null);
                      update({...s, plans: s.plans.map((q, j) => (j === i ? {...q, time} : q))});
                    }}
                  />
                  <button className={styles.remove} onClick={() => update({...s, plans: s.plans.filter((_, j) => j !== i)})} aria-label="remove">
                    ×
                  </button>
                  {mowAreas.length > 1 && (
                    <div className={styles.areas}>
                      <button
                        className={p.areas.length === 0 ? styles.on : undefined}
                        onClick={() => update({...s, plans: s.plans.map((q, j) => (j === i ? {...q, areas: []} : q))})}
                      >
                        {tr('All active areas')}
                      </button>
                      {mowAreas.map((a) => {
                        const on = p.areas.includes(a.id);
                        return (
                          <button
                            key={a.id}
                            className={on ? styles.on : undefined}
                            onClick={() => {
                              let areas = on ? p.areas.filter((x) => x !== a.id) : [...p.areas.filter((x) => mowAreas.some((m) => m.id === x)), a.id];
                              // everything picked is the same as all active
                              if (areas.length === mowAreas.length) areas = [];
                              update({...s, plans: s.plans.map((q, j) => (j === i ? {...q, areas} : q))});
                            }}
                          >
                            {a.properties.name || tr('unnamed')}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {(refused === i || isNightTime(p.time)) && (
                    <div className={styles.animals}>
                      <p>
                        🦔 {tr("Between 6 pm and 6 am hedgehogs and other animals are out in the garden. They don't run from the mower, they curl up and can get badly hurt. That's why the schedule doesn't start in that time. Thanks for understanding!")}
                      </p>
                      {isNightTime(p.time) && <p>{tr('This start time is skipped, please move it into the day.')}</p>}
                    </div>
                  )}
                </div>
              ))}
              <button className={styles.add} onClick={() => update({...s, plans: [...s.plans, {days: [1, 3, 5], time: '10:00', areas: []}]})}>
                + {tr('Add start time')}
              </button>
            </section>

            <section className={styles.card}>
              <h2>{tr('Conditions')}</h2>
              <label className={styles.slider}>
                <span>{s.minBattery > 0 ? tr('Battery at least {n} %', {n: s.minBattery}) : tr("Don't wait for the battery")}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={s.minBattery}
                  onChange={(e) => update({...s, minBattery: Number(e.target.value)})}
                />
              </label>
              <p className={styles.dim}>
                {tr("If it isn't charged that far at the start time, it waits for up to two hours and then leaves it for that day.")}
              </p>
              <label className={styles.check}>
                <input type="checkbox" checked={s.skipRain} onChange={(e) => update({...s, skipRain: e.target.checked})} />
                {tr("Not when the mower's rain sensor is wet")}
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={s.skipForecast}
                  disabled={!datum}
                  onChange={(e) => update({...s, skipForecast: e.target.checked})}
                />
                {tr('Not when it rains or rain is forecast for the next')}
                <select
                  className={styles.hours}
                  value={s.forecastHours}
                  disabled={!datum}
                  onChange={(e) => update({...s, forecastHours: Number(e.target.value)})}
                >
                  {FORECAST_HOURS.map((h) => (
                    <option key={h} value={h}>
                      {h === 1 ? tr('hour') : tr('{n} hours', {n: h})}
                    </option>
                  ))}
                </select>
              </label>
              <p className={styles.dim}>
                {tr('The forecast comes from Open-Meteo, the mower asks for it with the position rounded to about a kilometer.')}
              </p>
              <p className={styles.dim}>{tr('The mower is only started when it stands idle and no emergency stop is active.')}</p>
              {mowAreas.length > 1 && (
                <p className={styles.dim}>
                  {tr(
                    'With only some areas picked, the mower still starts as usual and skips the others when it gets to them, in the normal mowing order.',
                  )}
                </p>
              )}
            </section>

            <section className={styles.card}>
              <h2>{tr('What happened')}</h2>
              {log.length === 0 && <p className={styles.dim}>{tr('Nothing yet.')}</p>}
              <ul className={styles.log}>
                {log.slice(0, 20).map((l, i) => (
                  <li key={i} className={l.what === 'started' ? styles.good : l.what.startsWith('skip') ? styles.bad : undefined}>
                    <span className={styles.dim}>
                      {dayLabel(new Date(l.t * 1000))}, {clock(l.t)}
                    </span>
                    {tr(LOG_TEXT[l.what] ?? l.what, {detail: l.detail ?? ''})}
                  </li>
                ))}
              </ul>
            </section>

            {error && <p className={styles.error}>{error}</p>}
          </>
        )}
      </main>
    </div>
  );
}
