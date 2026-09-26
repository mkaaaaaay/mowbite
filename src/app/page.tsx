'use client';

import LogoMark from '@/components/Logo';
import MapView from '@/components/MapView';
import {HomeIcon, PlayIcon, SkipIcon, StopIcon, WarningIcon} from '@/components/icons';
import {useComputedSpeed} from '@/hooks/useComputedSpeed';
import {useMowerActions} from '@/hooks/useMowerActions';
import {useMowerMap} from '@/hooks/useMowerMap';
import {useMowerSensors} from '@/hooks/useMowerSensors';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {useMowerState, type MowerState} from '@/hooks/useMowerState';
import {useMowerTrack} from '@/hooks/useMowerTrack';
import {useRecentRuns} from '@/hooks/useRecentRuns';
import {clock, dayKey, dayLabel, duration} from '@/lib/dates';
import {OUTCOMES, type MowerEvent, type Run} from '@/lib/events';
import {settingsStore} from '@/lib/settings';
import {batteryColor, isDocked} from '@/lib/status';
import Link from 'next/link';
import {useSyncExternalStore} from 'react';
import styles from './page.module.css';

const DRIVING = new Set(['MOWING', 'DOCKING', 'UNDOCKING']);

const ACTION_RESET_EMERGENCY = 'mower_logic/reset_emergency';
const ACTIONS = [
  {id: 'mower_logic:idle/start_mowing', Icon: PlayIcon, label: 'Start', main: true},
  {id: 'mower_logic:mowing/pause', Icon: StopIcon, label: 'Pause'},
  {id: 'mower_logic:mowing/abort_mowing', Icon: HomeIcon, label: 'Go home'},
  {id: 'mower_logic:mowing/skip_area', Icon: SkipIcon, label: 'Skip area'},
];

// 999 = no fix (xbot_positioning)
const NO_FIX = 999;

function headline(state: MowerState, docked: boolean, chargeState: string | undefined, area: string | undefined) {
  if (state.emergency) return {title: 'Emergency stop', tone: 'error'};
  if (docked) return chargeState === 'Done' ? {title: 'Charged, in the dock', tone: 'good'} : {title: 'Charging in the dock', tone: 'good'};
  switch (state.current_state) {
    case 'MOWING':
      return {title: area ? `Mowing ${area}` : 'Mowing', tone: 'live'};
    case 'DOCKING':
      return {title: 'Heading home', tone: 'live'};
    case 'UNDOCKING':
      return {title: 'Leaving the dock', tone: 'live'};
    case 'PAUSED':
      return {title: 'Paused', tone: 'warn'};
    case 'AREA_RECORDING':
      return {title: 'Recording an area', tone: 'live'};
    case 'IDLE':
      return {title: 'Waiting on the lawn', tone: 'warn'};
    default:
      return {title: state.current_state.toLowerCase().replace(/_/g, ' '), tone: 'neutral'};
  }
}

function BatteryRing({percent, charging}: {percent: number; charging: boolean}) {
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
        {charging && <span>charging</span>}
      </div>
    </div>
  );
}

function LastRun({run}: {run: Run}) {
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
          {run.areas.join(', ') || 'no area'}
          {run.bladeSeconds > 0 && ` · mowed ${duration(run.bladeSeconds)}`}
        </span>
      </div>
      <span className={styles.badge}>{outcome.label}</span>
    </div>
  );
}

export default function Home() {
  const {state, connected} = useMowerState();
  const {hasAction, publishAction} = useMowerActions();
  const {values} = useMowerSensors();
  const position = useMowerPosition() ?? state?.pose;
  const speed = useComputedSpeed(position);
  const track = useMowerTrack();
  const map = useMowerMap();
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const recent = useRecentRuns(state?.current_state);

  const current = state?.current_state ?? '';
  const driving = DRIVING.has(current);
  const showMap = !!map && (driving || settings.dashboard?.map === 'always');
  const docked = isDocked(state, values['om_v_charge']);
  const battery = state ? Math.round(state.battery_percentage * 100) : 0;
  const chargeState = values['om_charge_state'];
  const charging = docked && chargeState !== 'Done';

  // what the event history knows: since when this state holds and which area is being mowed
  const events = recent?.today ?? [];
  const lastOf = (f: (e: MowerEvent) => boolean) => events.filter(f).pop();
  const since = lastOf((e) => e.type === 'STATE' && e.state === current)?.t;
  const area = current === 'MOWING' ? lastOf((e) => e.type === 'AREA')?.area_name : undefined;
  const head = state ? headline(state, docked, chargeState, area) : null;

  const acc = state?.pose.pos_accuracy;
  const num = (id: string) => (values[id] !== undefined ? Number(values[id]) : undefined);
  const motorTemp = Math.max(...['om_left_esc_temp', 'om_right_esc_temp', 'om_mow_esc_temp'].map((id) => num(id) ?? -Infinity));
  const facts: {label: string; value: string; warn?: boolean}[] = [];
  if (state) {
    facts.push({
      label: 'GPS',
      value: acc === undefined || acc >= NO_FIX ? (driving ? 'no fix' : 'off') : `${(acc * 100).toFixed(1)} cm`,
      warn: driving && (acc === undefined || acc >= NO_FIX || acc > 0.1),
    });
    if (driving) facts.push({label: 'Speed', value: `${speed.toFixed(2)} m/s`});
    if (charging && num('om_charge_current') !== undefined) facts.push({label: 'Charging', value: `${num('om_charge_current')!.toFixed(1)} A`});
    if (num('om_v_battery') !== undefined) facts.push({label: 'Battery', value: `${num('om_v_battery')!.toFixed(1)} V`});
    if (motorTemp > -Infinity) facts.push({label: 'Motors', value: `${Math.round(motorTemp)} °C`, warn: motorTemp > 70});
    if (state.rain_detected) facts.push({label: 'Rain', value: 'detected', warn: true});
  }

  const runs = recent?.runs ?? [];
  const mowed = runs.reduce((s, r) => s + r.bladeSeconds, 0);
  const problems = runs.reduce((s, r) => s + r.problems, 0);

  return (
    <div className={styles.page}>
      <main className={[styles.main, showMap ? styles.withMap : ''].join(' ')}>
        <h1 className={styles.brand}>
          <LogoMark size={40} />
          <span>
            <strong>mow</strong>mate
          </span>
        </h1>

        {!state && <p className={styles.dim}>{connected ? 'waiting for the mower…' : 'connecting…'}</p>}

        {state && head && (
          <section className={[styles.status, styles[`tone-${head.tone}`]].join(' ')}>
            <div className={styles.statusTop}>
              <BatteryRing percent={battery} charging={charging} />
              <div className={styles.headline}>
                <h2>{head.title}</h2>
                <span className={styles.dim}>
                  {state.emergency
                    ? 'Release the mower, then reset the emergency to drive again.'
                    : since
                      ? `since ${clock(since)}`
                      : connected
                        ? ''
                        : 'connection lost'}
                </span>
              </div>
            </div>

            <div className={styles.facts}>
              {facts.map((f) => (
                <div key={f.label} className={f.warn ? styles.warn : undefined}>
                  <span>{f.label}</span>
                  <strong>{f.value}</strong>
                </div>
              ))}
            </div>

            <div className={styles.controls}>
              {ACTIONS.map((a) => (
                <button key={a.id} className={a.main ? styles.main : undefined} disabled={!hasAction(a.id)} onClick={() => publishAction(a.id)}>
                  <a.Icon size={20} />
                  {a.label}
                </button>
              ))}
              {!!state.emergency && (
                <button className={styles.reset} onClick={() => publishAction(ACTION_RESET_EMERGENCY)}>
                  <WarningIcon size={20} />
                  Reset emergency
                </button>
              )}
            </div>
          </section>
        )}

        {showMap && map && (
          <section className={styles.map}>
            <MapView map={map} mower={position} track={track} follow={driving} zoomable />
          </section>
        )}

        {recent && (
          <section className={styles.today}>
            <div className={styles.todayHead}>
              <h2>Today</h2>
              <Link href="/activity">Activity</Link>
            </div>
            <div className={styles.todayNumbers}>
              <div>
                <strong>{mowed ? duration(mowed) : '0 min'}</strong>
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
            </div>
            {recent.last && (
              <>
                <span className={styles.label}>Last run</span>
                <LastRun run={recent.last} />
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
