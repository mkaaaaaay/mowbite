'use client';

import {TitleMark} from '@/components/Logo';
import {TitleRow} from '@/components/TopWeather';
import {datumFromParams, useMowerParams} from '@/hooks/useMowerParams';
import {sunTimes} from '@/lib/sun';
import {clock, dayLabel} from '@/lib/dates';
import {tr, useLang} from '@/lib/i18n';
import {useMowerActions} from '@/hooks/useMowerActions';
import {useCanSetParams} from '@/components/MowerParamSettings';
import {paramField} from '@/lib/mowerParams';
import {containerHas, useUpdates} from '@/lib/updates';
import Link from 'next/link';
import {ACTION} from '@/lib/openmower';
import PlanRow from './PlanRow';
import PauseCard from './PauseCard';
import {
  cachedSchedule,
  cachedScheduleLog,
  EMPTY_SCHEDULE,
  COLD_TEMPS,
  FORECAST_HOURS,
  loadSchedule,
  loadScheduleLog,
  nextStart,
  saveSchedule,
  type LogEntry,
  type Schedule,
  scheduleLogLine,
} from '@/lib/schedule';
import {useEffect, useState} from 'react';
import styles from './page.module.css';
import {useMowerMap} from '@/hooks/useMowerMap';

export default function SchedulePage() {
  useLang();
  const params = useMowerParams();
  const map = useMowerMap();
  // the areas a plan can pick from: mowing areas the mower actually mows
  const mowAreas = (map?.areas ?? []).filter(
    (a) => a.properties.type === 'mow' && a.properties.active !== false && a.properties.mowable !== false,
  );
  const datum = datumFromParams(params);
  // what MowBite's container on the mower can do
  const updates = useUpdates();
  // the cold check is a newer container's only, shown while that can't be told
  const hasCold = updates.level === null || containerHas(updates.level, 'cold');
  // today's sunrise and sunset, so the animal hint follows the real night
  const sun = datum ? sunTimes(datum.lat, datum.lon) : null;
  // undefined: loading, null: not served by the container
  const [schedule, setSchedule] = useState<Schedule | null | undefined>(cachedSchedule);
  const [log, setLog] = useState<LogEntry[]>(() => cachedScheduleLog() ?? []);
  const [error, setError] = useState<string | null>(null);
  const {knowsAction} = useMowerActions();
  const canTurn = useCanSetParams();

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
    // the position also gives the scheduler the sun times
    saveSchedule(next, datum ?? undefined).catch((e) =>
      setError(e instanceof Error ? e.message : tr('failed')),
    );
  };

  const s = schedule ?? EMPTY_SCHEDULE;
  const next = nextStart(s, undefined, sun);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <TitleRow>
          <h1>
            <TitleMark />
            {tr('Schedule')}
          </h1>
        </TitleRow>

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

            {error && <p className={styles.error}>{error}</p>}

            <section className={styles.card}>
              <h2>{tr('Start times')}</h2>
              {s.plans.length === 0 && <p className={styles.dim}>{tr('No start times yet.')}</p>}
              {s.plans.map((p, i) => (
                <PlanRow
                  key={i}
                  plan={p}
                  sun={sun}
                  mowAreas={mowAreas}
                  canReset={knowsAction(ACTION.resetJob)}
                  canTurn={canTurn}
                  onChange={(q) => update({...s, plans: s.plans.map((x, j) => (j === i ? q : x))})}
                  onRemove={() => update({...s, plans: s.plans.filter((_, j) => j !== i)})}
                />
              ))}
              <button className={styles.add} onClick={() => update({...s, plans: [...s.plans, {days: [1, 3, 5], time: '10:00', areas: []}]})}>
                + {tr('Add start time')}
              </button>
              {mowAreas.length > 1 && s.plans.length > 0 && (
                <p className={styles.dim}>{tr('With only some areas picked, it starts as usual and skips the others when their turn comes.')}</p>
              )}
            </section>

            {/* switched off it would do nothing, unless one runs already */}
            {s.plans.length > 0 && (s.enabled || !!s.pause) && <PauseCard schedule={s} mowAreas={mowAreas} update={update} />}

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
              <p className={styles.dim}>{tr("If the battery isn't that full at the start time, it waits up to two hours, then skips this start. Charged in the dock it counts as full, even when it went down a little since.")}</p>
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
                {tr('Not when it rains or rain is forecast for')}
                <select
                  className={styles.hours}
                  value={s.forecastHours}
                  disabled={!datum}
                  onChange={(e) => update({...s, forecastHours: Number(e.target.value)})}
                >
                  {FORECAST_HOURS.map((h) => (
                    <option key={h} value={h}>
                      {h === 1 ? tr('the next hour') : tr('the next {n} hours', {n: h})}
                    </option>
                  ))}
                </select>
              </label>
              {hasCold && (
              <label className={styles.check}>
                <input type="checkbox" checked={s.skipCold} disabled={!datum} onChange={(e) => update({...s, skipCold: e.target.checked})} />
                {tr('Not when it is colder than')}
                <select className={styles.hours} value={s.minTemp} disabled={!datum} onChange={(e) => update({...s, minTemp: Number(e.target.value)})}>
                  {COLD_TEMPS.map((c) => (
                    <option key={c} value={c}>
                      {c} °C
                    </option>
                  ))}
                </select>
              </label>
              )}
              <p className={styles.dim}>
                {hasCold ? (
                  <>
                    {tr('Cold grass takes mowing badly, below about 5 °C it hardly grows anyway.')}{' '}
                    {tr('The forecast and the temperature come from Open-Meteo, the mower asks for them with the position rounded to about a kilometer.')}
                  </>
                ) : (
                  tr('The forecast comes from Open-Meteo, the mower asks for it with the position rounded to about a kilometer.')
                )}
              </p>
              {canTurn && (
                <p className={styles.dim}>
                  {tr('Rain while it mows is up to the mower: {mode}.', {
                    mode: tr(paramField('rain_mode')!.choices![Number(params['/mower_logic/rain_mode'] ?? 0)] ?? ''),
                  })}{' '}
                  <Link href="/settings#openmower">{tr('Change')}</Link>
                </p>
              )}
            </section>

            <section className={styles.card}>
              <h2>{tr('What happened')}</h2>
              {log.length === 0 && <p className={styles.dim}>{tr('Nothing yet.')}</p>}
              <ul className={styles.log}>
                {log.slice(0, 20).map((l, i) => (
                  <li key={i} className={l.what === 'started' ? styles.good : l.what.startsWith('skip') || l.what === 'start_failed' ? styles.bad : undefined}>
                    <span className={styles.dim}>
                      {dayLabel(new Date(l.t * 1000))}, {clock(l.t)}
                    </span>
                    {scheduleLogLine(l)}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
