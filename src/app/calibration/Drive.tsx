'use client';

import {CheckIcon, RotateIcon, TurnIcon, WarningIcon} from '@/components/icons';
import Joystick from '@/components/Joystick';
import MapView from '@/components/MapView';
import {useEmergencyReasons} from '@/hooks/useEmergencyReasons';
import {useMowerMap} from '@/hooks/useMowerMap';
import {datumFromParams, numParam, useMowerParams} from '@/hooks/useMowerParams';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {isLive, useMowerState} from '@/hooks/useMowerState';
import {useMowerActions} from '@/hooks/useMowerActions';
import {lackDone, lacks, type CalibProgress, type Lack} from '@/lib/calibration';
import {motionTracker, NO_MOTION, type Motion} from '@/lib/calibMotion';
import {emergencyText} from '@/lib/events';
import {fmt, tr} from '@/lib/i18n';
import {onTopic} from '@/lib/mqttClient';
import {ACTION, PARAM, TOPIC} from '@/lib/openmower';
import {GPS_QUALITY_LABEL, gpsQuality} from '@/lib/status';
import {sendDrive} from '@/lib/teleop';
import {useEffect, useRef, useState} from 'react';
import styles from './page.module.css';

// m/s at full stick, the turn rate follows along (as in the recorder)
const SPEEDS = [0.15, 0.25, 0.35, 0.5];
const TURN_PER_SPEED = 3;
// how wide the lane on the map is, about a mower
const LANE_W = 0.5;
// a turn of one and a half rounds on the spot: it looks back after it, the runs go to and fro on one lane
const TURN_ROUNDS = 1.5;
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

// what the mower does right now, from its poses as they come (only to show)
function useMotion(): Motion {
  const [motion, setMotion] = useState<Motion>(NO_MOTION);
  useEffect(() => {
    const track = motionTracker();
    let shown = 0;
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
      if (now - shown < 250) return;
      shown = now;
      setMotion(m);
    });
  }, []);
  return motion;
}

// the tile of what's being driven (a turn since the last run, stops in it too), else the first one still missing
function nowPart(list: Lack[], motion: Motion): Lack | null {
  const turning = motion.doing !== 'straight' && Math.abs(motion.turned) >= 0.5;
  const doing =
    motion.doing === 'straight' ? 'straight' : turning ? (motion.turned > 0 ? 'left' : 'right') : motion.doing === 'still' ? 'still' : null;
  const open = list.filter((l) => !lackDone(l));
  return open.find((l) => l.part === doing) ?? open[0] ?? null;
}

const TILE_ICON = {still: <span className={styles.ring} />, straight: <span className={styles.bar} />, left: <TurnIcon size={16} />, right: <TurnIcon size={16} />};
const TILE_NAME = {still: 'Stand {n} s', straight: 'Straight', left: 'Turn left', right: 'Turn right'};

// driving by hand for the calibration, like the recorder: the map following the mower with the stick on it, under it
// what's done and what's missing (the planner's counts), what to do now on the map
// home: after the recording, back onto the docking station (no tiles, it ends recording mode)
export default function Drive({
  progress,
  since,
  home,
  onStop,
  onDone,
}: {
  progress: CalibProgress | null;
  // when it started, else since the page shows it
  since: number | null;
  home?: boolean;
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
  const motion = useMotion();
  const why = useEmergencyReasons(!!state?.emergency);
  const canDrive = state?.current_state === 'AREA_RECORDING' && live && !state?.emergency;

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
  // emergency, a lost connection or the mode ending stop it as well
  useEffect(() => {
    if (!timer.current) return;
    clearInterval(timer.current);
    timer.current = null;
    stick.current = {x: 0, y: 0};
    sendDrive(0, 0);
  }, [canDrive]);
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

  const list = home || !progress ? [] : lacks(progress);
  const all = list.length > 0 && list.every(lackDone);
  const current = nowPart(list, motion);
  const runM = progress?.need.run_m ?? 5;
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
  const charging = !!state?.is_charging;
  const [sure, setSure] = useState(false);

  // what to do now, on the map: what's driven, else what's missing next
  let say: React.ReactNode;
  if (home) {
    say =
      toDock !== null && toDock > 0.5 && !charging ? (
        <>
          <b>{tr('Back onto the docking station')}</b> · {tr('{m} m to go', {m: fmt(toDock, 1)})}
        </>
      ) : (
        <b>{tr(charging ? 'On the station. Now end recording mode.' : 'Back onto the docking station')}</b>
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
    const thisWay = motion.doing !== 'straight' && motion.turned !== 0 && motion.turned > 0 === left;
    const togo = TURN_ROUNDS - (thisWay ? Math.abs(motion.turned) / (2 * Math.PI) : 0);
    say =
      togo > 0.1 ? (
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

  // the lane of the run (from where it started, or ahead of the mower when a run is next), the turn round the mower,
  // the ring filling while it stands
  const draw = ({toScreen, scale, k}: {toScreen: (x: number, y: number) => [number, number]; scale: number; k: number}) => {
    if (!pose || !current) return null;
    if (current.part === 'straight') {
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

  const acc = state?.pose.pos_accuracy;
  const gpsQ = gpsQuality(acc, numParam(params, PARAM.maxPositionAccuracy));
  const gpsText = `GPS · ${gpsQ === 'none' ? tr('no fix') : `${fmt(acc! * 100, 1)} cm · ${tr(GPS_QUALITY_LABEL[gpsQ])}`}`;
  const reason = why ? emergencyText(why) : '';

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
          />
        )}
        <div className={[styles.say, all ? styles.sayDone : ''].join(' ')}>
          <i />
          <span>{say}</span>
        </div>
        <div className={styles.stick}>
          {state?.emergency ? (
            <div className={styles.alarm}>
              <strong>{reason ? tr('Emergency stop: {reason}', {reason}) : tr('Emergency stop')}</strong>
              <span>{tr('Release the mower, then reset the emergency to drive again.')}</span>
              <button disabled={!live} onClick={() => publishAction(ACTION.resetEmergency)}>
                <WarningIcon size={18} />
                {tr('Reset emergency')}
              </button>
            </div>
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
          {!home && <span>{tr('Calibration · {time}', {time: clock})}</span>}
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
          {home ? (
            // on the station at once, elsewhere asked once more: the stick doesn't drive it any more after
            charging || !sure ? (
              <button
                className={charging ? styles.primary : undefined}
                onClick={() => {
                  if (!charging) return setSure(true);
                  stop();
                  onDone();
                }}
              >
                {charging && <CheckIcon size={18} />}
                {tr('End recording mode')}
              </button>
            ) : (
              <button
                className={styles.warnButton}
                onClick={() => {
                  stop();
                  onDone();
                }}
              >
                {tr('End it anyway')}
              </button>
            )
          ) : (
            <button className={styles.danger} onClick={() => (stop(), onStop())}>
              {tr('Cancel')}
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
        {!home && <p className={styles.dim}>
          <RotateIcon size={14} /> {tr("Straight: stick forward and hold it steady, half to full, don't steer. Turning: stick to the side only at speed 0.25, one and a half rounds until it looks back, then {m} m straight on.", {m: fmt(runM, 0)})}
        </p>}
      </section>
    </div>
  );
}
