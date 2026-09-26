'use client';

import Joystick from '@/components/Joystick';
import {TitleMark} from '@/components/Logo';
import MapView from '@/components/MapView';
import {useMapOverlay} from '@/hooks/useMapOverlay';
import {useMowerActions} from '@/hooks/useMowerActions';
import {useMowerMap} from '@/hooks/useMowerMap';
import {datumFromParams, useMowerParams} from '@/hooks/useMowerParams';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {useMowerState} from '@/hooks/useMowerState';
import {sendDrive} from '@/lib/teleop';
import Link from 'next/link';
import {useEffect, useRef, useState} from 'react';
import styles from './page.module.css';

const START = 'mower_logic:idle/start_area_recording';
const A = (id: string) => `mower_logic:area_recording/${id}`;

// m/s at full stick, the turn rate follows along
const SPEEDS = [0.15, 0.25, 0.35, 0.5];
const TURN_PER_SPEED = 3;

type Phase = 'off' | 'empty' | 'recording' | 'outlined' | 'dock';

export default function RecordPage() {
  const {state, connected} = useMowerState();
  const {hasAction, publishAction} = useMowerActions();
  const map = useMowerMap();
  const params = useMowerParams();
  const position = useMowerPosition() ?? state?.pose;
  const overlay = useMapOverlay();
  const [speed, setSpeed] = useState(1);
  const [saved, setSaved] = useState<string | null>(null);

  const recordingMode = state?.current_state === 'AREA_RECORDING';
  // what the mower allows right now tells which step we're in
  const phase: Phase = !recordingMode
    ? 'off'
    : hasAction(A('stop_recording'))
      ? 'recording'
      : hasAction(A('record_dock')) && !hasAction(A('start_recording'))
        ? 'dock'
        : hasAction(A('finish_mowing_area'))
          ? 'outlined'
          : 'empty';
  const hasOutline = overlay.some((l) => l.closed && l.color === 'green');
  const canDrive = recordingMode && connected && !state?.emergency;

  // stick position lives in a ref, the timer keeps sending it until the stick is let go
  const stick = useRef({x: 0, y: 0});
  const speedRef = useRef(SPEEDS[speed]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const send = () => {
    const {x, y} = stick.current;
    // gentle near the middle, full speed only at the edge
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

  // emergency, lost connection or the mode ending stop it as well
  useEffect(() => {
    if (canDrive || !timer.current) return;
    clearInterval(timer.current);
    timer.current = null;
    stick.current = {x: 0, y: 0};
    sendDrive(0, 0);
  }, [canDrive]);

  // leaving the page or putting the phone away stops the mower
  useEffect(() => {
    const hidden = () => document.hidden && stop();
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      if (timer.current) {
        clearInterval(timer.current);
        sendDrive(0, 0);
      }
    };
  }, []);

  const act = (id: string) => publishAction(A(id));
  const button = (id: string, label: string, kind?: 'main' | 'danger', after?: () => void) =>
    hasAction(A(id)) && (
      <button
        key={id}
        className={kind ? styles[kind] : undefined}
        onClick={() => {
          act(id);
          after?.();
        }}
      >
        {label}
      </button>
    );

  let text: React.ReactNode = null;
  let buttons: React.ReactNode[] = [];
  if (phase === 'empty') {
    text = saved
      ? `${saved} saved. Record the next one, or leave recording mode and fine tune it in the editor.`
      : 'Drive to the edge of the new area, then start recording and drive once around it. For the docking station, stop about a meter in front of it, facing it.';
    buttons = [
      button('start_recording', 'Record outline', 'main', () => setSaved(null)),
      button('record_dock', 'Record docking station'),
      button('exit_recording_mode', 'Leave recording mode', undefined, stop),
    ];
  } else if (phase === 'recording') {
    text = hasOutline
      ? 'Drive around the obstacle, then stop. It closes by itself.'
      : 'Drive along the edge until you are back at the start, then stop. The outline closes by itself.';
    buttons = [
      button('stop_recording', 'Stop', 'main'),
      button('collect_point', 'Set point here'),
      button('auto_point_collecting_disable', 'Auto points: on'),
      button('auto_point_collecting_enable', 'Auto points: off'),
      button('finish_discard', 'Discard area', 'danger'),
    ];
  } else if (phase === 'outlined') {
    text = 'Outline done. Record obstacles inside it (beds, trees, the pond), or save the area.';
    buttons = [
      button('finish_mowing_area', 'Save as mowing area', 'main', () => setSaved('Mowing area')),
      button('start_recording', 'Record obstacle'),
      button('finish_navigation_area', 'Save as navigation area', undefined, () => setSaved('Navigation area')),
      button('finish_discard', 'Discard area', 'danger'),
    ];
  } else if (phase === 'dock') {
    text = 'Now drive straight into the docking station until it sits on the contacts, then save. The way from the first point to here becomes the docking direction.';
    buttons = [button('record_dock', 'Save docking position', 'main', () => setSaved('Docking station'))];
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={recordingMode ? styles.hideOnPhone : undefined}>
          <TitleMark />
          Record
        </h1>

        {!state && <p className={styles.dim}>{connected ? 'waiting for the mower…' : 'connecting…'}</p>}

        {state && phase === 'off' && (
          <section className={styles.card}>
            <p>
              Record a new area by driving the mower around it with the joystick on this page. Obstacles inside the area and
              the docking station can be recorded the same way. Afterwards you can fine tune everything in the{' '}
              <Link href="/map">map editor</Link>.
            </p>
            <p className={styles.dim}>
              Keep the mower in sight. It stops as soon as you let go of the stick, switch apps or lose the connection.
            </p>
            <button className={styles.main} disabled={!hasAction(START)} onClick={() => publishAction(START)}>
              Start recording mode
            </button>
            {!hasAction(START) && <p className={styles.dim}>Only possible while the mower is idle.</p>}
          </section>
        )}

        {recordingMode && (
          <div className={styles.layout}>
            <section className={styles.map}>
              {map && (
                <MapView map={map} mower={position} follow followSpanMeters={16} zoomable overlay={overlay} datum={datumFromParams(params)} />
              )}
              {/* on the map, so map, stick and buttons fit on one phone screen */}
              <div className={styles.stick}>
                {state?.emergency ? (
                  <p className={styles.warn}>Emergency stop is active, reset it on the dashboard before driving.</p>
                ) : (
                  <Joystick size={140} onMove={(x, y) => canDrive && onStick(x, y)} />
                )}
              </div>
            </section>

            <section className={styles.card}>
              <p>{text}</p>
              <div className={styles.buttons}>{buttons}</div>
              <div className={styles.speeds}>
                <span className={styles.dim}>Speed m/s</span>
                {SPEEDS.map((v, i) => (
                  <button
                    key={v}
                    className={i === speed ? styles.on : undefined}
                    onClick={() => {
                      setSpeed(i);
                      speedRef.current = v;
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
