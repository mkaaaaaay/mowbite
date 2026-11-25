'use client';

import DriveView, {driveStyles as ds, useDrive} from '@/components/DriveView';
import {AutoPointsIcon, BladeIcon, CheckIcon, CloseIcon, HomeIcon, OutlineDoneIcon, PinIcon, RecordIcon, RouteIcon, TrashIcon, UndoIcon} from '@/components/icons';
import {TitleMark} from '@/components/Logo';
import {TitleRow} from '@/components/TopWeather';
import {useHeadingDrift} from '@/hooks/useHeadingDrift';
import {useMapOverlay} from '@/hooks/useMapOverlay';
import {useJustReset} from '@/hooks/useEmergencyReset';
import {useCommandNote, useMowerActions, useTapLock} from '@/hooks/useMowerActions';
import {useMowerMap, type DockingStation, type MowerMap} from '@/hooks/useMowerMap';
import {recordedIn} from '@/lib/sameMap';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {isLive, useMowerState} from '@/hooks/useMowerState';
import Link from 'next/link';
import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useRef, useState} from 'react';
import {useCalibratingByHand} from '@/hooks/useCalibratingByHand';
import {createPortal} from 'react-dom';
import StationGuide from './Station';
import styles from './page.module.css';
import {stationChange, type Station} from '@/lib/dockGuide';
import {fmt, tr, useLang} from '@/lib/i18n';
import {ACTION, RPC, TOPIC, UNDO_METERS} from '@/lib/openmower';
import {usePlatform} from '@/lib/mowerOs';
import {useRpcMethods} from '@/hooks/useRpcMethods';
import {useSure} from '@/hooks/useSure';
import {eventsOfDay, fileDay, forgetToday, historyDays} from '@/lib/history';
import {backAtStart} from '@/lib/geometry';
import {tick} from '@/lib/haptics';
import {guardLeaving} from '@/lib/leaving';
import {parseEvent, refusalText, type MowerEvent} from '@/lib/events';
import {onTopic} from '@/lib/mqttClient';
import {SAVE_WAIT_MS} from '@/lib/recordingJob';
import {NOT_DRIVEN} from '@/lib/reasonTexts';
import {markRecording, useRecordingJob} from '@/components/RecordingWatch';

const START = ACTION.startRecording;
const A = ACTION.recording;
// the page is open: react mounts it twice while developing, leaving it is only when it stays closed
let open = 0;

type Phase = 'off' | 'empty' | 'recording' | 'outlined' | 'dock';

// back at the start of the line: closed after this many seconds unless the user goes on. on unless switched off
const CLOSE_SECONDS = 3;
const AUTO_CLOSE_KEY = 'recordAutoClose';
// how many metres the map shows across around the mower (sideways the zoom steps go from there)
const SPAN = 16;

// next to the text on the buttons, to tell them apart at a glance
const ICONS: Record<string, React.ReactNode> = {
  start_recording: <RecordIcon size={18} />,
  record_dock: <HomeIcon size={18} />,
  exit_recording_mode: <CloseIcon size={18} />,
  stop_recording: <OutlineDoneIcon size={18} />,
  collect_point: <PinIcon size={18} />,
  undo_points: <UndoIcon size={18} />,
  auto_point_collecting_enable: <AutoPointsIcon size={18} />,
  auto_point_collecting_disable: <AutoPointsIcon size={18} />,
  finish_discard: <TrashIcon size={18} />,
  finish_mowing_area: <CheckIcon size={18} />,
  finish_navigation_area: <RouteIcon size={18} />,
  start_manual_mowing: <BladeIcon size={18} />,
  stop_manual_mowing: <BladeIcon size={18} />,
};

// ?station: from the calibration's card and the setup, the docking station's button at hand (its guide once in recording mode).
// useSearchParams needs a suspense boundary in a static export
export default function RecordPage() {
  return (
    <Suspense>
      <Record />
    </Suspense>
  );
}

function Record() {
  useLang();
  const link = useMowerState();
  const {state, connected} = link;
  const live = isLive(link);
  const {hasAction, knowsAction, publishAction} = useMowerActions();
  const map = useMowerMap();
  const position = useMowerPosition() ?? state?.pose;
  const overlay = useMapOverlay();
  // MowBite OS records the docking station its own way: there only OpenMower's two steps
  const platform = usePlatform();
  const os = platform === 'os';
  const om = platform === 'om';
  // a save sent: saved once the map has it (OpenMower drops an area it can't use without a word), late when it hasn't
  // come after SAVE_WAIT_MS
  const [save, setSave] = useState<{what: string; kind: 'mow' | 'nav' | 'dock'; before: MowerMap | null; at: 'sent' | 'late' | 'saved'} | null>(null);
  if (save && save.at !== 'saved' && recordedIn(save.kind, save.before, map)) setSave({...save, at: 'saved'});
  useEffect(() => {
    if (save?.at !== 'sent') return;
    const t = setTimeout(() => setSave((s) => (s?.at === 'sent' ? {...s, at: 'late'} : s)), SAVE_WAIT_MS);
    return () => clearTimeout(t);
  }, [save]);
  const saved = save?.at === 'saved' ? save.what : null;
  const expectSaved = (what: string, kind: 'mow' | 'nav' | 'dock') => setSave({what, kind, before: map, at: 'sent'});
  // the mower left recording mode within a moment of starting it (see the hint below)
  const [bounced, setBounced] = useState(false);
  const startedAt = useRef(0);
  const wasRecording = useRef(false);
  // recording mode started or driven in from this page
  const mine = useRef(false);

  const recordingMode = state?.current_state === 'AREA_RECORDING';
  const recordingRef = useRef(recordingMode);
  recordingRef.current = recordingMode;
  useEffect(() => {
    if (recordingMode) wasRecording.current = true;
    else if (wasRecording.current) {
      wasRecording.current = false;
      if (startedAt.current && Date.now() - startedAt.current < 8000) setBounced(true);
    }
  }, [recordingMode]);
  // the areas of the map when the mode began, for a job the mower interrupted (components/RecordingWatch): kept at a start
  // from here, else once the mode is seen here (started elsewhere, a reload) and the map is there
  const marked = useRef(false);
  useEffect(() => {
    if (!recordingMode) marked.current = false;
    else if (map && !marked.current) {
      marked.current = true;
      markRecording(map, false);
    }
  }, [recordingMode, map]);
  const interrupted = hasAction(ACTION.resetJob);
  const {drop: jobDrop} = useRecordingJob();
  // the state is published once a second, a bounce is usually over before that: the event history has it
  const checkBounce = async () => {
    if (recordingRef.current || !startedAt.current) return;
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
  // an OpenMower with rpcs has mowing by hand too, its actions are only told once recording mode was on
  const methods = useRpcMethods();
  const newer = !!methods;
  // MowBite OS takes the end of the line back, the mower stays where it is
  const undo = !!methods?.has(RPC.recordingUndo);

  // the docking station recorded with the guide (Station.tsx), in recording mode with nothing else recorded. asked for
  // before recording mode is there: it comes once it is, ends when it ends or something else is recorded
  const [guide, setGuide] = useState(false);
  const [guideSeen, setGuideSeen] = useState(false);
  if (guide && recordingMode && !guideSeen) setGuideSeen(true);
  if (!guide && guideSeen) setGuideSeen(false);
  if (guide && ((guideSeen && !recordingMode) || (recordingMode && phase !== 'empty'))) setGuide(false);
  useEffect(() => {
    if (!guide || guideSeen) return;
    const t = setTimeout(() => setGuide(false), 10000);
    return () => clearTimeout(t);
  }, [guide, guideSeen]);
  // the station it saved, told on the page after it
  const [station, setStation] = useState<{station: Station; before: DockingStation | null} | null>(null);

  // the stick, held sideways the two pads; the sideways layout for dialogs over it
  const remoteRef = useRef<HTMLDivElement>(null);
  const drive = useDrive({show: recordingMode, onMove: () => (mine.current = true)});
  // the heading running away while it stands: OpenMower's gyro got a wrong zero when it started (MowBite OS holds it)
  const drift = useHeadingDrift(recordingMode && om, drive.movedAt);
  const driftLine = drift !== null && (
    <em className={ds.missed}>{tr('The heading drifts {n}°/s while it stands: restart OpenMower before it mows', {n: fmt(Math.abs(drift) * (180 / Math.PI), 1)})}</em>
  );

  // mowing by hand: in recording mode OpenMower runs the blade until it's switched off or the mode ends, also while the
  // mower stands still
  const bladeOn = recordingMode && hasAction(A('stop_manual_mowing'));
  const justReset = useJustReset(!!state?.emergency);
  const [bladeTapped, bladeTap] = useTapLock();
  const blade = useRef({on: bladeOn, off: () => publishAction(A('stop_manual_mowing'))});
  blade.current = {on: bladeOn, off: () => publishAction(A('stop_manual_mowing'))};
  // after an emergency stop it would start again by itself once that's reset
  useEffect(() => {
    if (state?.emergency && bladeOn && live) blade.current.off();
  }, [state?.emergency, bladeOn, live]);
  // the station's guide has no blade buttons: it opens once the blade is off, asked for it goes off first
  const guiding = guide && recordingMode && phase === 'empty' && !os && !bladeOn;
  useEffect(() => {
    if (guide && bladeOn && live) blade.current.off();
  }, [guide, bladeOn, live]);
  // said while it waits for that, and given up after a while: the blade stays on, the drive view with it
  const guideWaits = guide && recordingMode && bladeOn;
  useEffect(() => {
    if (!guideWaits) return;
    const t = setTimeout(() => setGuide(false), 10000);
    return () => clearTimeout(t);
  }, [guideWaits]);
  // leaving the page or putting the phone away switches the blade off (the stick stops by itself)
  useEffect(() => {
    const hidden = () => {
      if (document.hidden && blade.current.on) blade.current.off();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      if (blade.current.on) blade.current.off();
    };
  }, []);

  // a step the mower turned down, with why: MowBite OS sends it, OpenMower doesn't (then nothing shows). gone with the next
  // step, another phase, or for a point once the line goes on
  const [refused, setRefused] = useState<MowerEvent | null>(null);
  // MowBite OS: why the outline being recorded has no exact edge any more, as far as the app sees it (a driven_reason):
  // reversing, points taken back or set by hand, Auto points off. The others only come with the saved area
  const [edgeLost, setEdgeLost] = useState<string | null>(null);
  // the line discarded to record it again: started again once it's gone
  const restart = useRef(false);
  useEffect(
    () =>
      onTopic(TOPIC.events, (payload) => {
        const e = parseEvent(payload.toString());
        if (e?.type !== 'RECORDING_REFUSED') return;
        setRefused(e);
        restart.current = false;
        if (e.reason === 'REVERSING') setEdgeLost((r) => r ?? 'REVERSED');
        // saving it didn't work after all
        if (e.action?.startsWith('finish_') || e.action === 'record_dock') setSave(null);
      }),
    [],
  );
  // what MowBite OS answered to a step sent as a call, when it isn't a RECORDING_REFUSED shown above (another state, no
  // answer)
  const commandNote = useCommandNote(['RECORDING_REFUSED']);
  // a line that crosses itself: the way out where the mower can take its end back
  const wayOut = refused?.reason === 'RING_CROSSES_ITSELF' && undo ? `. ${tr('Take its end back with the back button, then stop again.')}` : '';
  const refusedText = refused ? refusalText(refused) + wayOut : (commandNote?.text ?? '');
  const act = (id: string) => {
    setRefused(null);
    publishAction(A(id));
  };
  const actRef = useRef(act);
  actRef.current = act;
  const start = (withGuide: boolean) => {
    startedAt.current = Date.now();
    mine.current = true;
    setBounced(false);
    setSave(null);
    setRefused(null);
    setStation(null);
    setGuide(withGuide);
    if (map) markRecording(map, true);
    publishAction(START);
    setTimeout(() => void checkBounce().catch(() => {}), 4000);
  };
  // the guide asked for in the address: opened once the mower is known in recording mode with nothing recorded. the address
  // never starts recording mode, the station's button below does
  const search = useSearchParams();
  const [asked, setAsked] = useState(() => search.has('station'));
  const fromLink = !asked || !state || os ? null : recordingMode && phase === 'empty' ? 'guide' : 'drop';
  const router = useRouter();
  // a calibration drive by hand runs in recording mode: its own page, not this one. only where the planner says so: one
  // on the next mow leaves this page free
  const calibrating = useCalibratingByHand(recordingMode);
  useEffect(() => {
    if (calibrating) router.replace('/calibration');
  }, [calibrating, router]);
  useEffect(() => {
    if (!fromLink) return;
    setAsked(false);
    // (not again on a reload once it's done)
    router.replace('/record');
    if (fromLink === 'guide') setGuide(true);
  }, [fromLink, router]);

  // reloading, closing or switching mowers asks first while something isn't saved yet or the blade turns: what's sent
  // from a page that unloads doesn't get out any more. a switch of mowers sends the stop and the blade's off before
  const guarded = recordingMode && (phase !== 'empty' || bladeOn);
  const halt = useRef(() => {});
  halt.current = () => {
    drive.stop();
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
  const [leaving, setLeaving] = useState<string | null>(null);
  // stop on a line without a second point yet (the mower hasn't moved 10 cm since it started, or no point set with auto
  // points off): OpenMower then drops the whole area, so with an outline to lose it asks first. MowBite OS refuses the stop
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
      // only a mode started or driven in from here: another phone may be recording with it
      if (!recordingMode || ended || phase !== 'empty' || !canExit || !mine.current) return;
      setTimeout(() => open || publishAction(A('exit_recording_mode')), 300);
    };
  }, [publishAction]);
  // ended from here: no hint that it dropped out by itself
  const exitMode = () => {
    startedAt.current = 0;
    drive.stop();
    act('exit_recording_mode');
  };
  const leave = (end: boolean) => {
    const to = leaving;
    setLeaving(null);
    if (end && canExit) {
      away.current.ended = true;
      exitMode();
    }
    if (to) router.push(to);
  };
  // the cross of the sideways layout ends recording mode, it asks first when something isn't saved yet
  const endRecording = () => {
    if (phase !== 'empty' || !canExit) return setLeaving('');
    exitMode();
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
  const [refusedAt, setRefusedAt] = useState({phase, points: line.length});
  if (refused && (refusedAt.phase !== phase || (refusedAt.points < line.length && (refused.action === 'point' || refused.action === 'collect_point'))))
    setRefused(null);
  if (refusedAt.phase !== phase || refusedAt.points !== line.length) setRefusedAt({phase, points: line.length});
  const fromStart = line.length && position ? Math.hypot(position.x - line[0].x, position.y - line[0].y) : null;
  if (held && (phase !== 'recording' || (fromStart ?? 0) > 1)) setHeld(false);
  // (not without a connection: the stop wouldn't get out, and it wouldn't be tried again)
  if (closing === null && live && phase === 'recording' && autoClose && !held && position && backAtStart(line, position)) setClosing(CLOSE_SECONDS);
  if (closing !== null && (!live || phase !== 'recording' || !autoClose || (fromStart ?? 0) > 0.6)) setClosing(null);
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
  const keepRecording = () => {
    setClosing(null);
    setHeld(true);
  };
  // discarding takes two taps: the first asks for a few seconds (it sits next to save)
  const [askDiscard, setAskDiscard] = useState(false);
  useEffect(() => {
    if (!askDiscard) return;
    const t = setTimeout(() => setAskDiscard(false), 4000);
    return () => clearTimeout(t);
  }, [askDiscard]);
  const discardTap = () => {
    if (!askDiscard) return setAskDiscard(true);
    setAskDiscard(false);
    act('finish_discard');
  };
  // a step's button, upright in the card, sideways in the bar at the bottom
  const button = (id: string, label: string, kind?: 'primary' | 'danger', after?: () => void, ask?: () => void) =>
    hasAction(A(id)) && (
      <button
        key={id}
        className={kind && ds[kind]}
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
  const discardButton = button('finish_discard', askDiscard ? 'Really discard?' : 'Discard area', 'danger', undefined, discardTap);
  // the area's outline on MowBite OS, where the exact edge counts
  const outlining = os && phase === 'recording' && !hasOutline;
  if (edgeLost && !outlining) setEdgeLost(null);
  if (outlining && !edgeLost && hasAction(A('auto_point_collecting_enable'))) setEdgeLost('INTERRUPTED');
  const lose = (reason: string) => () => outlining && setEdgeLost((r) => r ?? reason);
  useEffect(() => {
    if (phase === 'empty' && restart.current) actRef.current('start_recording');
    if (phase !== 'recording') restart.current = false;
  }, [phase]);
  const {sure, confirm} = useSure();
  // the outline thrown away and started again from where the mower stands, after asking
  const againButton = edgeLost && hasAction(A('finish_discard')) && (
    <button
      key="record_again"
      className={sure === 'again' ? ds.danger : undefined}
      disabled={!live}
      onClick={() =>
        confirm('again', () => {
          restart.current = true;
          act('finish_discard');
        })
      }
    >
      {ICONS.start_recording}
      {tr(sure === 'again' ? 'Sure? Discard the line and start again here' : 'Record again for the exact edge')}
    </button>
  );
  // the docking station: with the guide on OpenMower, OpenMower's own two steps on MowBite OS
  const stationButton = (again: boolean) =>
    os ? (
      button('record_dock', 'Record docking station')
    ) : (
      <button key="station" disabled={!live || !hasAction(A('record_dock'))} onClick={() => setGuide(true)}>
        <HomeIcon size={18} />
        {tr(again ? 'Record the docking station again' : 'Record docking station')}
      </button>
    );
  const hasStation = !!map?.docking_stations.length;

  // what to do now, short on the map; the longer why in the card under it
  let say: React.ReactNode = null;
  let text: React.ReactNode = null;
  let buttons: React.ReactNode[] = [];
  // while a line is recorded: how to drive it, on MowBite OS also what the exact edge takes
  let hints: string[] = [];
  if (phase === 'empty') {
    const lost = save?.at === 'late' ? tr("{what} didn't arrive in the map. Look at the map, or record it again.", {what: tr(save.what)}) : null;
    say = saved ? (
      <>
        <b>{tr('{what} saved.', {what: tr(saved)})}</b> {tr('The next one, or leave recording mode.')}
      </>
    ) : lost ? (
      <b>{lost}</b>
    ) : (
      <>
        <b>{tr('Drive to the edge of the new area')}</b> · {tr('then record its outline')}
      </>
    );
    text = saved
      ? tr('{what} saved. Record the next one, or leave recording mode and fine-tune it in the editor.', {what: tr(saved)})
      : lost
        ? lost
        : os
          ? tr('Drive to the edge of the new area, then start recording and drive once around it. For the docking station, stop about a meter in front of it, at least half a meter, facing it.')
          : tr('Drive to the edge of the new area, then start recording and drive once around it. The docking station: its button guides you through it.');
    buttons = [
      button('start_recording', 'Record outline', 'primary', () => setSave(null)),
      hasAction(A('record_dock')) && stationButton(hasStation),
      !drive.remote &&
        button('exit_recording_mode', 'Leave recording mode', undefined, () => {
          startedAt.current = 0;
          drive.stop();
        }),
    ];
  } else if (phase === 'recording') {
    const then = tr(autoClose ? 'it closes by itself back at the start' : 'then stop back at the start');
    say = (
      <>
        <b>{tr(hasOutline ? 'Closely around the obstacle' : 'Along the edge')}</b> · {then}
      </>
    );
    text = autoClose
      ? hasOutline
        ? tr('Drive around the obstacle, close to it all the way: the line is the middle of the mower. Back at the start, it closes by itself.')
        : tr('Drive along the edge, close to it all the way: the line is the middle of the mower. Back at the start, the outline closes by itself.')
      : hasOutline
        ? tr('Drive around the obstacle, close to it all the way: the line is the middle of the mower. Then stop, it closes by itself.')
        : tr('Drive along the edge, close to it all the way: the line is the middle of the mower. Back at the start, stop: the outline closes by itself.');
    hints = [
      tr('Drive forwards all the way while recording.'),
      tr('Drive corners a little inside and blunt, not with a sharp turn.'),
      ...(os
        ? [
            tr('Took a wrong turn? Back up a bit, the mower takes the last points back. The exact edge is lost by that.'),
            tr('The exact edge only comes from driving the whole round forwards without a break, with Auto points on. The recorded outline pass needs it.'),
          ]
        : []),
    ];
    buttons = [
      button('stop_recording', 'Stop', 'primary', undefined, !os && hasOutline && line.length < 2 ? () => setEarly(true) : undefined),
      againButton,
      undo && button('undo_points', tr('Back {m} m', {m: UNDO_METERS}), undefined, lose('INTERRUPTED')),
      button('collect_point', 'Set point here', undefined, lose('MANUAL_POINT')),
      button('auto_point_collecting_disable', 'Auto points: on'),
      button('auto_point_collecting_enable', 'Auto points: off'),
      discardButton,
    ];
  } else if (phase === 'outlined') {
    say = (
      <>
        <b>{tr('Outline done')}</b> · {tr('obstacles inside it, or save the area')}
      </>
    );
    text = tr('Outline done. Record obstacles inside it (beds, trees, the pond), or save the area.');
    buttons = [
      button('finish_mowing_area', 'Save as mowing area', 'primary', () => expectSaved('Mowing area', 'mow')),
      button('start_recording', 'Record obstacle'),
      button('finish_navigation_area', 'Save as navigation area', undefined, () => expectSaved('Navigation area', 'nav')),
      discardButton,
    ];
  } else if (phase === 'dock') {
    say = (
      <>
        <b>{tr('Straight into the docking station')}</b> · {tr('then save')}
      </>
    );
    text = tr('Now drive straight into the docking station until it sits on the contacts, then save. The way from the first point to here becomes the docking direction.');
    buttons = [button('record_dock', 'Save docking position', 'primary', () => expectSaved('Docking station', 'dock'))];
  }
  // back at the start: closing by itself unless the user goes on
  if (closing !== null)
    say = (
      <>
        <b>{tr('Back at the start')}</b> · {tr('closing it in {n} s', {n: closing})}
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
  const blades = knowsAction(A('start_manual_mowing'));
  // on and off each at their own place, never one under the finger where the other was. on takes two taps and is held
  // back for a moment after a blade tap and after an emergency reset; off goes at once, whenever connected
  const bladeOnButton = blades && (
    <button
      key="blade_on"
      className={sure === 'blade' ? ds.danger : undefined}
      disabled={!live || !hasAction(A('start_manual_mowing')) || justReset || !!bladeTapped}
      onClick={() =>
        confirm('blade', () => {
          bladeTap('on');
          act('start_manual_mowing');
        })
      }
    >
      {ICONS.start_manual_mowing}
      {tr(sure === 'blade' ? 'Sure? Blade on' : 'Blade on')}
    </button>
  );
  const bladeOffButton = blades && (
    <button
      key="blade_off"
      className={ds.danger}
      disabled={!connected}
      onClick={() => {
        bladeTap('off');
        act('stop_manual_mowing');
      }}
    >
      {ICONS.stop_manual_mowing}
      {tr('Blade off')}
    </button>
  );
  const bladeWarn = tr(
    'The blade is turning, also while the mower stands still. It goes off when you switch it off, leave this page or the app. If the connection drops or the page reloads or closes, it keeps turning: then press the emergency stop button on the mower.',
  );
  // the station the guide saved, how far from the one before
  const change = station?.before ? stationChange(station.before, station.station) : null;
  const stationLine = station && (
    <p className={styles.savedLine}>
      <CheckIcon size={16} /> {tr('Docking station saved')}
      {' · '}
      {!change
        ? tr('New in the map.')
        : change.moved < 0.005 && change.turned < 0.5 * (Math.PI / 180)
          ? tr('In the same place as before.')
          : tr('{cm} cm and {deg}° from the one before.', {cm: fmt(change.moved * 100, 0), deg: fmt(change.turned * (180 / Math.PI), 1)})}
    </p>
  );

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <TitleRow className={recordingMode ? styles.hideOnPhone : undefined}>
          <h1>
            <TitleMark />
            {tr(guiding ? 'Record docking station' : 'Record')}
          </h1>
        </TitleRow>

        {!state && <p className={styles.dim}>{connected ? tr('waiting for the mower…') : tr('connecting…')}</p>}

        {state && phase === 'off' && guide && <p className={styles.dim}>{tr('Starting recording mode…')}</p>}
        {state && phase === 'off' && !guide && (
          <section className={styles.card}>
            {stationLine}
            <p>
              {tr(
                'Record a new area by driving the mower around it with the joystick on this page. Obstacles inside the area and the docking station can be recorded the same way. Afterwards you can fine-tune everything in the',
              )}{' '}
              <Link href="/map">{tr('map editor')}</Link>.
            </p>
            <Link href="/guide" className={styles.guide}>
              {tr('How it works, step by step')}
            </Link>
            <p className={styles.dim}>
              {tr('Keep the mower in sight. It stops as soon as you let go of the stick, switch apps or lose the connection.')}
            </p>
            {(knowsAction(A('start_manual_mowing')) || newer) && (
              <p className={styles.dim}>
                {tr('Recording mode is also for mowing by hand: switch the blade on and drive with the stick, without recording anything.')}
              </p>
            )}
            {/* a job the mower interrupted goes by the old map: recording an area ends it once the mode is over */}
            {jobDrop === 'gone' && (
              <p className={styles.dim}>{tr('The interrupted job was planned on the old map, it ended with the recording. The next start plans on the new one.')}</p>
            )}
            {interrupted && (
              <p className={jobDrop === 'left' ? styles.warn : styles.dim}>
                {tr(
                  jobDrop === 'left'
                    ? 'The map is on the mower, but the interrupted job still follows the old map. Drop it on the dashboard before the next start.'
                    : 'An interrupted job is waiting. Recording an area ends it, the next start plans on the new map.',
                )}
              </p>
            )}
            <button className={styles.primary} disabled={!live || !hasAction(START)} onClick={() => start(false)}>
              <RecordIcon size={18} />
              {tr('Start recording mode')}
            </button>
            {!os && (
              <button disabled={!live || !hasAction(START)} onClick={() => start(true)}>
                <HomeIcon size={18} />
                {tr(hasStation ? 'Record the docking station again' : 'Record docking station')}
              </button>
            )}
            {!hasAction(START) && <p className={styles.dim}>{tr('Only possible while the mower is idle.')}</p>}
            {/* out mowing: home first, then recording mode can start */}
            {!hasAction(START) && hasAction(ACTION.goHome) && (
              <button disabled={!live} onClick={() => publishAction(ACTION.goHome)}>
                <HomeIcon size={18} />
                {tr('Send it home first')}
              </button>
            )}
            {refusedText && <p className={styles.warn}>{refusedText}</p>}
            {bounced && om && (
              <p className={styles.warn}>
                {tr(
                  "The mower dropped out of recording mode right away. Older OpenMower versions do that after the mower was sent home while mowing, it then stays in \"manual pause\" until it's restarted. Run openmower restart on the mower and try again, or update OpenMower.",
                )}
              </p>
            )}
          </section>
        )}

        {guiding && (
          <StationGuide
            drive={drive}
            drift={driftLine}
            remoteRef={remoteRef}
            onSaved={setStation}
            onExit={() => {
              setGuide(false);
              exitMode();
            }}
            onClose={() => setGuide(false)}
          />
        )}

        {recordingMode && !guiding && (
          <DriveView
            drive={drive}
            camera
            say={say}
            missed={driftLine}
            ok={closing !== null}
            status={status}
            live={phase === 'recording'}
            span={SPAN}
            overlay={overlay}
            gpsHint={tr('Without an RTK fix the edge ends up off.')}
            line={phase === 'recording' && <span>{tr('Recording · {m} m', {m: fmt(lineLength, 1)})}</span>}
            note={
              closing !== null ? (
                <>
                  <span>{tr('Back at the start, closing it in {n} s.', {n: closing})}</span>
                  <button onClick={keepRecording}>{tr('Keep recording')}</button>
                </>
              ) : undefined
            }
            warn={refusedText}
            close={{label: tr('End recording mode'), onClick: endRecording}}
            remoteRef={remoteRef}
            bottom={
              <>
                {bladeOn && <p className={ds.remoteBlade}>{bladeWarn}</p>}
                <div className={ds.remoteButtons}>
                  {bladeOnButton}
                  {buttons}
                  {bladeOffButton}
                </div>
              </>
            }
          >
            {phase === 'empty' && stationLine}
            {guideWaits && <p className={ds.warn}>{tr('Switching the blade off for the docking station guide…')}</p>}
            {refusedText && <p className={ds.warn}>{refusedText}</p>}
            {edgeLost && (
              <p className={ds.warn}>
                {tr('No exact edge any more ({why}). For the recorded outline pass, start the round again from here.', {why: tr(NOT_DRIVEN[edgeLost])})}
              </p>
            )}
            {drift !== null && (
              <p className={ds.warn}>
                {tr(
                  'OpenMower measures the gyro while it starts, the mower moved then: its heading turns by itself now and it would mow askew. Restart OpenMower (openmower restart) while the mower stands still.',
                )}
              </p>
            )}
            <p className={ds.dim}>{text}</p>
            {hints.map((h) => (
              <p key={h} className={ds.dim}>
                {h}
              </p>
            ))}
            {closing !== null && (
              <div className={styles.closing}>
                <span>{tr('Back at the start, closing it in {n} s.', {n: closing})}</span>
                <button onClick={keepRecording}>{tr('Keep recording')}</button>
              </div>
            )}
            <div className={styles.buttons}>
              {bladeOnButton}
              {buttons}
              {bladeOffButton}
            </div>
            {bladeOn && <p className={ds.warn}>{bladeWarn}</p>}
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
          </DriveView>
        )}
      </main>

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
                {phase === 'dock' && !leaving
                  ? tr("The docking station isn't saved yet, recording mode can only end after that.")
                  : phase === 'dock'
                  ? tr("The docking station isn't saved yet, recording mode can only end after that. If you leave anyway, it stays on.")
                  : phase === 'recording' || phase === 'outlined'
                    ? tr("The area isn't saved yet and is lost when recording mode ends.")
                    : tr('The mower is still in recording mode. Leaving the page ends it.')}
              </p>
              <div className={styles.buttons}>
                {canExit ? (
                  // (it wouldn't get out without a connection)
                  <button className={phase === 'empty' ? styles.primary : styles.danger} disabled={!live} onClick={() => leave(true)}>
                    {tr(phase === 'empty' ? 'End recording mode' : 'Discard and end')}
                  </button>
                ) : leaving ? (
                  <button onClick={() => leave(false)}>{tr('Leave anyway')}</button>
                ) : null}
                <button onClick={() => setLeaving(null)}>{tr(canExit || leaving ? 'Stay' : 'OK')}</button>
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
