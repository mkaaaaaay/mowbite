'use client';

import {CheckIcon, CloseIcon, RotateIcon, SpeedIcon, TurnIcon, WarningIcon} from '@/components/icons';
import DrivePad from '@/components/DrivePad';
import Joystick from '@/components/Joystick';
import MapView from '@/components/MapView';
import {useEmergencyReasons} from '@/hooks/useEmergencyReasons';
import {useEmergencyReset} from '@/hooks/useEmergencyReset';
import {useMedia} from '@/hooks/useMedia';
import {useMowerMap} from '@/hooks/useMowerMap';
import {datumFromParams, numParam, useMowerParams} from '@/hooks/useMowerParams';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {useSensorValue} from '@/hooks/useMowerSensors';
import {isLive, useMowerState} from '@/hooks/useMowerState';
import {useMowerActions} from '@/hooks/useMowerActions';
import {lackDone, lacks, type CalibProgress, type Lack} from '@/lib/calibration';
import {missWatch, motionTracker, NO_MOTION, type Missed, type Motion} from '@/lib/calibMotion';
import {emergencyText, explain, resetRefusedText} from '@/lib/events';
import {fmt, tr} from '@/lib/i18n';
import {onTopic} from '@/lib/mqttClient';
import {ACTION, PARAM, TOPIC} from '@/lib/openmower';
import {GPS_QUALITY_LABEL, gpsQuality, onCharger} from '@/lib/status';
import {sendDrive} from '@/lib/teleop';
import {useEffect, useRef, useState} from 'react';
import rec from '../record/page.module.css';
import styles from './page.module.css';

// m/s at full stick, the turn rate follows along (as in the recorder)
const SPEEDS = [0.15, 0.25, 0.35, 0.5];
// sideways like the recorder: its key for a phone whose page doesn't turn (one choice for both), the map's zoom steps
const TURNED_KEY = 'recordTurned';
const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3];
const TURN_PER_SPEED = 3;
// how wide the lane on the map is, about a mower
const LANE_W = 0.5;
// a turn of one and a half rounds on the spot: it looks back after it, the runs go to and fro on one lane
const TURN_ROUNDS = 1.5;
// the run shown a fifth longer than the planner needs: it measures by the wheels, off by as much as the calibration finds
const RUN_SPARE = 1.2;
// the mower that much of the map's width above its middle, in the part the pill, the buttons and the stick leave free;
// how far from it that part reaches each way (in parts of the width), the spans the way back to the station picks from
const SHIFT = 0.14;
const FREE = {up: 0.22, down: 0.2, left: 0.44, right: 0.3};
const SPANS = [16, 24, 32, 48, 64, 96, 128];

// rounds as a reader takes them: quarters, ¼ ½ ¾
const quarters = (r: number) => {
  const q = Math.max(1, Math.ceil(r * 4 - 0.01));
  return `${Math.floor(q / 4) || ''}${['', '¼', '½', '¾'][q % 4]}`;
};

// what the mower does right now, from its poses as they come (only to show), and a run or turn the planner didn't count
function useMotion(progress: CalibProgress | null): {motion: Motion; missed: Missed | null} {
  const [seen, setSeen] = useState<{motion: Motion; missed: Missed | null}>({motion: NO_MOTION, missed: null});
  const counts = useRef(progress);
  useEffect(() => {
    counts.current = progress;
  }, [progress]);
  useEffect(() => {
    const track = motionTracker();
    let watch = missWatch();
    let shown = 0;
    let told: Missed | null = null;
    return onTopic(TOPIC.position, (payload) => {
      let p: {x: number; y: number; heading: number};
      try {
        const raw = JSON.parse(payload.toString());
        if (typeof raw.x !== 'number' || typeof raw.y !== 'number') return;
        p = {x: raw.x, y: raw.y, heading: raw.heading ?? 0};
      } catch {
        return;
      }
      const now = performance.now();
      const m = track(now / 1000, p);
      const c = counts.current;
      // (without a fix nothing counts, the planner drops the run and the turn going on: so does the watch)
      const counting = c && (!c.rtk || c.rtk.fixed) ? c : null;
      if (c && !counting) watch = missWatch();
      const missed = counting ? watch(now / 1000, m, counting.has, counting.need.run_m) : null;
      if (now - shown < 250 && missed === told) return;
      shown = now;
      told = missed;
      setSeen({motion: m, missed});
    });
  }, []);
  return seen;
}

// the tile of what's being driven (a turn since the last run, stops in it too), else the first one still missing. a run
// stays the one driven also once there are enough: after a turn it's the run that makes the turn count
function nowPart(list: Lack[], motion: Motion): Lack | null {
  const open = list.filter((l) => !lackDone(l));
  if (!open.length) return null;
  if (motion.doing === 'straight') return list.find((l) => l.part === 'straight') ?? open[0];
  const turning = Math.abs(motion.turned) >= 0.5;
  const doing = turning ? (motion.turned > 0 ? 'left' : 'right') : motion.doing === 'still' ? 'still' : null;
  return open.find((l) => l.part === doing) ?? open[0];
}

// how far the part being driven got, big under what to do now: green, filling up, ✓ once there
function Meter({share, label}: {share: number; label: string}) {
  const full = share >= 1;
  return (
    <span className={[styles.meter, full ? styles.meterFull : ''].join(' ')}>
      <span className={styles.meterTrack}>
        <span className={styles.meterFill} style={{width: `${Math.round(Math.min(1, share) * 100)}%`}} />
      </span>
      <b>
        {full ? '✓ ' : ''}
        {label}
      </b>
    </span>
  );
}
// rounds turned so far in quarters, rounded down
const turnedText = (r: number) => {
  const q = Math.floor(r * 4 + 0.01);
  return q === 0 ? '0' : `${Math.floor(q / 4) || ''}${['', '¼', '½', '¾'][q % 4]}`;
};

const TILE_ICON = {still: <span className={styles.ring} />, straight: <span className={styles.bar} />, left: <TurnIcon size={16} />, right: <TurnIcon size={16} />};
const TILE_NAME = {still: 'Stand {n} s', straight: 'Straight', left: 'Turn left', right: 'Turn right'};

// driving by hand for the calibration, like the recorder: the map following the mower with the stick on it, under it
// what's done and what's missing (the planner's counts), what to do now on the map
// home: after the recording, back onto the docking station (no tiles, it ends recording mode). placing: before it, the
// mower driven into position, then started (onStart; starting while the planner is asked)
export default function Drive({
  progress,
  since,
  home,
  placing,
  starting,
  onStart,
  onStop,
  onDone,
}: {
  progress: CalibProgress | null;
  // when it started, else since the page shows it
  since: number | null;
  home?: boolean;
  placing?: boolean;
  starting?: boolean;
  onStart?: () => void;
  onStop: () => void;
  onDone: () => void;
}) {
  const link = useMowerState();
  const {state} = link;
  const live = isLive(link);
  const {hasAction, publishAction} = useMowerActions();
  const map = useMowerMap();
  const params = useMowerParams();
  const position = useMowerPosition() ?? state?.pose;
  const {motion, missed} = useMotion(home || placing ? null : progress);
  const why = useEmergencyReasons(!!state?.emergency);
  const {refused, reset} = useEmergencyReset(!!state?.emergency, publishAction);
  const canDrive = state?.current_state === 'AREA_RECORDING' && live && !state?.emergency;

  // held sideways on a phone: the recorder's remote control over the whole screen, a pad for forward and back on the
  // left and one for steering on the right. turned: the same drawn a quarter turn for a phone whose page doesn't turn
  const sideways = useMedia('(orientation: landscape) and (max-height: 500px)');
  const portrait = useMedia('(orientation: portrait)');
  const [turnedOn, setTurnedOn] = useState(() => {
    try {
      return localStorage.getItem(TURNED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const turnSideways = (on: boolean) => {
    setTurnedOn(on);
    try {
      localStorage.setItem(TURNED_KEY, on ? '1' : '0');
    } catch {}
  };
  const turned = turnedOn && !sideways && portrait;
  const remote = sideways || turned;
  const [zoom, setZoom] = useState(2);

  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(SPEEDS[1]);
  const stick = useRef({x: 0, y: 0});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const send = () => {
    const {x, y} = stick.current;
    const curve = (v: number) => Math.sign(v) * Math.abs(v) ** 1.6;
    const v = speedRef.current;
    sendDrive(curve(y) * v, -curve(x) * v * TURN_PER_SPEED);
  };
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stick.current = {x: 0, y: 0};
    sendDrive(0, 0);
  };
  const onStick = (x: number, y: number) => {
    stick.current = {x, y};
    if (x === 0 && y === 0) return stop();
    if (!timer.current) {
      send();
      timer.current = setInterval(send, 100);
    }
  };
  // emergency, a lost connection or the mode ending stop it as well. so does a switch between upright, sideways and
  // turned: the stick or pad under the finger is gone then without having been let go
  useEffect(() => {
    if (!timer.current) return;
    clearInterval(timer.current);
    timer.current = null;
    stick.current = {x: 0, y: 0};
    sendDrive(0, 0);
  }, [canDrive, remote, turned]);
  // leaving the page or putting the phone away stops the mower
  useEffect(() => {
    const hidden = () => {
      if (!document.hidden || !timer.current) return;
      clearInterval(timer.current);
      timer.current = null;
      sendDrive(0, 0);
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      if (timer.current) {
        clearInterval(timer.current);
        sendDrive(0, 0);
      }
    };
  }, []);

  // the time since it started, a second at a time
  const [now, setNow] = useState(() => Date.now());
  const [shown] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const took = Math.max(0, Math.floor((now - (since ?? shown)) / 1000));
  const clock = `${Math.floor(took / 60)}:${String(took % 60).padStart(2, '0')}`;

  const list = home || placing || !progress ? [] : lacks(progress);
  // recorded but no RTK fix: nothing counts till it's there (planner v0.4.0 on)
  const waiting = !home && !placing && progress?.phase === 'recording' && !!progress.rtk && !progress.rtk.fixed;
  const all = list.length > 0 && list.every(lackDone);
  const current = nowPart(list, motion);
  const runNeed = progress?.need.run_m ?? 5;
  const runM = Math.ceil(runNeed * RUN_SPARE * 2) / 2;
  // back to the station: how far it is, the map wide enough to show both; on its contacts recording mode ends
  const pose = motion.pose ?? position ?? null;
  const dock = map?.docking_stations[0]?.position;
  const toDock = home && dock && pose ? Math.hypot(dock.x - pose.x, dock.y - pose.y) : null;
  // (a step of SPANS: the map isn't drawn again for every move; a metre more for the station itself)
  const reach =
    home && dock && pose
      ? Math.max((Math.abs(dock.x - pose.x) + 1) / (dock.x > pose.x ? FREE.right : FREE.left), (Math.abs(dock.y - pose.y) + 1) / (dock.y > pose.y ? FREE.up : FREE.down))
      : 0;
  const span = SPANS.find((s) => s >= reach) ?? SPANS[SPANS.length - 1];
  const charging = onCharger(state, useSensorValue('om_v_charge', (v) => v));
  const [sure, setSure] = useState(false);
  // cancel takes two taps: the first asks for a few seconds (the cross sits next to the speeds)
  const [askCancel, setAskCancel] = useState(false);
  useEffect(() => {
    if (!askCancel) return;
    const t = setTimeout(() => setAskCancel(false), 4000);
    return () => clearTimeout(t);
  }, [askCancel]);
  const cancelTap = () => {
    if (!askCancel) return setAskCancel(true);
    setAskCancel(false);
    stop();
    onStop();
  };

  // a turn of this way: how much of it is left; done, the run that makes it count is next
  const turnPart = current?.part === 'left' || current?.part === 'right';
  const thisWay = turnPart && motion.doing !== 'straight' && motion.turned !== 0 && motion.turned > 0 === (current?.part === 'left');
  const togo = TURN_ROUNDS - (thisWay ? Math.abs(motion.turned) / (2 * Math.PI) : 0);
  const runNext = turnPart && togo <= 0.1;

  // what to do now, on the map: what's driven, else what's missing next
  let say: React.ReactNode;
  if (placing) {
    say = (
      <>
        <b>{tr('Drive the mower into position with the joystick')}</b> · {tr('then start the calibration')}
      </>
    );
  } else if (home) {
    say =
      toDock !== null && toDock > 0.5 && !charging ? (
        <>
          <b>{tr('Back onto the docking station')}</b> · {tr('{m} m to go', {m: fmt(toDock, 1)})}
        </>
      ) : (
        <b>{tr(charging ? 'On the station. Now end recording mode.' : 'Back onto the docking station')}</b>
      );
  } else if (waiting) {
    say = (
      <>
        <b>{tr('Waiting for an RTK fix')}</b> · {tr('nothing counts until then')}
      </>
    );
  } else if (all) {
    say = (
      <>
        <b>{tr('Enough driven.')}</b> {tr('More makes it more accurate.')}
      </>
    );
  } else if (!current) {
    say = <b>{tr('Drive straight runs and turns, the planner counts along.')}</b>;
  } else if (current.part === 'still') {
    say = (
      <>
        <b>{tr('Let go of the stick')}</b> · {tr('{n} s more standing still', {n: Math.max(1, Math.ceil(current.left))})}
      </>
    );
  } else if (current.part === 'straight') {
    const left = motion.doing === 'straight' ? Math.max(0, runM - motion.run) : runM;
    say =
      left > 0 ? (
        <>
          <b>{tr('Straight to the line')}</b> · {tr('{m} m to go', {m: fmt(left, 1)})}
        </>
      ) : (
        <>
          <b>{tr('This run counts.')}</b> {tr('Drive on or stop gently.')}
        </>
      );
  } else {
    // one turn at a time: up to one and a half rounds, then a run (only with it the planner counts the turn)
    const left = current.part === 'left';
    say =
      !runNext ? (
        <>
          <b>{tr(left ? 'Turn left round' : 'Turn right round')}</b> ·{' '}
          {togo >= TURN_ROUNDS
            ? tr('one and a half rounds, until it looks back')
            : togo > 1
              ? tr('{r} rounds to go', {r: quarters(togo)})
              : tr('{r} round to go', {r: quarters(togo)})}
        </>
      ) : (
        <>
          <b>{tr('Now {m} m straight on', {m: fmt(runM, 0)})}</b> · {tr('then the turn counts')}
        </>
      );
  }

  const missedText = missed && !waiting && (
    <em className={styles.missed}>
      {missed.part === 'straight'
        ? tr('Run not counted: by the wheels under {m} m. Drive the next one a bit longer.', {m: fmt(runNeed, 0)})
        : tr('Turn not counted: by the wheels it turned too little.')}
    </em>
  );

  // the bar under it: the run in m, the turn in rounds, the stand in s
  let bar: {share: number; label: string} | null = null;
  if (!home && current && !waiting) {
    if (current.part === 'still') {
      bar = {share: current.need ? current.has / current.need : 0, label: tr('{a} of {b} s', {a: fmt(Math.min(current.has, current.need), 0), b: fmt(current.need, 0)})};
    } else if (current.part === 'straight' || runNext) {
      const got = motion.doing === 'straight' ? motion.run : 0;
      bar = {share: got / runM, label: tr('{a} of {b} m', {a: fmt(Math.min(got, runM), 1), b: fmt(runM, 0)})};
    } else {
      const r = thisWay ? Math.abs(motion.turned) / (2 * Math.PI) : 0;
      bar = {share: r / TURN_ROUNDS, label: tr('{a} of {b} rounds', {a: turnedText(Math.min(r, TURN_ROUNDS)), b: '1½'})};
    }
  }

  // the lane of the run (from where it started, or ahead of the mower when a run is next), the turn round the mower,
  // the ring filling while it stands
  const draw = ({toScreen, scale, k}: {toScreen: (x: number, y: number) => [number, number]; scale: number; k: number}) => {
    // on the way back the station, small at this zoom, marked
    if (home) {
      if (!dock) return null;
      const [sx, sy] = toScreen(dock.x, dock.y);
      return (
        <g className={styles.station}>
          <circle cx={sx} cy={sy} r={14 * k} strokeWidth={3 * k} />
          <text x={sx} y={sy - 22 * k} fontSize={12 * k} textAnchor="middle">
            {tr('Docking station')}
          </text>
        </g>
      );
    }
    if (!pose || !current) return null;
    // a run being driven or next (also the one after a turn)
    if (current.part === 'straight' || runNext) {
      const from = motion.doing === 'straight' && motion.from ? motion.from : pose;
      const h = motion.doing === 'straight' && motion.from ? Math.atan2(pose.y - from.y, pose.x - from.x) : pose.heading;
      const at = (along: number, side: number) => toScreen(from.x + Math.cos(h) * along - Math.sin(h) * side, from.y + Math.sin(h) * along + Math.cos(h) * side);
      const box = (a: number, b: number) => [at(a, LANE_W / 2), at(b, LANE_W / 2), at(b, -LANE_W / 2), at(a, -LANE_W / 2)].map((p) => p.join(',')).join(' ');
      const got = motion.doing === 'straight' ? Math.min(motion.run, runM) : 0;
      const [x1, y1] = at(runM, LANE_W);
      const [x2, y2] = at(runM, -LANE_W);
      const [lx, ly] = at(runM + 0.6, 0);
      return (
        <g className={got >= runM ? styles.laneDone : styles.lane}>
          <polygon className={styles.laneAll} points={box(0, runM)} strokeWidth={1.5 * k} />
          {got > 0 && <polygon className={styles.laneGot} points={box(0, got)} />}
          <line x1={x1} y1={y1} x2={x2} y2={y2} className={styles.laneEnd} strokeWidth={3 * k} />
          <text x={lx} y={ly} fontSize={13 * k} className={styles.laneText} textAnchor="middle" dominantBaseline="middle">
            {fmt(runM, 0)} m
          </text>
        </g>
      );
    }
    const [cx, cy] = toScreen(pose.x, pose.y);
    const r = 0.8 * scale;
    if (current.part === 'still') {
      const share = current.need ? Math.min(1, current.has / current.need) : 0;
      const c = 2 * Math.PI * r;
      return (
        <g>
          <circle cx={cx} cy={cy} r={r} className={styles.ringAll} strokeWidth={4 * k} />
          <circle cx={cx} cy={cy} r={r} className={styles.ringGot} strokeWidth={4 * k} strokeDasharray={`${c * share} ${c}`} transform={`rotate(-90 ${cx} ${cy})`} />
        </g>
      );
    }
    // round the mower in the way to turn, inside it a ring filling up to one and a half rounds
    const left = current.part === 'left';
    const turned = motion.doing !== 'straight' && motion.turned !== 0 && motion.turned > 0 === left ? Math.abs(motion.turned) : 0;
    const share = Math.min(1, turned / (2 * Math.PI * TURN_ROUNDS));
    // (the arrow outside it, clear of the mower's icon)
    const ri = r;
    const ci = 2 * Math.PI * ri;
    const ra = r * 1.4;
    const a0 = -Math.PI / 2;
    const a1 = a0 + (left ? -1 : 1) * 1.7 * Math.PI;
    const p0 = [cx + ra * Math.cos(a0), cy + ra * Math.sin(a0)];
    const p1 = [cx + ra * Math.cos(a1), cy + ra * Math.sin(a1)];
    const tip = a1;
    const head = (d: number) => [cx + (ra + d) * Math.cos(tip), cy + (ra + d) * Math.sin(tip)];
    const along = [-Math.sin(tip) * (left ? -1 : 1), Math.cos(tip) * (left ? -1 : 1)];
    const a = head(7 * k);
    const b = head(-7 * k);
    const t = [p1[0] + along[0] * 10 * k, p1[1] + along[1] * 10 * k];
    return (
      <g className={styles.turnArrow}>
        <path d={`M ${p0[0]} ${p0[1]} A ${ra} ${ra} 0 1 ${left ? 0 : 1} ${p1[0]} ${p1[1]}`} fill="none" strokeWidth={3 * k} />
        <polygon points={`${a.join(',')} ${b.join(',')} ${t.join(',')}`} />
        <circle cx={cx} cy={cy} r={ri} className={styles.ringAll} strokeWidth={3 * k} />
        {share > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={ri}
            className={styles.ringGot}
            strokeWidth={3 * k}
            strokeDasharray={`${ci * share} ${ci}`}
            // (from the top, the way it turns: a left turn mirrored)
            transform={left ? `translate(${2 * cx} 0) scale(-1 1) rotate(-90 ${cx} ${cy})` : `rotate(-90 ${cx} ${cy})`}
          />
        )}
      </g>
    );
  };

  // (the gps's own accuracy, as on the check before it started)
  const gpsAcc = useSensorValue('om_gps_accuracy', (v) => (v !== undefined && Number.isFinite(parseFloat(v)) ? parseFloat(v) : null));
  const acc = gpsAcc ?? state?.pose.pos_accuracy;
  const gpsQ = gpsQuality(acc, numParam(params, PARAM.maxPositionAccuracy));
  const gpsText = `GPS · ${gpsQ === 'none' ? tr('no fix') : `${fmt(acc! * 100, 1)} cm · ${tr(GPS_QUALITY_LABEL[gpsQ])}`}`;
  const reason = why ? emergencyText(why) : '';
  // back on the station recording mode ends at once, elsewhere asked once more: the stick doesn't drive it any more after
  const endNow = () => {
    stop();
    onDone();
  };
  const endAsk = () => (charging ? endNow() : setSure(true));
  const endButton = (main?: string, warn?: string) =>
    charging || !sure ? (
      <button className={charging ? main : undefined} onClick={endAsk}>
        {charging && <CheckIcon size={18} />}
        {tr('End recording mode')}
      </button>
    ) : (
      <button className={warn} onClick={endNow}>
        {tr('End it anyway')}
      </button>
    );
  const alarm = (
    <>
      <strong>{reason ? tr('Emergency stop: {reason}', {reason}) : tr('Emergency stop')}</strong>
      <span>
        {refused ? `${resetRefusedText(refused)}. ${explain(refused)}` : tr('Release the mower, then reset the emergency to drive again.')}
      </span>
      <button disabled={!live} onClick={reset}>
        <WarningIcon size={18} />
        {tr('Reset emergency')}
      </button>
    </>
  );

  if (remote)
    return (
      <div className={[rec.remote, turned ? rec.turned : ''].join(' ')} data-no-swipe>
        <div className={rec.remoteMap}>
          {map && (
            <MapView
              map={map}
              mower={position ?? undefined}
              emergency={!!state?.emergency}
              follow
              followSpanMeters={span * ZOOMS[zoom]}
              datum={datumFromParams(params)}
              draw={draw}
              mapStyle="plain"
              bare
            />
          )}
        </div>
        <div className={rec.topBar}>
          <span className={[rec.status, rec.live].join(' ')}>
            <i />
            {placing ? tr('Into position') : home ? tr('Back onto the docking station') : tr('Calibration · {time}', {time: clock})}
          </span>
          {gpsQ !== 'fix' && <span className={rec.gpsWarn}>{gpsText}</span>}
          <span className={rec.grow} />
          <div className={rec.chips}>
            <button aria-label={tr('Zoom out')} disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)}>
              −
            </button>
            <button aria-label={tr('Zoom in')} disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}>
              +
            </button>
          </div>
          <div className={rec.chips} title={tr('Speed m/s')}>
            <SpeedIcon size={16} />
            {SPEEDS.map((v, i) => (
              <button
                key={v}
                className={i === speed ? rec.on : undefined}
                onClick={() => {
                  setSpeed(i);
                  speedRef.current = v;
                }}
              >
                {fmt(v, 2)}
              </button>
            ))}
          </div>
          {turned && (
            <button className={rec.square} aria-label={tr('Upright')} title={tr('Upright')} onClick={() => turnSideways(false)}>
              <RotateIcon size={20} />
            </button>
          )}
          {!home && (
            <button className={[rec.square, askCancel ? styles.squareAsk : ''].join(' ')} aria-label={tr('Cancel')} title={tr('Cancel')} onClick={cancelTap}>
              <CloseIcon size={20} />
            </button>
          )}
        </div>
        <p className={[rec.remoteNote, bar ? styles.noteWide : ''].join(' ')}>
          {askCancel ? (
            <b>{tr('Tap the cross again to cancel.')}</b>
          ) : home && sure && !charging ? (
            tr("It isn't on the station yet, after this the stick doesn't drive it any more.")
          ) : (
            <span>{say}</span>
          )}
          {!askCancel && missedText}
          {bar && <Meter {...bar} />}
        </p>
        {state?.emergency ? (
          <div className={rec.remoteWarn}>{alarm}</div>
        ) : (
          !live && <p className={rec.remoteWarn}>{tr('No connection to the mower, it stops by itself. Driving works again once the connection is back.')}</p>
        )}
        <div className={[rec.pad, rec.padLeft].join(' ')}>
          <DrivePad axis="y" turned={turned} disabled={!canDrive} onMove={(v) => canDrive && onStick(stick.current.x, v)} />
        </div>
        <div className={[rec.pad, rec.padRight].join(' ')}>
          <DrivePad axis="x" turned={turned} disabled={!canDrive} onMove={(v) => canDrive && onStick(v, stick.current.y)} />
        </div>
        <div className={rec.bottomBar}>
          {list.length > 0 && (
            <div className={rec.chips}>
              {list.map((l) => (
                <span key={l.part} className={[styles.countChip, lackDone(l) ? styles.countDone : ''].join(' ')}>
                  {tr(TILE_NAME[l.part], {n: fmt(l.need, 0)})} {lackDone(l) ? '✓' : l.part === 'still' ? `${fmt(l.has, 0)}/${fmt(l.need, 0)} s` : `${fmt(l.has, 0)}/${fmt(l.need, 0)}`}
                </span>
              ))}
            </div>
          )}
          <div className={rec.remoteButtons}>
            {placing && (
              <button className={rec.primary} disabled={starting} onClick={() => (stop(), onStart?.())}>
                <CheckIcon size={18} />
                {tr('Start calibration')}
              </button>
            )}
            {home && endButton(rec.primary, rec.danger)}
            {all && (
              <button className={rec.primary} onClick={() => (stop(), onDone())}>
                <CheckIcon size={18} />
                {tr('Done, work it out')}
              </button>
            )}
          </div>
        </div>
      </div>
    );

  return (
    <div className={styles.drive}>
      <section className={styles.map}>
        {map && (
          <MapView
            map={map}
            mower={position ?? undefined}
            emergency={!!state?.emergency}
            follow
            followSpanMeters={span}
            followShift={SHIFT}
            zoomable
            datum={datumFromParams(params)}
            draw={draw}
            mapStyle="plain"
          />
        )}
        <div className={[styles.say, all ? styles.sayDone : '', bar ? styles.sayWide : ''].join(' ')}>
          <i />
          <div className={styles.sayBody}>
            <span>{say}</span>
            {missedText}
            {bar && <Meter {...bar} />}
          </div>
        </div>
        {/* on a phone held upright: the two pads held sideways drive straighter than the stick, a tap turns it there */}
        {canDrive && (
          <button className={styles.sidewaysHint} onClick={() => turnSideways(true)}>
            <RotateIcon size={16} />
            {tr('Sideways recommended')}
          </button>
        )}
        <div className={styles.stick}>
          {state?.emergency ? (
            <div className={styles.alarm}>{alarm}</div>
          ) : !live ? (
            <p className={styles.alarm}>{tr('No connection to the mower, it stops by itself. Driving works again once the connection is back.')}</p>
          ) : state?.current_state !== 'AREA_RECORDING' ? (
            // (left elsewhere meanwhile: driving by hand needs it again)
            <div className={styles.alarm}>
              <span>{tr('The mower is not in recording mode, the stick does nothing.')}</span>
              <button disabled={!hasAction(ACTION.startRecording)} onClick={() => publishAction(ACTION.startRecording)}>
                {tr('Start recording mode')}
              </button>
            </div>
          ) : (
            <Joystick size={140} onMove={(x, y) => canDrive && onStick(x, y)} />
          )}
        </div>
      </section>

      <section className={[styles.card, styles.driveCard].join(' ')}>
        <div className={styles.line}>
          <span className={gpsQ === 'fix' ? undefined : styles.warn}>{gpsText}</span>
          {!home && !placing && <span>{tr('Calibration · {time}', {time: clock})}</span>}
        </div>
        {home && sure && !charging && <p className={styles.warn}>{tr("It isn't on the station yet, after this the stick doesn't drive it any more.")}</p>}
        {home ? null : list.length ? (
          <div className={styles.tally}>
            {list.map((l) => {
              const done = lackDone(l);
              return (
                <div key={l.part} className={[styles.tile, done ? styles.tileDone : l === current ? styles.tileNow : ''].join(' ')}>
                  <span className={[styles.tileIcon, l.part === 'right' ? styles.mirror : ''].join(' ')}>{done ? <CheckIcon size={16} /> : TILE_ICON[l.part]}</span>
                  <div>
                    <b>{tr(TILE_NAME[l.part], {n: fmt(l.need, 0)})}</b>
                    <small>
                      {done
                        ? tr('done')
                        : l.part === 'still'
                          ? tr('{n} s to go', {n: Math.ceil(l.left)})
                          : l.left === 0 && l.more > 0
                            ? l.part === 'straight'
                              ? tr('{m} m to go', {m: fmt(Math.ceil(l.more), 0)})
                              : tr('{n} more rounds on the spot', {n: fmt(l.more, 1)})
                            : tr('{n} of {m}', {n: fmt(l.has, 0), m: fmt(l.need, 0)})}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className={styles.dim}>
            {tr('{m} m in {runs} runs, {turns} turns so far.', {m: fmt(progress?.has.m ?? 0, 1), runs: progress?.has.runs ?? 0, turns: fmt(progress?.turns ?? 0, 1)})}
          </p>
        )}
        <div className={styles.buttons}>
          {placing && (
            <button className={styles.primary} disabled={starting} onClick={() => (stop(), onStart?.())}>
              <CheckIcon size={18} />
              {tr('Start calibration')}
            </button>
          )}
          {home ? (
            endButton(styles.primary, styles.warnButton)
          ) : (
            <button className={styles.danger} onClick={cancelTap}>
              {askCancel ? tr('Really cancel?') : tr('Cancel')}
            </button>
          )}
          {all && (
            <button className={styles.primary} onClick={() => (stop(), onDone())}>
              <CheckIcon size={18} />
              {tr('Done, work it out')}
            </button>
          )}
        </div>
        <div className={styles.speeds}>
          <span className={styles.dim}>{tr('Speed m/s')}</span>
          {SPEEDS.map((v, i) => (
            <button
              key={v}
              className={i === speed ? styles.on : undefined}
              onClick={() => {
                setSpeed(i);
                speedRef.current = v;
              }}
            >
              {fmt(v, 2)}
            </button>
          ))}
        </div>
        <div className={rec.phoneOnly}>
          <button onClick={() => turnSideways(true)}>
            <RotateIcon size={18} />
            {tr('Sideways')}
          </button>
          <p className={styles.dim}>{tr('Two pads like a remote control car. Turning the phone switches by itself.')}</p>
        </div>
        {!home && <p className={styles.dim}>
          <RotateIcon size={14} /> {tr("Straight: stick forward and hold it steady, half to full, don't steer. Turning: stick to the side only at speed 0.25, one and a half rounds until it looks back, then {m} m straight on.", {m: fmt(runM, 0)})}
        </p>}
      </section>
    </div>
  );
}
