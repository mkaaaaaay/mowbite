'use client';

import DrivePad from '@/components/DrivePad';
import {
  AutoPointsIcon,
  BladeIcon,
  CheckIcon,
  CloseIcon,
  HomeIcon,
  OutlineDoneIcon,
  PinIcon,
  RecordIcon,
  RotateIcon,
  RouteIcon,
  SpeedIcon,
  TrashIcon,
  WarningIcon,
} from '@/components/icons';
import Joystick from '@/components/Joystick';
import {TitleMark} from '@/components/Logo';
import MapView from '@/components/MapView';
import {useEmergencyReasons} from '@/hooks/useEmergencyReasons';
import {useMapOverlay} from '@/hooks/useMapOverlay';
import {useMedia} from '@/hooks/useMedia';
import {useMowerActions} from '@/hooks/useMowerActions';
import {useMowerMap} from '@/hooks/useMowerMap';
import {datumFromParams, useMowerParams} from '@/hooks/useMowerParams';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {isLive, useMowerState} from '@/hooks/useMowerState';
import {sendDrive} from '@/lib/teleop';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import styles from './page.module.css';
import {fmt, tr, useLang} from '@/lib/i18n';
import {ACTION} from '@/lib/openmower';
import {eventsOfDay, fileDay, forgetToday, historyDays} from '@/lib/history';
import {backAtStart} from '@/lib/geometry';
import {tick} from '@/lib/haptics';
import {guardLeaving} from '@/lib/leaving';
import {emergencyText} from '@/lib/events';

const START = ACTION.startRecording;
const A = ACTION.recording;
// the page is open: react mounts it twice while developing, leaving it is only when it stays closed
let open = 0;

// m/s at full stick, the turn rate follows along
const SPEEDS = [0.15, 0.25, 0.35, 0.5];
const TURN_PER_SPEED = 3;

type Phase = 'off' | 'empty' | 'recording' | 'outlined' | 'dock';

// back at the start of the line: closed after this many seconds unless the user goes on. on unless switched off
const CLOSE_SECONDS = 3;
const AUTO_CLOSE_KEY = 'recordAutoClose';
// the sideways layout drawn turned, for a phone that doesn't turn the page itself
const TURNED_KEY = 'recordTurned';
// how many meters the map shows across around the mower in the sideways layout, the buttons step through them
const SPANS = [8, 12, 16, 24, 32, 48];

// next to the text on the buttons, to tell them apart at a glance
const ICONS: Record<string, React.ReactNode> = {
  start_recording: <RecordIcon size={18} />,
  record_dock: <HomeIcon size={18} />,
  exit_recording_mode: <CloseIcon size={18} />,
  stop_recording: <OutlineDoneIcon size={18} />,
  collect_point: <PinIcon size={18} />,
  auto_point_collecting_enable: <AutoPointsIcon size={18} />,
  auto_point_collecting_disable: <AutoPointsIcon size={18} />,
  finish_discard: <TrashIcon size={18} />,
  finish_mowing_area: <CheckIcon size={18} />,
  finish_navigation_area: <RouteIcon size={18} />,
  start_manual_mowing: <BladeIcon size={18} />,
  stop_manual_mowing: <BladeIcon size={18} />,
};

export default function RecordPage() {
  useLang();
  const link = useMowerState();
  const {state, connected} = link;
  const live = isLive(link);
  const {hasAction, knowsAction, publishAction} = useMowerActions();
  const map = useMowerMap();
  const params = useMowerParams();
  const position = useMowerPosition() ?? state?.pose;
  const overlay = useMapOverlay();
  const [speed, setSpeed] = useState(1);
  const [saved, setSaved] = useState<string | null>(null);
  // the mower left recording mode within a moment of starting it (see the hint below)
  const [bounced, setBounced] = useState(false);
  const startedAt = useRef(0);
  const wasRecording = useRef(false);

  const recordingMode = state?.current_state === 'AREA_RECORDING';
  const recordingRef = useRef(recordingMode);
  recordingRef.current = recordingMode;
  useEffect(() => {
    if (recordingMode) wasRecording.current = true;
    else if (wasRecording.current) {
      wasRecording.current = false;
      if (Date.now() - startedAt.current < 8000) setBounced(true);
    }
  }, [recordingMode]);
  // the state is published once a second, a bounce is usually over before that: the event history has it
  const checkBounce = async () => {
    if (recordingRef.current) return;
    forgetToday();
    const {events} = await eventsOfDay(await historyDays(), fileDay(new Date()));
    const since = startedAt.current / 1000 - 5;
    if (events.some((e) => e.type === 'DOCKING' && e.reason === 'Manual pause' && e.t >= since)) setBounced(true);
  };
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
  // no fresh state also stops it: the wifi can be gone a while before the connection counts as lost
  const canDrive = recordingMode && live && !state?.emergency;
  const why = useEmergencyReasons(!!state?.emergency);

  // held sideways on a phone: a remote control over the whole screen, a pad for forward and back on the left and one
  // for steering on the right. turned: the same drawn a quarter turn for a phone whose page doesn't turn
  const sideways = useMedia('(orientation: landscape) and (max-height: 500px)');
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
  const turned = turnedOn && !sideways;
  const remote = recordingMode && (sideways || turned);
  const [span, setSpan] = useState(2);
  const remoteRef = useRef<HTMLDivElement>(null);
  // mowing by hand: in recording mode OpenMower runs the blade until it's switched off or the mode ends, also while the
  // mower stands still
  const bladeOn = recordingMode && hasAction(A('stop_manual_mowing'));
  const blade = useRef({on: bladeOn, off: () => publishAction(A('stop_manual_mowing'))});
  blade.current = {on: bladeOn, off: () => publishAction(A('stop_manual_mowing'))};
  // after an emergency stop it would start again by itself once that's reset
  useEffect(() => {
    if (state?.emergency && bladeOn && live) blade.current.off();
  }, [state?.emergency, bladeOn, live]);

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

  // emergency, lost connection or the mode ending stop it as well. so does a switch between upright, sideways and turned:
  // the stick or pad under the finger is gone then without having been let go
  useEffect(() => {
    if (!timer.current) return;
    clearInterval(timer.current);
    timer.current = null;
    stick.current = {x: 0, y: 0};
    sendDrive(0, 0);
  }, [canDrive, remote, turned]);

  // leaving the page or putting the phone away stops the mower, and the blade
  useEffect(() => {
    const hidden = () => {
      if (!document.hidden) return;
      stop();
      if (blade.current.on) blade.current.off();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      if (timer.current) {
        clearInterval(timer.current);
        sendDrive(0, 0);
      }
      if (blade.current.on) blade.current.off();
    };
  }, []);

  const act = (id: string) => publishAction(A(id));
  const actRef = useRef(act);
  actRef.current = act;

  // reloading, closing or switching mowers asks first while something isn't saved yet or the blade turns: what's sent
  // from a page that unloads doesn't get out any more. a switch of mowers sends the stop and the blade's off before
  const guarded = recordingMode && (phase !== 'empty' || bladeOn);
  const halt = useRef(() => {});
  halt.current = () => {
    stop();
    if (blade.current.on) blade.current.off();
  };
  useEffect(() => {
    if (!guarded) return;
    guardLeaving('record', {
      text: () => tr("Switching mowers loses what isn't saved of the recording. The mower stops and the blade goes off first."),
      before: () => halt.current(),
    });
    return () => guardLeaving('record', null);
  }, [guarded]);

  // leaving the page ends recording mode: a link or a tab asks first, what isn't saved yet is lost with it. the way back
  // (the phone's back button) can't ask, it ends the mode only when nothing is being recorded
  const router = useRouter();
  const [leaving, setLeaving] = useState<string | null>(null);
  // stop on a line without a second point yet (the mower hasn't moved 10 cm since it started, or no point set with auto
  // points off): OpenMower then drops the whole area, so with an outline to lose it asks first
  const [early, setEarly] = useState(false);
  if (early && phase !== 'recording') setEarly(false);
  const canExit = hasAction(A('exit_recording_mode'));
  const away = useRef({recordingMode, phase, canExit, ended: false});
  away.current = {...away.current, recordingMode, phase, canExit};
  useEffect(() => {
    if (recordingMode) away.current.ended = false;
  }, [recordingMode]);
  useEffect(() => {
    if (!recordingMode) return;
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(a instanceof HTMLAnchorElement) || a.target === '_blank' || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const url = new URL(a.href);
      if (url.origin !== location.origin || url.pathname.replace(/\/$/, '') === '/record') return;
      // before the link's own click: it doesn't go anywhere until it's answered
      e.preventDefault();
      e.stopPropagation();
      setLeaving(url.pathname + url.search + url.hash);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [recordingMode]);
  useEffect(() => {
    if (leaving === null && !early) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setLeaving(null);
      setEarly(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leaving, early]);
  useEffect(() => {
    open++;
    return () => {
      open--;
      const {recordingMode, phase, canExit, ended} = away.current;
      if (!recordingMode || ended || phase !== 'empty' || !canExit) return;
      setTimeout(() => open || publishAction(A('exit_recording_mode')), 300);
    };
  }, [publishAction]);
  const leave = (end: boolean) => {
    const to = leaving;
    setLeaving(null);
    if (end && canExit) {
      away.current.ended = true;
      stop();
      act('exit_recording_mode');
    }
    if (to) router.push(to);
  };
  // the cross of the sideways layout ends recording mode, it asks first when something isn't saved yet
  const endRecording = () => {
    if (phase !== 'empty' || !canExit) return setLeaving('');
    stop();
    act('exit_recording_mode');
  };

  // round once and back where the line started: it closes by itself after a few seconds, like stop does
  const [autoClose, setAutoClose] = useState(() => {
    try {
      return localStorage.getItem(AUTO_CLOSE_KEY) !== '0';
    } catch {
      return true;
    }
  });
  // seconds left until it's closed, null while not
  const [closing, setClosing] = useState<number | null>(null);
  // the user went on, or it was just sent: not again until the mower was away from the start
  const [held, setHeld] = useState(false);
  const line = overlay.find((l) => !l.closed)?.points ?? [];
  const fromStart = line.length && position ? Math.hypot(position.x - line[0].x, position.y - line[0].y) : null;
  if (held && (phase !== 'recording' || (fromStart ?? 0) > 1)) setHeld(false);
  if (closing === null && phase === 'recording' && autoClose && !held && position && backAtStart(line, position)) setClosing(CLOSE_SECONDS);
  if (closing !== null && (phase !== 'recording' || !autoClose || (fromStart ?? 0) > 0.6)) setClosing(null);
  useEffect(() => {
    if (closing === null) return;
    const t = setTimeout(() => {
      if (closing > 1) return setClosing(closing - 1);
      setClosing(null);
      setHeld(true);
      tick();
      actRef.current('stop_recording');
    }, 1000);
    return () => clearTimeout(t);
  }, [closing]);
  const button = (id: string, label: string, kind?: 'main' | 'danger', after?: () => void, ask?: () => void) =>
    hasAction(A(id)) && (
      <button
        key={id}
        className={kind === 'main' ? styles.primary : kind ? styles[kind] : undefined}
        disabled={!live}
        onClick={
          ask ??
          (() => {
            act(id);
            after?.();
          })
        }
      >
        {ICONS[id]}
        {tr(label)}
      </button>
    );

  let text: React.ReactNode = null;
  let buttons: React.ReactNode[] = [];
  if (phase === 'empty') {
    text = saved
      ? tr('{what} saved. Record the next one, or leave recording mode and fine tune it in the editor.', {what: tr(saved)})
      : tr('Drive to the edge of the new area, then start recording and drive once around it. For the docking station, stop about a meter in front of it, facing it.');
    buttons = [
      button('start_recording', 'Record outline', 'main', () => setSaved(null)),
      button('record_dock', 'Record docking station'),
      !remote && button('exit_recording_mode', 'Leave recording mode', undefined, stop),
    ];
  } else if (phase === 'recording') {
    text = autoClose
      ? hasOutline
        ? tr('Drive around the obstacle, close to it all the way: the line is the middle of the mower. Back at the start, it closes by itself.')
        : tr('Drive along the edge, close to it all the way: the line is the middle of the mower. Back at the start, the outline closes by itself.')
      : hasOutline
        ? tr('Drive around the obstacle, close to it all the way: the line is the middle of the mower. Then stop, it closes by itself.')
        : tr('Drive along the edge, close to it all the way: the line is the middle of the mower. Back at the start, stop: the outline closes by itself.');
    buttons = [
      button('stop_recording', 'Stop', 'main', undefined, hasOutline && line.length < 2 ? () => setEarly(true) : undefined),
      button('collect_point', 'Set point here'),
      button('auto_point_collecting_disable', 'Auto points: on'),
      button('auto_point_collecting_enable', 'Auto points: off'),
      button('finish_discard', 'Discard area', 'danger'),
    ];
  } else if (phase === 'outlined') {
    text = tr('Outline done. Record obstacles inside it (beds, trees, the pond), or save the area.');
    buttons = [
      button('finish_mowing_area', 'Save as mowing area', 'main', () => setSaved('Mowing area')),
      button('start_recording', 'Record obstacle'),
      button('finish_navigation_area', 'Save as navigation area', undefined, () => setSaved('Navigation area')),
      button('finish_discard', 'Discard area', 'danger'),
    ];
  } else if (phase === 'dock') {
    text = tr('Now drive straight into the docking station until it sits on the contacts, then save. The way from the first point to here becomes the docking direction.');
    buttons = [button('record_dock', 'Save docking position', 'main', () => setSaved('Docking station'))];
  }

  // the emergency stop is reset right here, recording goes on where it stopped
  const reason = why ? emergencyText(why) : '';
  const alarm = !!state?.emergency && (
    <>
      <strong>{reason ? tr('Emergency stop: {reason}', {reason}) : tr('Emergency stop')}</strong>
      <span>{tr('Release the mower, then reset the emergency to drive again.')}</span>
      <button disabled={!live} onClick={() => publishAction(ACTION.resetEmergency)}>
        <WarningIcon size={18} />
        {tr('Reset emergency')}
      </button>
    </>
  );

  // the green pill of the sideways layout: the step, while recording with the length of the line so far
  const lineLength = line.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - line[i - 1].x, p.y - line[i - 1].y) : 0), 0);
  const status =
    phase === 'recording'
      ? tr('Recording · {m} m', {m: fmt(lineLength, 1)})
      : phase === 'outlined'
        ? tr('Outline done')
        : phase === 'dock'
          ? tr('Docking station')
          : tr('Recording mode');

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={recordingMode ? styles.hideOnPhone : undefined}>
          <TitleMark />
          {tr('Record')}
        </h1>

        {!state && <p className={styles.dim}>{connected ? tr('waiting for the mower…') : tr('connecting…')}</p>}

        {state && phase === 'off' && (
          <section className={styles.card}>
            <p>
              {tr(
                'Record a new area by driving the mower around it with the joystick on this page. Obstacles inside the area and the docking station can be recorded the same way. Afterwards you can fine tune everything in the',
              )}{' '}
              <Link href="/map">{tr('map editor')}</Link>.
            </p>
            <Link href="/guide" className={styles.guide}>
              {tr('How it works, step by step')}
            </Link>
            <p className={styles.dim}>
              {tr('Keep the mower in sight. It stops as soon as you let go of the stick, switch apps or lose the connection.')}
            </p>
            {knowsAction(A('start_manual_mowing')) && (
              <p className={styles.dim}>
                {tr('Recording mode is also for mowing by hand: switch the blade on and drive with the stick, without recording anything.')}
              </p>
            )}
            <button
              className={styles.primary}
              disabled={!live || !hasAction(START)}
              onClick={() => {
                startedAt.current = Date.now();
                setBounced(false);
                setSaved(null);
                publishAction(START);
                setTimeout(() => void checkBounce().catch(() => {}), 4000);
              }}
            >
              <RecordIcon size={18} />
              {tr('Start recording mode')}
            </button>
            {!hasAction(START) && <p className={styles.dim}>{tr('Only possible while the mower is idle.')}</p>}
            {/* out mowing: home first, then recording mode can start */}
            {!hasAction(START) && hasAction(ACTION.goHome) && (
              <button disabled={!live} onClick={() => publishAction(ACTION.goHome)}>
                <HomeIcon size={18} />
                {tr('Send it home first')}
              </button>
            )}
            {bounced && (
              <p className={styles.warn}>
                {tr(
                  "The mower dropped out of recording mode right away. Older OpenMower versions do that after the mower was sent home while mowing, it then stays in \"manual pause\" until it's restarted. Run openmower restart on the mower and try again, or update OpenMower.",
                )}
              </p>
            )}
          </section>
        )}

        {recordingMode && !remote && (
          <div className={styles.layout}>
            <section className={styles.map}>
              {map && (
                <MapView map={map} mower={position} emergency={!!state?.emergency} follow followSpanMeters={16} zoomable overlay={overlay} datum={datumFromParams(params)} />
              )}
              {/* on the map, so map, stick and buttons fit on one phone screen */}
              <div className={styles.stick}>
                {alarm ? (
                  <div className={styles.alarm}>{alarm}</div>
                ) : !live ? (
                  <p className={styles.warn}>{tr('No connection to the mower, it stops by itself. Driving works again once the connection is back.')}</p>
                ) : (
                  <Joystick size={140} onMove={(x, y) => canDrive && onStick(x, y)} />
                )}
              </div>
            </section>

            <section className={styles.card}>
              <p>{text}</p>
              {closing !== null && (
                <div className={styles.closing}>
                  <span>{tr('Back at the start, closing it in {n} s.', {n: closing})}</span>
                  <button
                    onClick={() => {
                      setClosing(null);
                      setHeld(true);
                    }}
                  >
                    {tr('Keep recording')}
                  </button>
                </div>
              )}
              <div className={styles.buttons}>{buttons}</div>
              {knowsAction(A('start_manual_mowing')) && (
                <div className={styles.buttons}>
                  {button('start_manual_mowing', 'Blade on')}
                  {button('stop_manual_mowing', 'Blade off', 'danger')}
                </div>
              )}
              {bladeOn && (
                <p className={styles.warn}>
                  {tr(
                    'The blade is turning, also while the mower stands still. It goes off when you switch it off, leave this page or the app. If the connection drops or the page reloads or closes, it keeps turning: then press the stop button on the mower.',
                  )}
                </p>
              )}
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={autoClose}
                  onChange={(e) => {
                    setAutoClose(e.target.checked);
                    try {
                      localStorage.setItem(AUTO_CLOSE_KEY, e.target.checked ? '1' : '0');
                    } catch {}
                  }}
                />
                {tr('Close by itself once back at the start')}
              </label>
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
              <div className={styles.phoneOnly}>
                <button onClick={() => turnSideways(true)}>
                  <RotateIcon size={18} />
                  {tr('Sideways')}
                </button>
                <p className={styles.dim}>{tr('Two pads like a remote control car. Turning the phone switches by itself.')}</p>
              </div>
            </section>
          </div>
        )}
      </main>

      {remote && (
        <div ref={remoteRef} className={[styles.remote, turned ? styles.turned : ''].join(' ')}>
          <div className={styles.remoteMap}>
            {map && (
              <MapView
                map={map}
                mower={position}
                emergency={!!state?.emergency}
                follow
                followSpanMeters={SPANS[span]}
                overlay={overlay}
                datum={datumFromParams(params)}
                bare
              />
            )}
          </div>

          <div className={styles.topBar}>
            <span className={[styles.status, phase === 'recording' ? styles.live : ''].join(' ')}>
              <i />
              {status}
            </span>
            <span className={styles.grow} />
            <div className={styles.chips}>
              <button aria-label={tr('Zoom out')} disabled={span === SPANS.length - 1} onClick={() => setSpan(span + 1)}>
                −
              </button>
              <button aria-label={tr('Zoom in')} disabled={span === 0} onClick={() => setSpan(span - 1)}>
                +
              </button>
            </div>
            <div className={styles.chips} title={tr('Speed m/s')}>
              <SpeedIcon size={16} />
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
            {turned && (
              <button className={styles.square} aria-label={tr('Upright')} title={tr('Upright')} onClick={() => turnSideways(false)}>
                <RotateIcon size={20} />
              </button>
            )}
            <button className={styles.square} aria-label={tr('End recording mode')} title={tr('End recording mode')} onClick={endRecording}>
              <CloseIcon size={20} />
            </button>
          </div>

          {closing !== null ? (
            <div className={styles.remoteNote}>
              <span>{tr('Back at the start, closing it in {n} s.', {n: closing})}</span>
              <button
                onClick={() => {
                  setClosing(null);
                  setHeld(true);
                }}
              >
                {tr('Keep recording')}
              </button>
            </div>
          ) : (
            text && <p className={styles.remoteNote}>{text}</p>
          )}
          {alarm ? (
            <div className={styles.remoteWarn}>{alarm}</div>
          ) : (
            !live && <p className={styles.remoteWarn}>{tr('No connection to the mower, it stops by itself. Driving works again once the connection is back.')}</p>
          )}

          <div className={[styles.pad, styles.padLeft].join(' ')}>
            <DrivePad axis="y" turned={turned} disabled={!canDrive} onMove={(v) => canDrive && onStick(stick.current.x, v)} />
          </div>
          <div className={[styles.pad, styles.padRight].join(' ')}>
            <DrivePad axis="x" turned={turned} disabled={!canDrive} onMove={(v) => canDrive && onStick(v, stick.current.y)} />
          </div>

          <div className={styles.bottomBar}>
            {bladeOn && (
              <p className={styles.remoteBlade}>
                {tr(
                  'The blade is turning, also while the mower stands still. It goes off when you switch it off, leave this page or the app. If the connection drops or the page reloads or closes, it keeps turning: then press the stop button on the mower.',
                )}
              </p>
            )}
            <div className={styles.remoteButtons}>
              {buttons}
              {button('start_manual_mowing', 'Blade on')}
              {button('stop_manual_mowing', 'Blade off', 'danger')}
            </div>
          </div>
        </div>
      )}

      {leaving !== null &&
        createPortal(
          <div className={styles.backdrop} onClick={() => setLeaving(null)}>
            <section
              className={[styles.card, styles.dialog].join(' ')}
              role="alertdialog"
              aria-modal="true"
              aria-label={tr('End recording mode?')}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>{tr('End recording mode?')}</h2>
              <p>
                {phase === 'dock'
                  ? tr("The docking station isn't saved yet, recording mode can only end after that. If you leave anyway, it stays on.")
                  : phase === 'recording' || phase === 'outlined'
                    ? tr("The area isn't saved yet and is lost when recording mode ends.")
                    : tr('The mower is still in recording mode. Leaving the page ends it.')}
              </p>
              <div className={styles.buttons}>
                {canExit ? (
                  <button className={phase === 'empty' ? styles.primary : styles.danger} onClick={() => leave(true)}>
                    {tr(phase === 'empty' ? 'End recording mode' : 'Discard and end')}
                  </button>
                ) : (
                  <button onClick={() => leave(false)}>{tr('Leave anyway')}</button>
                )}
                <button onClick={() => setLeaving(null)}>{tr('Stay')}</button>
              </div>
            </section>
          </div>,
        // over the sideways layout, turned with it
        remoteRef.current ?? document.body,
      )}

      {early &&
        createPortal(
          <div className={styles.backdrop} onClick={() => setEarly(false)}>
            <section
              className={[styles.card, styles.dialog].join(' ')}
              role="alertdialog"
              aria-modal="true"
              aria-label={tr('Stop already?')}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>{tr('Stop already?')}</h2>
              <p>
                {tr(
                  'No point of this obstacle is recorded yet. Stopping now makes OpenMower drop the whole area, the outline and the obstacles with it. Better drive on to the obstacle and around it: the way there ends up in its line, the map editor can take it out afterwards.',
                )}
              </p>
              <div className={styles.buttons}>
                <button className={styles.primary} onClick={() => setEarly(false)}>
                  {tr('Keep recording')}
                </button>
                <button
                  className={styles.danger}
                  onClick={() => {
                    setEarly(false);
                    act('finish_discard');
                  }}
                >
                  {tr('Discard area')}
                </button>
              </div>
            </section>
          </div>,
          remoteRef.current ?? document.body,
        )}
    </div>
  );
}
