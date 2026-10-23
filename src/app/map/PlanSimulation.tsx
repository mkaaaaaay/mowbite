'use client';

import type {PlanRequest} from '@/lib/areaPlan';
import {fmt, tr} from '@/lib/i18n';
import {RPC} from '@/lib/openmower';
import {RpcError, rpcMethods} from '@/lib/rpc';
import {
  cancelSimulation,
  canCancelSimulation,
  SIM_SPEEDS,
  simulate,
  simulationProgress,
  type SimClock,
  type SimModel,
  type SimResult,
} from '@/lib/simulate';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import styles from './page.module.css';

// a simulation that came, for the plan asked for (key) and whether it's on the map
export interface ShownSim {
  key: string;
  model: SimModel;
  result: SimResult;
  shown: boolean;
}

const PHASES: Record<string, string> = {
  planning: 'planning',
  simulating: 'driving',
  evaluating: 'looking at the drive',
};

const minutes = (m: number) => fmt(m, m < 10 ? 1 : 0);

// The selected area's plan driven by the MowBite Planner the way the mower would (planner.simulate): what it leaves, where
// the body gets into the margin, where the controller would give up and how long it takes, shown on the map and played
// back there. Asked on demand, on the mower it takes about half a minute for ten minutes of mowing. Only for the plan it
// was asked for: anything changed (the angle, a point) and it's gone
export function PlanSimulation({request, sim, onResult, onShow}: {
  request: PlanRequest | null;
  // the last one for this request
  sim: ShownSim | null;
  onResult: (sim: ShownSim) => void;
  onShow: (shown: boolean) => void;
}) {
  const [known, setKnown] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const [model, setModel] = useState<SimModel>('realistic');
  const [running, setRunning] = useState<{key: string; since: number} | null>(null);
  const [progress, setProgress] = useState<{phase: string; fraction: number} | null>(null);
  const [error, setError] = useState<{key: string; text: string} | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // the run waited for (0: none), a run stopped or followed by another one is dropped when it comes
  const runs = useRef(0);
  const waiting = useRef(0);
  const key = request ? JSON.stringify(request) : '';

  useEffect(() => {
    let alive = true;
    void rpcMethods().then((m) => alive && setKnown(!!m?.has(RPC.plannerSimulate)));
    void canCancelSimulation().then((c) => alive && setCanCancel(c));
    return () => {
      alive = false;
    };
  }, []);
  // while it runs: the seconds, and how far it got when the planner tells
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setElapsed(Math.round((Date.now() - running.since) / 1000));
      void simulationProgress().then(setProgress, () => setProgress(null));
    }, 1000);
    return () => {
      clearInterval(timer);
      setProgress(null);
    };
  }, [running]);

  if (!known || !request) return null;

  const run = async () => {
    const asked = key;
    const id = ++runs.current;
    waiting.current = id;
    setRunning({key: asked, since: Date.now()});
    setElapsed(0);
    setError(null);
    try {
      const result = await simulate(request, model);
      if (waiting.current === id) onResult({key: asked, model, result, shown: true});
    } catch (e) {
      if (waiting.current === id && !(e instanceof RpcError && e.message === 'cancelled')) {
        setError({
          key: asked,
          text:
            e instanceof RpcError && e.code !== 'timeout'
              ? e.message === 'a simulation is running'
                ? tr('The planner is already driving another plan, try again in a moment.')
                : e.message
              : tr('The mower did not answer.'),
        });
      }
    } finally {
      if (waiting.current === id) {
        waiting.current = 0;
        setRunning(null);
      }
    }
  };
  const stop = () => {
    waiting.current = 0;
    if (canCancel) void cancelSimulation().catch(() => {});
    setRunning(null);
  };

  const busy = running?.key === key;
  const result = sim?.key === key ? sim : null;
  const r = result?.result;
  const worst = r?.touches.reduce((m, t) => Math.max(m, t.m), 0) ?? 0;
  return (
    <div className={styles.simulation}>
      <div className={styles.simulationRow}>
        <button className={styles.pillButton} onClick={() => void run()} disabled={!!running}>
          {busy ? tr('Driving it…') : r ? tr('Drive it again') : tr('Simulate the drive')}
        </button>
        <div className={styles.simModel} role="radiogroup" aria-label={tr('Mower')}>
          {(['realistic', 'ideal'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={model === m} className={model === m ? styles.simModelOn : undefined} onClick={() => setModel(m)} disabled={!!running}>
              {m === 'realistic' ? tr('realistic') : tr('ideal')}
            </button>
          ))}
        </div>
      </div>
      {!r && !busy && (
        <span className={styles.dim}>
          {tr(
            "The planner drives the plan the way your mower would: OpenMower's controller with the errors of GPS, wheels and drive (realistic) or a mower that drives exactly (ideal). It shows what's left unmowed, where the body gets into the safety distance and how long it takes. On the mower that takes about half a minute for ten minutes of mowing.",
          )}
        </span>
      )}
      {busy && (
        <span className={styles.dim}>
          {progress
            ? tr('{what}, {pct} %', {what: tr(PHASES[progress.phase] ?? progress.phase), pct: Math.round(progress.fraction * 100)})
            : tr('{s} s', {s: elapsed})}{' '}
          <button className={styles.simLink} onClick={stop}>
            {canCancel ? tr('Stop simulating') : tr("Don't wait")}
          </button>
        </span>
      )}
      {error?.key === key && <span className={styles.warningText}>{error.text}</span>}
      {r && (
        <>
          <span>
            {tr('{all} min ({mow} min of it mowing)', {all: minutes(r.minutes.all), mow: minutes(r.minutes.mow)})}
            {r.minutes.plan !== undefined && `, ${tr('the plan says {min} min', {min: minutes(r.minutes.plan)})}`}
          </span>
          {r.left.length > 0 ? (
            <span className={styles.warningText}>
              {tr('{m2} m² left unmowed in {n} places (orange on the map)', {m2: fmt(r.leftM2, r.leftM2 < 1 ? 2 : 1), n: r.left.length})}
              {r.plannedLeftM2 !== undefined && `, ${tr('the plan alone leaves {m2} m²', {m2: fmt(r.plannedLeftM2, r.plannedLeftM2 < 1 ? 2 : 1)})}`}
            </span>
          ) : (
            <span className={styles.dim}>{tr('Nothing worth mentioning left unmowed.')}</span>
          )}
          {r.touches.length > 0 && (
            <span className={worst >= 0.05 ? styles.warningText : styles.dim}>
              {tr('The body gets into the safety distance at {n} places, up to {cm} cm. From about 5 cm it touches the real edge.', {
                n: r.touches.length,
                cm: fmt(worst * 100, 1),
              })}
            </span>
          )}
          {r.navErrors.length > 0 && (
            <span className={styles.warningText}>
              {r.navErrors.length === 1
                ? tr('1 place where the controller would give up (cross on the map)')
                : tr('{n} places where the controller would give up (crosses on the map)', {n: r.navErrors.length})}
            </span>
          )}
          {r.aborted && <span className={styles.warningText}>{tr('OpenMower would give up the area.')}</span>}
          {r.offPlan && (
            <span className={styles.dim}>
              {tr('Off the plan on the lanes: usually {usual} cm, at most {max} cm.', {usual: fmt(r.offPlan.usual * 100, 1), max: fmt(r.offPlan.max * 100, 0)})}
            </span>
          )}
          <button className={styles.simLink} onClick={() => onShow(!result.shown)}>
            {result.shown ? tr('Hide it on the map') : tr('Show it on the map')}
          </button>
        </>
      )}
    </div>
  );
}

const clockTime = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

// the simulated drive played back on the map: play and pause, where it is, how fast, closing it
export function SimPlayer({clock, onClose}: {clock: SimClock; onClose: () => void}) {
  const state = useSyncExternalStore(clock.listen, clock.snapshot, clock.snapshot);
  const [, tick] = useState(0);
  const ended = clock.time() >= clock.end;
  // the time shown moves on while it plays
  useEffect(() => {
    if (!state.playing) return;
    const timer = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, [state.playing]);
  const now = clock.time();
  const playing = state.playing && !ended;
  return (
    <div className={styles.simPlayer} data-no-swipe>
      <button className={styles.simPlay} onClick={() => (playing ? clock.pause() : clock.play())} aria-label={playing ? tr('Pause') : tr('Play')}>
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.round(clock.end))}
        step={1}
        value={Math.round(now)}
        onChange={(e) => clock.seek(Number(e.target.value))}
        aria-label={tr('Time in the drive')}
      />
      <span className={styles.simTime}>
        {clockTime(now)} / {clockTime(clock.end)}
      </span>
      <button
        className={styles.simSpeed}
        onClick={() => clock.setSpeed(SIM_SPEEDS[(SIM_SPEEDS.indexOf(state.speed) + 1) % SIM_SPEEDS.length])}
        aria-label={tr('Speed')}
      >
        ×{state.speed}
      </button>
      <button className={styles.simClose} onClick={onClose} aria-label={tr('Close')}>
        ×
      </button>
    </div>
  );
}

