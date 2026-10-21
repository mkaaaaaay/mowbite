'use client';

import {BrandMark} from '@/components/BrandMark';
import {DontPanic} from '@/components/DontPanic';
import {useEggForced, useHalloween, useUmbrella} from '@/lib/eggs';
import LogicHint from '@/components/LogicHint';
import LoveMower from '@/components/LoveMower';
import MapView from '@/components/MapView';
import {HomeIcon, PauseIcon, PlayIcon, SkipIcon, WarningIcon} from '@/components/icons';
import {useComputedSpeed} from '@/hooks/useComputedSpeed';
import {useEmergencyReasons} from '@/hooks/useEmergencyReasons';
import {useLeftoversBefore} from '@/hooks/useLeftoversBefore';
import {useMowerActions} from '@/hooks/useMowerActions';
import {useMowerMap} from '@/hooks/useMowerMap';
import {datumFromParams, numParam, useMowerParams} from '@/hooks/useMowerParams';
import {sunTimes} from '@/lib/sun';
import {useMowerSensors, type SensorInfo} from '@/hooks/useMowerSensors';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {isLive, useMowerState, type MowerState} from '@/hooks/useMowerState';
import {useMowerTrack} from '@/hooks/useMowerTrack';
import {useMowerWifi} from '@/hooks/useMowerWifi';
import {wifiLevel} from '@/lib/coverage';
import {usePlanProgress} from '@/hooks/usePlanProgress';
import {useRecentRuns} from '@/hooks/useRecentRuns';
import TopWeather from '@/components/TopWeather';
import {clock, dayKey, dayLabel, duration} from '@/lib/dates';
import {emergencyText, OUTCOMES, type MowerEvent, type Run} from '@/lib/events';
import {settingsStore} from '@/lib/settings';
import {PARTS, useDueParts} from '@/lib/stats';
import {containerHas, useUpdates} from '@/lib/updates';
import {batteryColor, GPS_QUALITY_LABEL, gpsQuality, isDocked, onCharger, WIFI_LEVEL_LABEL} from '@/lib/status';
import Link from 'next/link';
import {memo, useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import styles from './page.module.css';
import {fmt, tr, useLang} from '@/lib/i18n';
import {
  cachedSchedule,
  cachedScheduleLog,
  loadSchedule,
  loadScheduleLog,
  missedStart,
  nextStart,
  scheduleLogLine,
  type LogEntry,
  type Schedule,
} from '@/lib/schedule';
import {LeftoversCard} from '@/components/Leftovers';
import MowerSwitch from '@/components/MowerSwitch';
import {UpdateBanner} from '@/components/Updates';
import {ACTION, PARAM} from '@/lib/openmower';

// paused counts too, the mower is standing somewhere on the lawn then. recording drives with gps as well
const DRIVING = new Set(['MOWING', 'PAUSED', 'DOCKING', 'UNDOCKING', 'AREA_RECORDING']);

const ACTION_RESET_EMERGENCY = ACTION.resetEmergency;
// skipping an area or a path drops what's left of it, so it goes out only after a few seconds and a second tap takes
// it back
const SKIP_DELAY = 4;
// the left out start that was closed, by its time
const MISSED_SEEN_KEY = 'scheduleMissedSeen';
const ACTIONS = [
  {id: ACTION.startMowing, Icon: PlayIcon, label: 'Start', main: true},
  {id: ACTION.pause, Icon: PauseIcon, label: 'Pause'},
  {id: ACTION.goHome, Icon: HomeIcon, label: 'Go home'},
  {id: ACTION.skipArea, Icon: SkipIcon, label: 'Skip area'},
];


// every temperature of the mower in a fixed order, the blade side first, then the wheels, unknown ones after them.
// Hot from the limit OpenMower gives the sensor (max_pcb_temp of an ESC, the mow motor's motor_hot_temperature),
// 70 °C without one. max_value counts on its own: OpenMower sets has_min_max only when there's a min as well
const TEMP_ORDER: [string, string][] = [
  ['om_mow_motor_temp', 'Mow motor'],
  ['om_mow_esc_temp', 'Mow ESC'],
  ['om_left_esc_temp', 'Left ESC'],
  ['om_right_esc_temp', 'Right ESC'],
];
function temperatures(infos: SensorInfo[], values: Record<string, string>) {
  const rank = (id: string) => {
    const i = TEMP_ORDER.findIndex(([k]) => k === id);
    return i < 0 ? TEMP_ORDER.length : i;
  };
  return infos
    .filter((info) => info.value_description === 'TEMPERATURE' && Number.isFinite(Number(values[info.sensor_id])))
    .map((info) => {
      const value = Number(values[info.sensor_id]);
      const limit = info.max_value > 0 ? info.max_value : info.has_critical_high && info.upper_critical_value > 0 ? info.upper_critical_value : 70;
      const name = TEMP_ORDER.find(([k]) => k === info.sensor_id)?.[1];
      return {id: info.sensor_id, label: name ? tr(name) : info.sensor_name, value: `${Math.round(value)} °C`, warn: value >= limit};
    })
    .sort((a, b) => rank(a.id) - rank(b.id) || a.label.localeCompare(b.label));
}

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// which ones get a whole row: the wide ones and one left without a partner, so every row is filled
function wholeRow(items: {label: string; wide?: boolean}[]): boolean[] {
  const whole = items.map((f) => !!f.wide);
  let single = -1;
  items.forEach((f, i) => {
    if (f.wide && single >= 0) whole[single] = true;
    single = f.wide || single >= 0 ? -1 : i;
  });
  if (single >= 0) whole[single] = true;
  return whole;
}

// the first part of a value stands out, what follows after " · " (how good, time left) is plainer
function FactValue({value}: {value: string}) {
  const [main, ...rest] = value.split(' · ');
  return (
    <strong>
      {main}
      {rest.length > 0 && <small> · {rest.join(' · ')}</small>}
    </strong>
  );
}

function headline(state: MowerState, docked: boolean, charger: boolean, chargeState: string | undefined, area: string | undefined) {
  if (state.emergency) return {title: tr('Emergency stop'), tone: 'error'};
  // left on in the dock it says so, it's why the map shows. docked is idle only, so it's the station's contacts here
  if (state.current_state === 'AREA_RECORDING') return {title: charger ? tr('Recording mode, in the dock') : tr('Recording an area'), tone: 'live'};
  if (docked) return chargeState === 'Done' ? {title: tr('Charged, in the dock'), tone: 'good'} : {title: tr('Charging in the dock'), tone: 'good'};
  switch (state.current_state) {
    case 'MOWING':
      return {title: area ? tr('Mowing {area}', {area}) : tr('Mowing'), tone: 'live'};
    case 'DOCKING':
      return {title: tr('Heading home'), tone: 'live'};
    case 'UNDOCKING':
      return {title: tr('Leaving the dock'), tone: 'live'};
    case 'PAUSED':
      return {title: tr('Paused'), tone: 'warn'};
    case 'IDLE':
      return {title: tr('Waiting on the lawn'), tone: 'warn'};
    default:
      return {title: state.current_state.toLowerCase().replace(/_/g, ' '), tone: 'neutral'};
  }
}

function BatteryRing({percent}: {percent: number}) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className={[styles.ring, styles[`ring-${batteryColor(percent)}`]].join(' ')}>
      <svg viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} className={styles.ringBg} />
        <circle cx="40" cy="40" r={r} className={styles.ringFill} strokeDasharray={`${(c * percent) / 100} ${c}`} />
      </svg>
      <div>
        <strong>{percent}%</strong>
      </div>
    </div>
  );
}

const LastRun = memo(function LastRun({run}: {run: Run}) {
  const outcome = OUTCOMES[run.outcome];
  const day = new Date(run.start * 1000);
  const today = dayKey(day) === dayKey(new Date());
  return (
    <div className={[styles.lastRun, styles[`run-${outcome.tone}`]].join(' ')}>
      <div>
        <strong>
          {!today && `${dayLabel(day)}, `}
          {clock(run.start)} – {clock(run.end)}
        </strong>
        <span className={styles.dim}>
          {run.areas.join(', ') || tr('no area')}
          {run.bladeSeconds > 0 && ` · ${tr('mowed {time}', {time: duration(run.bladeSeconds)})}`}
        </span>
      </div>
      <span className={styles.badge}>{tr(outcome.label)}</span>
    </div>
  );
});

export default function Home() {
  useLang();
  const link = useMowerState();
  const {state, connected} = link;
  // offline or no fresh state: what's shown is old and commands wouldn't arrive, so the buttons are off
  const live = isLive(link);
  const {hasAction, publishAction} = useMowerActions();
  const {infos, values} = useMowerSensors();
  const why = useEmergencyReasons(!!state?.emergency);
  const position = useMowerPosition() ?? state?.pose;
  const speed = useComputedSpeed(position);
  const track = useMowerTrack();
  const map = useMowerMap();
  const recent = useRecentRuns(state?.current_state);
  // the last finished mow, for what it left
  const leftoverJob = recent?.latest.find((r) => r.outcome === 'done' && r.areas.length > 0 && r.jobId)?.jobId;
  const progress = usePlanProgress(state ?? null, map, recent?.today);
  // driving the leftovers of the last mow: that mow's track, faded on the map
  const before = useLeftoversBefore(!!progress?.leftovers);
  const params = useMowerParams();
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  // the same object while params/json doesn't change: the map isn't drawn again for every sensor value
  const datum = useMemo(() => datumFromParams(params), [params]);
  // blades or cleaning due, counted by MowBite's container
  const updates = useUpdates();
  const due = useDueParts(updates.level !== null && containerHas(updates.level, 'stats'));
  const wifi = useMowerWifi();
  const [schedule, setSchedule] = useState<Schedule | null>(() => cachedSchedule() ?? null);
  // the scheduler's log, for a start it left out (rain, battery, ...). again every minute while the page is open
  const [scheduleLog, setScheduleLog] = useState<LogEntry[]>(() => cachedScheduleLog() ?? []);
  useEffect(() => {
    void loadSchedule().then(setSchedule);
    const loadLog = () => void loadScheduleLog().then(setScheduleLog);
    loadLog();
    const timer = setInterval(loadLog, 60000);
    return () => clearInterval(timer);
  }, []);
  // the left out start closed on this device, by its time
  const [missedSeen, setMissedSeen] = useState(() => {
    try {
      return Number(localStorage.getItem(MISSED_SEEN_KEY)) || 0;
    } catch {
      return 0;
    }
  });
  const missedAny = schedule?.enabled ? missedStart(scheduleLog) : null;
  const missed = missedAny && missedAny.t !== missedSeen ? missedAny : null;
  const planned = schedule ? nextStart(schedule, undefined, datum ? sunTimes(datum.lat, datum.lon) : null) : null;
  const [confirmReset, setConfirmReset] = useState(false);
  // three more runs unfolded under the last three
  const [moreRuns, setMoreRuns] = useState(false);
  // the two mowers meet in the title row, the weather makes room for them
  const [loveRun, setLoveRun] = useState(false);
  // a tapped skip (area or path) and the seconds until it goes out, null when none is waiting
  const [skip, setSkip] = useState<{id: string; left: number} | null>(null);
  useEffect(() => {
    if (skip === null) return;
    const t = setTimeout(() => {
      if (skip.left > 1) return setSkip({...skip, left: skip.left - 1});
      setSkip(null);
      publishAction(skip.id);
    }, 1000);
    return () => clearTimeout(t);
  }, [skip, publishAction]);
  const toggleSkip = (id: string) => setSkip(skip?.id === id ? null : {id, left: SKIP_DELAY});

  const current = state?.current_state ?? '';
  const driving = DRIVING.has(current);
  // a waiting skip is dropped when there's nothing to skip anymore or the connection went
  if (skip !== null && (!live || current !== 'MOWING' || !hasAction(skip.id))) setSkip(null);
  const showMap = !!map && (driving || settings.dashboard?.map === 'always');
  const docked = isDocked(state, values['om_v_charge']);
  const battery = state ? Math.round(state.battery_percentage * 100) : 0;
  const chargeState = values['om_charge_state'];
  const charging = docked && chargeState !== 'Done';

  // what the event history knows: since when this state holds and which area is being mowed
  const events = recent?.today ?? [];
  const lastOf = (f: (e: MowerEvent) => boolean) => events.filter(f).pop();
  // only when the newest state change is this state, older mowers don't record every one (a pause, say)
  const lastState = lastOf((e) => e.type === 'STATE');
  const since = lastState?.state === current ? lastState.t : undefined;
  const area = current === 'MOWING' ? lastOf((e) => e.type === 'AREA')?.area_name : undefined;
  const head = state ? headline(state, docked, onCharger(state, values['om_v_charge']), chargeState, area) : null;

  // dressed up: a towel at 42 %, an umbrella while it sits out the rain, a witch's hat on halloween
  const halloween = useHalloween();
  const umbrella = useUmbrella(recent?.latest[0]);
  // the preview ("eggForce" towel) shows the mow at 42 % too, so it's what one would see
  const towelPreview = useEggForced('towel');
  const towel = towelPreview || (!!progress && !progress.leftovers && Math.round(progress.fraction * 100) === 42);
  // the same object while nothing changes: the map isn't drawn again for every sensor value
  const costume = useMemo(() => ({towel, umbrella}), [towel, umbrella]);

  const acc = state?.pose.pos_accuracy;
  const gpsQ = gpsQuality(acc, numParam(params, PARAM.maxPositionAccuracy));
  const num = (id: string) => (values[id] !== undefined ? Number(values[id]) : undefined);
  const temps = state ? temperatures(infos, values) : [];
  // wide: gets a whole row, its value is longer
  const facts: {label: string; value: string; warn?: boolean; wide?: boolean; extra?: React.ReactNode}[] = [];
  // standing still the mower switches gps off, "off" there says nothing
  if (state && (driving || gpsQ !== 'none')) {
    facts.push({
      label: 'GPS',
      value:
        gpsQ === 'none' ? (driving ? tr('no fix') : tr('off')) : `${fmt(acc! * 100, 1)} cm · ${tr(GPS_QUALITY_LABEL[gpsQ])}`,
      // only an rtk fix is good while driving
      warn: driving && gpsQ !== 'fix',
    });
    if (driving) facts.push({label: tr('Speed'), value: `${fmt(speed, 2)} m/s`});
    if (progress?.leftovers) {
      // along the leftover passes when the planner worked them out again
      const known = progress.doneLength + progress.todoLength > 0;
      const left = known && progress.secondsLeft !== null ? ` · ${tr('{time} left', {time: duration(progress.secondsLeft)})}` : '';
      facts.push({
        label: tr('Progress'),
        value: known ? tr('leftovers {pct} %', {pct: Math.round(progress.fraction * 100)}) + left : tr('leftovers of the last mow'),
        wide: true,
        extra: before ? <span>{tr('its track faded on the map')}</span> : undefined,
      });
    }
    else if (progress) {
      const left = progress.secondsLeft !== null ? ` · ${tr('{time} left', {time: duration(progress.secondsLeft)})}` : '';
      const pct = towelPreview ? 42 : Math.round(progress.fraction * 100);
      facts.push({label: tr('Progress'), value: `${pct} %${left}`, wide: true, extra: pct === 42 ? <DontPanic /> : undefined});
    }
    if (charging && num('om_charge_current') !== undefined) facts.push({label: tr('Charging'), value: `${fmt(num('om_charge_current')!, 1)} A`});
    if (num('om_v_battery') !== undefined) facts.push({label: tr('Battery'), value: `${fmt(num('om_v_battery')!, 1)} V`});
    if (state.rain_detected) facts.push({label: tr('Rain'), value: tr('detected'), warn: true});
  }
  // the app and the correction data for gps come over it
  if (state && wifi !== undefined) {
    const level = wifiLevel(wifi);
    facts.push({label: tr('Wi-Fi'), value: `${wifi} dBm · ${tr(WIFI_LEVEL_LABEL[level])}`, warn: level === 'bad'});
  }

  const factRows = wholeRow(facts);
  const tempRows = wholeRow(temps);

  const runs = recent?.runs ?? [];
  const finished = (recent?.latest ?? []).filter((r) => r.outcome !== 'running');
  const mowed = runs.reduce((s, r) => s + r.bladeSeconds, 0);
  const problems = runs.reduce((s, r) => s + r.problems, 0);

  return (
    <div className={styles.page}>
      <main className={[styles.main, showMap ? styles.withMap : ''].join(' ')}>
        <div className={styles.top}>
          <h1 className={styles.brand}>
            <BrandMark hat={halloween.day} towel={towel} umbrella={umbrella} />
            <span>
              <strong>mow</strong>bite
            </span>
            <LoveMower onRun={setLoveRun} />
          </h1>
          <TopWeather away={loveRun} />
        </div>
        <MowerSwitch className={styles.mowerSwitch} />
        <UpdateBanner />

        {!state &&
          (link.silent ? (
            <div className={styles.dim}>
              <p className={styles.offline}>{tr("The rest of OpenMower answers, but mower_logic doesn't send its state.")}</p>
              <LogicHint className={styles.logicHint} />
            </div>
          ) : (
            <p className={styles.dim}>{connected ? tr('waiting for the mower…') : tr('connecting…')}</p>
          ))}

        {state && head && (
          <section className={[styles.status, live ? styles[`tone-${head.tone}`] : styles.stale].join(' ')}>
            <div className={styles.statusTop}>
              <BatteryRing percent={battery} />
              <div className={styles.headline}>
                <h2>{head.title}</h2>
                {!!state.emergency && why && <strong className={styles.reason}>{upperFirst(emergencyText(why))}</strong>}
                {live ? (
                  <span className={styles.dim}>
                    {state.emergency
                      ? tr('Release the mower, then reset the emergency to drive again.')
                      : since
                        ? tr('since {time}', {time: clock(since)})
                        : ''}
                  </span>
                ) : link.resuming ? (
                  <span className={styles.dim}>{tr('connecting…')}</span>
                ) : (
                  <span className={styles.offline}>
                    {tr(
                      !connected
                        ? 'Connection lost, last data at {time}'
                        : link.silent
                          ? "mower_logic hasn't sent its state since {time}, the rest of OpenMower answers"
                          : 'No data from the mower since {time}',
                      {time: clock(link.lastAt / 1000, true)},
                    )}
                  </span>
                )}
              </div>
            </div>
            {connected && link.silent && <LogicHint className={[styles.dim, styles.logicHint].join(' ')} />}

            {(facts.length > 0 || temps.length > 0) && (
              <div className={styles.factBlock}>
                {facts.length > 0 && (
                  <div className={styles.facts}>
                    {facts.map((f, i) => (
                      <div key={f.label} className={[f.warn ? styles.warn : '', factRows[i] ? styles.whole : ''].join(' ')}>
                        <span>{f.label}</span>
                        <FactValue value={f.value} />
                        {f.extra}
                      </div>
                    ))}
                  </div>
                )}
                {temps.length > 0 && (
                  <div className={styles.facts}>
                    {temps.map((f, i) => (
                      <div key={f.id} className={[f.warn ? styles.warn : '', tempRows[i] ? styles.whole : ''].join(' ')}>
                        <span>{f.label}</span>
                        <FactValue value={f.value} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className={styles.controls}>
              {/* first, the buttons below are locked until it's reset */}
              {!!state.emergency && (
                <button className={styles.reset} disabled={!live} onClick={() => publishAction(ACTION_RESET_EMERGENCY)}>
                  <WarningIcon size={20} />
                  {tr('Reset emergency')}
                </button>
              )}
              {ACTIONS.map((a) =>
                // paused: the pause button turns into continue. only by the state, the mower also offers continue
                // while mowing until it was paused once
                a.id === ACTION.pause && state.current_state === 'PAUSED' && hasAction(ACTION.resume)
                  ? {...a, id: ACTION.resume, Icon: PlayIcon, label: 'Continue'}
                  : a,
              ).map((a) => (
                <button
                  key={a.id}
                  className={a.main ? styles.main : undefined}
                  // the mower still offers start while the emergency stop is active, it has to be reset first
                  disabled={!live || !hasAction(a.id) || !!state.emergency}
                  onClick={() => (a.id === ACTION.skipArea ? toggleSkip(a.id) : publishAction(a.id))}
                >
                  <a.Icon size={20} />
                  {skip?.id === a.id ? tr('Undo ({n} s)', {n: skip.left}) : tr(a.label)}
                </button>
              ))}
              {live && current === 'MOWING' && hasAction(ACTION.skipPath) && !state.emergency && (
                <button
                  className={styles.skipPathButton}
                  title={tr('The mower leaves the rest of the outline pass or lanes it is on and goes on with the next ones.')}
                  onClick={() => toggleSkip(ACTION.skipPath)}
                >
                  <SkipIcon size={16} />
                  {skip?.id === ACTION.skipPath ? tr('Undo ({n} s)', {n: skip.left}) : tr('Skip this path')}
                </button>
              )}
              {live &&
                hasAction(ACTION.resetJob) &&
                !state.emergency &&
                (confirmReset ? (
                  <div className={styles.resetJob}>
                    <span>{tr('Drop the interrupted job? The next start mows from the beginning.')}</span>
                    <button
                      className={styles.reset}
                      onClick={() => {
                        publishAction(ACTION.resetJob);
                        setConfirmReset(false);
                      }}
                    >
                      {tr('Drop it')}
                    </button>
                    <button onClick={() => setConfirmReset(false)}>{tr('Cancel')}</button>
                  </div>
                ) : (
                  <button className={styles.resetJobButton} onClick={() => setConfirmReset(true)}>
                    {tr('Drop the interrupted job')}
                  </button>
                ))}
              {/* idle in the dock: what the last mow left, and mowing just that */}
              {live && hasAction(ACTION.startMowing) && !state.emergency && (
                <LeftoversCard
                  key={leftoverJob ?? ''}
                  jobId={leftoverJob}
                  map={map}
                  live={live}
                  onStart={() => publishAction(ACTION.startMowing)}
                  styles={styles}
                />
              )}
            </div>
            {/* a mower without a map yet: how to make one */}
            {map && map.areas.length === 0 && (
              <Link href="/guide" className={styles.firstMap}>
                <strong>{tr('No map yet')}</strong>
                <span>{tr('How to record it, step by step')}</span>
              </Link>
            )}
          </section>
        )}

        {showMap && map && (
          <section className={styles.map}>
            <MapView
              map={map}
              mower={position}
              emergency={!!state?.emergency}
              track={track}
              beforeTrack={before}
              progress={progress ?? undefined}
              costume={costume}
              follow={driving}
              zoomable
              datum={datum}
            />
          </section>
        )}

        {(recent || planned || missed || due.length > 0) && (
          <section className={styles.today}>
            <div className={styles.todayHead}>
              <h2>{tr('Today')}</h2>
              <Link href="/activity">{tr('All runs')}</Link>
            </div>
            {missed && (
              <div className={styles.missed}>
                <WarningIcon size={16} />
                <Link href="/schedule">
                  <strong>
                    {dayKey(new Date(missed.t * 1000)) === dayKey(new Date())
                      ? tr('Scheduled start at {time}', {time: clock(missed.t)})
                      : tr('Scheduled start yesterday at {time}', {time: clock(missed.t)})}
                  </strong>
                  <span>{scheduleLogLine(missed)}</span>
                </Link>
                <button
                  title={tr('Close')}
                  aria-label={tr('Close')}
                  onClick={() => {
                    setMissedSeen(missed.t);
                    try {
                      localStorage.setItem(MISSED_SEEN_KEY, String(missed.t));
                    } catch {}
                  }}
                >
                  ×
                </button>
              </div>
            )}
            {due.length > 0 && (
              <div className={styles.missed}>
                <WarningIcon size={16} />
                <Link href="/activity">
                  <strong>{tr('Maintenance due')}</strong>
                  <span>
                    {due
                      .map((d) => `${tr(PARTS[d.key].label)}: ${tr('{used} of {due} h', {used: fmt(d.used, d.used < 10 ? 1 : 0), due: d.due})}`)
                      .join(' · ')}
                  </span>
                </Link>
              </div>
            )}
            {recent && (
            <div className={styles.todayNumbers}>
              <div>
                <strong>{mowed ? duration(mowed) : '0 min'}</strong>
                <span>{tr('mowed')}</span>
              </div>
              <div>
                <strong>{runs.length}</strong>
                <span>{runs.length === 1 ? tr('run') : tr('runs')}</span>
              </div>
              <div className={problems ? styles.bad : undefined}>
                <strong>{problems}</strong>
                <span>{problems === 1 ? tr('problem') : tr('problems')}</span>
              </div>
            </div>
            )}
            {planned && (
              <Link href="/schedule" className={styles.nextRun}>
                {tr('Next start: {when}', {when: `${dayLabel(planned)}, ${clock(planned.getTime() / 1000)}`})}
              </Link>
            )}
            {/* the one under way is the status above */}
            {finished.length > 0 && (
              <>
                <span className={styles.label}>{finished.length > 1 ? tr('Last runs') : tr('Last run')}</span>
                <div className={styles.runList}>
                  {finished.slice(0, moreRuns ? 6 : 3).map((r) => (
                    <LastRun key={r.events[0].id} run={r} />
                  ))}
                  {finished.length > 3 && (
                    <button className={styles.moreRuns} onClick={() => setMoreRuns(!moreRuns)}>
                      {moreRuns ? tr('Show less') : tr('Show more')}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
