'use client';

import {CloseIcon, RotateIcon, SpeedIcon, WarningIcon} from '@/components/icons';
import DrivePad from '@/components/DrivePad';
import Joystick from '@/components/Joystick';
import MapView from '@/components/MapView';
import {useEmergencyReasons} from '@/hooks/useEmergencyReasons';
import {useEmergencyReset, useJustReset} from '@/hooks/useEmergencyReset';
import type {OverlayLine} from '@/hooks/useMapOverlay';
import {useMedia} from '@/hooks/useMedia';
import {useMowerActions} from '@/hooks/useMowerActions';
import {useMowerMap} from '@/hooks/useMowerMap';
import {datumFromParams, numParam, useMowerParams} from '@/hooks/useMowerParams';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {useSensorValue} from '@/hooks/useMowerSensors';
import {isLive, useMowerState} from '@/hooks/useMowerState';
import {emergencyText, explain, resetRefusedText, stopReleaseText} from '@/lib/events';
import {useStopRelease} from '@/lib/mowerOs';
import {fmt, tr} from '@/lib/i18n';
import {ACTION, PARAM} from '@/lib/openmower';
import {GPS_QUALITY_LABEL, gpsQuality} from '@/lib/status';
import {sendDrive} from '@/lib/teleop';
import {useEffect, useRef, useState} from 'react';
import styles from './DriveView.module.css';

// the classes of the card and the bars for what a page puts in them (buttons, chips, lines)
export {styles as driveStyles};

// m/s at full stick, the turn rate follows along
const SPEEDS = [0.15, 0.25, 0.35, 0.5];
const TURN_PER_SPEED = 3;
// the sideways layout drawn turned, for a phone that doesn't turn the page itself (one choice for every page that drives)
const TURNED_KEY = 'recordTurned';
// sideways the map's zoom steps, times the span the page asks for
const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3];
// upright the mower that much of the map's width above its middle, in the part the pill and the stick leave free
const SHIFT = 0.14;

type Draw = NonNullable<React.ComponentProps<typeof MapView>['draw']>;

export interface Driving {
  // in recording mode, connected, no emergency and not right after its reset: only then the stick drives
  canDrive: boolean;
  speed: number;
  setSpeed: (i: number) => void;
  // the stick, -1…1: x to the right, y forward. a pad moves one of them, the other pad keeps the other
  onStick: (x: number, y: number) => void;
  onPad: (axis: 'x' | 'y', v: number) => void;
  stop: () => void;
  // when the stick last sent something to drive (performance.now), 0 never
  movedAt: React.RefObject<number>;
  // held sideways on a phone (or turned): the remote control over the whole screen
  remote: boolean;
  turned: boolean;
  turnSideways: (on: boolean) => void;
}

// driving by hand with the stick: what it sends a tenth of a second at a time until it's let go, the speed steps, the
// sideways layout. show: the remote control only while the page drives
export function useDrive({show = true, onMove}: {show?: boolean; onMove?: () => void} = {}): Driving {
  const link = useMowerState();
  const {state} = link;
  // no fresh state also stops it: the wifi can be gone a while before the connection counts as lost. right after an
  // emergency reset it waits a moment: the stick takes the reset button's place, a second tap there mustn't drive
  const justReset = useJustReset(!!state?.emergency);
  const canDrive = state?.current_state === 'AREA_RECORDING' && isLive(link) && !state?.emergency && !justReset;

  // held sideways on a phone: a pad for forward and back on the left and one for steering on the right. turned: the
  // same drawn a quarter turn for a phone whose page doesn't turn (a tablet held sideways is wide enough as it is)
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
  const remote = show && (sideways || turned);

  const [speed, setSpeedAt] = useState(1);
  const speedRef = useRef(SPEEDS[1]);
  const setSpeed = (i: number) => {
    setSpeedAt(i);
    speedRef.current = SPEEDS[i];
  };
  const moveRef = useRef(onMove);
  useEffect(() => {
    moveRef.current = onMove;
  });
  const movedAt = useRef(0);
  const stick = useRef({x: 0, y: 0});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const send = () => {
    const {x, y} = stick.current;
    // gentle near the middle, full speed only at the edge
    const curve = (v: number) => Math.sign(v) * Math.abs(v) ** 1.6;
    const v = speedRef.current;
    movedAt.current = performance.now();
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
    moveRef.current?.();
    if (x === 0 && y === 0) return stop();
    if (!timer.current) {
      send();
      timer.current = setInterval(send, 100);
    }
  };
  const onPad = (axis: 'x' | 'y', v: number) => onStick(axis === 'x' ? v : stick.current.x, axis === 'y' ? v : stick.current.y);
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
      stick.current = {x: 0, y: 0};
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
  return {canDrive, speed, setSpeed, onStick, onPad, stop, movedAt, remote, turned, turnSideways};
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

// driving by hand on a page (recording, the calibration): upright the map following the mower with what to do now at the
// top and the stick on it, under it the page's card; sideways the remote control over the whole screen
export default function DriveView({
  drive,
  say,
  missed,
  bar,
  ok,
  status,
  live: recording,
  span,
  draw,
  overlay,
  gpsHint,
  line,
  children,
  foot,
  note,
  warn,
  close,
  bottom,
  remoteRef,
}: {
  drive: Driving;
  // what to do now: on the map at the top, sideways at the top in the middle. under it lines in amber (missed, the
  // driveStyles.missed class), its bar, green once it's right
  say: React.ReactNode;
  missed?: React.ReactNode;
  bar?: {share: number; label: string} | null;
  ok?: boolean;
  // sideways the step in the green pill, its dot blinking while something is recorded
  status: string;
  live?: boolean;
  // how many metres the map shows across around the mower, what's drawn on it, the recorder's lines
  span: number;
  draw?: Draw;
  overlay?: OverlayLine[];
  // upright: said after the gps without an rtk fix, the other end of the gps line, the card, after the sideways button
  gpsHint?: string;
  line?: React.ReactNode;
  children?: React.ReactNode;
  foot?: React.ReactNode;
  // sideways: in place of what to do now, a warning in the middle, the cross at the top right, the bar at the bottom
  note?: React.ReactNode;
  warn?: React.ReactNode;
  close?: {label: string; asking?: boolean; onClick: () => void};
  bottom?: React.ReactNode;
  // the sideways layout, for dialogs to show over it turned with it
  remoteRef?: React.Ref<HTMLDivElement>;
}) {
  const link = useMowerState();
  const {state} = link;
  const live = isLive(link);
  const {hasAction, publishAction} = useMowerActions();
  const map = useMowerMap();
  const params = useMowerParams();
  const position = useMowerPosition() ?? state?.pose;
  const why = useEmergencyReasons(!!state?.emergency);
  const {refused, reset} = useEmergencyReset(!!state?.emergency, publishAction);
  const stopRelease = useStopRelease();
  const justReset = useJustReset(!!state?.emergency);
  const [zoom, setZoom] = useState(2);

  // the gps's own accuracy (OpenMower's idle leaves the gps out of its position)
  const gpsAcc = useSensorValue('om_gps_accuracy', (v) => (v !== undefined && Number.isFinite(parseFloat(v)) ? parseFloat(v) : null));
  const acc = gpsAcc ?? state?.pose.pos_accuracy;
  const gpsQ = gpsQuality(acc, numParam(params, PARAM.maxPositionAccuracy));
  const gpsText = `GPS · ${gpsQ === 'none' ? tr('no fix') : `${fmt(acc! * 100, 1)} cm · ${tr(GPS_QUALITY_LABEL[gpsQ])}`}`;
  // the emergency stop is reset right here, driving goes on where it stopped
  const reason = why ? emergencyText(why) : '';
  const alarm = (
    <>
      <strong>{reason ? tr('Emergency stop: {reason}', {reason}) : tr('Emergency stop')}</strong>
      <span>
        {refused ? `${resetRefusedText(refused)}. ${explain(refused)}` : tr('Release the mower, then reset the emergency to drive again.')}
        {stopRelease && ` ${stopReleaseText(stopRelease)}`}
      </span>
      <button disabled={!live} onClick={reset}>
        <WarningIcon size={18} />
        {tr('Reset emergency')}
      </button>
    </>
  );
  const offline = tr('No connection to the mower, it stops by itself. Driving works again once the connection is back.');
  const speeds = (on: string) =>
    SPEEDS.map((v, i) => (
      <button key={v} className={i === drive.speed ? on : undefined} onClick={() => drive.setSpeed(i)}>
        {fmt(v, 2)}
      </button>
    ));

  if (drive.remote)
    return (
      <div ref={remoteRef} className={[styles.remote, drive.turned ? styles.turned : ''].join(' ')} data-no-swipe>
        <div className={styles.remoteMap}>
          {map && (
            <MapView
              map={map}
              mower={position ?? undefined}
              emergency={!!state?.emergency}
              follow
              followSpanMeters={span * ZOOMS[zoom]}
              overlay={overlay}
              datum={datumFromParams(params)}
              draw={draw}
              mapStyle="plain"
              bare
            />
          )}
        </div>
        <div className={styles.topBar}>
          <span className={[styles.status, recording ? styles.live : ''].join(' ')}>
            <i />
            {status}
          </span>
          {gpsQ !== 'fix' && <span className={styles.gpsWarn}>{gpsText}</span>}
          <span className={styles.grow} />
          <div className={styles.chips}>
            <button aria-label={tr('Zoom out')} disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)}>
              −
            </button>
            <button aria-label={tr('Zoom in')} disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}>
              +
            </button>
          </div>
          <div className={styles.chips} title={tr('Speed m/s')}>
            <SpeedIcon size={16} />
            {speeds(styles.on)}
          </div>
          {drive.turned && (
            <button className={styles.square} aria-label={tr('Upright')} title={tr('Upright')} onClick={() => drive.turnSideways(false)}>
              <RotateIcon size={20} />
            </button>
          )}
          {close && (
            <button className={[styles.square, close.asking ? styles.squareAsk : ''].join(' ')} aria-label={close.label} title={close.label} onClick={close.onClick}>
              <CloseIcon size={20} />
            </button>
          )}
        </div>
        <div className={[styles.remoteNote, bar ? styles.noteWide : '', ok ? styles.noteOk : ''].join(' ')}>
          {note ?? (
            <>
              <span>{say}</span>
              {missed}
            </>
          )}
          {!note && bar && <Meter {...bar} />}
        </div>
        {state?.emergency ? (
          <div className={styles.remoteWarn}>{alarm}</div>
        ) : !live ? (
          <p className={styles.remoteWarn}>{offline}</p>
        ) : (
          warn && <p className={styles.remoteWarn}>{warn}</p>
        )}
        <div className={[styles.pad, styles.padLeft].join(' ')}>
          <DrivePad axis="y" turned={drive.turned} disabled={!drive.canDrive} onMove={(v) => drive.canDrive && drive.onPad('y', v)} />
        </div>
        <div className={[styles.pad, styles.padRight].join(' ')}>
          <DrivePad axis="x" turned={drive.turned} disabled={!drive.canDrive} onMove={(v) => drive.canDrive && drive.onPad('x', v)} />
        </div>
        <div className={styles.bottomBar}>{bottom}</div>
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
            overlay={overlay}
            datum={datumFromParams(params)}
            draw={draw}
            mapStyle="plain"
          />
        )}
        <div className={[styles.say, ok ? styles.sayDone : '', bar ? styles.sayWide : ''].join(' ')}>
          <i />
          <div className={styles.sayBody}>
            <span>{say}</span>
            {missed}
            {bar && <Meter {...bar} />}
          </div>
        </div>
        {/* on a phone held upright: the two pads held sideways drive straighter than the stick, a tap turns it there */}
        {drive.canDrive && (
          <button className={styles.sidewaysHint} onClick={() => drive.turnSideways(true)}>
            <RotateIcon size={16} />
            {tr('Sideways recommended')}
          </button>
        )}
        <div className={styles.stick}>
          {state?.emergency ? (
            <div className={styles.alarm}>{alarm}</div>
          ) : !live ? (
            <p className={styles.alarm}>{offline}</p>
          ) : state?.current_state !== 'AREA_RECORDING' ? (
            // (left elsewhere meanwhile: driving by hand needs it again. held back right after an emergency reset like
            // the stick, it's where the reset button was)
            <div className={styles.alarm}>
              <span>{tr('The mower is not in recording mode, the stick does nothing.')}</span>
              <button disabled={!hasAction(ACTION.startRecording) || justReset} onClick={() => publishAction(ACTION.startRecording)}>
                {tr('Start recording mode')}
              </button>
            </div>
          ) : (
            <Joystick size={140} onMove={(x, y) => drive.canDrive && drive.onStick(x, y)} />
          )}
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.line}>
          <span className={gpsQ === 'fix' ? undefined : styles.warn}>{gpsQ === 'fix' || !gpsHint ? gpsText : `${gpsText}. ${gpsHint}`}</span>
          {line}
        </div>
        {children}
        <div className={styles.speeds}>
          <span className={styles.dim}>{tr('Speed m/s')}</span>
          {speeds(styles.on)}
        </div>
        <div className={styles.phoneOnly}>
          <button onClick={() => drive.turnSideways(true)}>
            <RotateIcon size={18} />
            {tr('Sideways')}
          </button>
          <p className={styles.dim}>{tr('Two pads like a remote-controlled car. Turning the phone switches by itself.')}</p>
        </div>
        {foot}
      </section>
    </div>
  );
}
