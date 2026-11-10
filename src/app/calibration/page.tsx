'use client';

import {TitleMark} from '@/components/Logo';
import {TitleRow} from '@/components/TopWeather';
import {CheckIcon, CloseIcon, PlayIcon} from '@/components/icons';
import {numParam, useMowerParams} from '@/hooks/useMowerParams';
import {useSensorValue} from '@/hooks/useMowerSensors';
import {useMowerActions} from '@/hooks/useMowerActions';
import {isLive, useMowerState} from '@/hooks/useMowerState';
import {loadUpdate} from '@/lib/autoUpdate';
import {
  answerTo,
  calibBack,
  calibCheck,
  calibByHand,
  calibMissing,
  calibMissingText,
  calibProgress,
  calibResult,
  calibStart,
  calibStop,
  calibText,
  lackDone,
  lacks,
  readLast,
  readPaths,
  takeCalib,
  type CalibCheck,
  type CalibMode,
  type CalibResult,
  type CalibValue,
} from '@/lib/calibration';
import {clock} from '@/lib/dates';
import {fmt, tr, useLang} from '@/lib/i18n';
import {ACTION, PARAM, RPC} from '@/lib/openmower';
import {rpcMethods} from '@/lib/rpc';
import {useRpcMethods} from '@/hooks/useRpcMethods';
import {gpsQuality, isDocked} from '@/lib/status';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import Drive from './Drive';
import {LastCalibration, ResultView, Sent} from './Result';
import styles from './page.module.css';

const A = ACTION.recording;
// what the planner needs free for a recording, MB; the battery below which it's better charged first
const FREE_MB = 500;
const LOW_BATTERY = 0.3;
// the time of a tap (out here: what the page hands to a child, the compiler takes for something run while drawing)
const nowMs = () => Date.now();

// the updater's status, again every few seconds while the page is open (more often while it's asked something)
function useUpdater(asked: string | null) {
  const [status, setStatus] = useState<Record<string, string> | null>(null);
  const [tick, setTick] = useState(0);
  // more often while a request of this page has no answer yet (waiting counts as none)
  const answer = answerTo(status?.calib, asked);
  const fast = asked !== null && !(answer && answer.what !== 'waiting');
  useEffect(() => {
    let stop = false;
    const t = setTimeout(
      () =>
        void loadUpdate()
          .then((s) => !stop && setStatus(s?.status ?? null))
          .catch(() => {})
          .finally(() => !stop && setTick((n) => n + 1)),
      tick ? (fast ? 3000 : 10000) : 0,
    );
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [tick, fast]);
  return {status, again: () => setTick((n) => n + 1)};
}

// before it starts: what MowBite checks, what the user confirms (driving by hand only)
function Ready({mode, status, onGo, onClose}: {mode: CalibMode; status: Record<string, string> | null; onGo: () => void; onClose: () => void}) {
  const link = useMowerState();
  const {state} = link;
  const params = useMowerParams();
  const {hasAction} = useMowerActions();
  const [room, setRoom] = useState(false);
  const [stay, setStay] = useState(false);
  // the planner's own look (v0.4.0 on): the receiver's fix, what else stands in the way; again every 10 s while open
  const [check, setCheck] = useState<CalibCheck | null>(null);
  useEffect(() => {
    let stop = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const look = async () => {
      const m = await rpcMethods();
      if (stop || !m?.has(RPC.plannerCalibCheck)) return;
      const c = await calibCheck().catch(() => null);
      if (stop) return;
      setCheck(c);
      t = setTimeout(() => void look(), 10000);
    };
    void look();
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, []);
  // the gps's accuracy as OpenMower uses it: idle (in the dock too) it leaves the gps out, 999 then, though the receiver
  // has its fix. so only shown when good, never a reason not to start: the planner checks the receiver's fix as it starts
  const gpsAcc = useSensorValue('om_gps_accuracy', (v) => (v !== undefined && Number.isFinite(parseFloat(v)) ? parseFloat(v) : null));
  const acc = gpsAcc ?? state?.pose.pos_accuracy;
  const gpsQ = gpsQuality(acc, numParam(params, PARAM.maxPositionAccuracy));
  const battery = state?.battery_percentage;
  const free = /^\d+$/.test(status?.disk_free ?? '') ? Number(status!.disk_free) : null;
  const byHand = mode === 'joystick';
  // (the receiver's fix as the planner sees it, else OpenMower's position: while idle without the gps)
  const rtk = check?.rtk;
  const checks: {ok: boolean; open?: boolean; title: string; text?: string; value?: string}[] = [
    rtk
      ? rtk.fixed
        ? {ok: true, title: tr('RTK fix'), text: tr('Position accurate to a few centimeters'), value: rtk.accuracy === null ? undefined : `${fmt(rtk.accuracy * 100, 1)} cm`}
        : {ok: true, open: true, title: tr('No RTK fix yet'), text: tr(byHand ? 'Needed when the calibration starts.' : 'It counts once there is one.')}
      : gpsQ === 'fix'
        ? {ok: true, title: tr('RTK fix'), text: tr('Position accurate to a few centimeters'), value: `${fmt(acc! * 100, 1)} cm`}
        : {ok: true, open: true, title: tr('RTK fix'), text: tr('Checked as it starts: while idle OpenMower leaves the GPS out of its position.')},
    battery === undefined || battery >= LOW_BATTERY
      ? {ok: true, title: tr('Battery'), value: battery === undefined ? '–' : `${Math.round(battery * 100)} %`}
      : {ok: false, title: tr('Battery too low'), text: tr('Let it charge in the dock first.'), value: `${Math.round(battery * 100)} %`},
    free === null || free >= FREE_MB
      ? {ok: true, title: tr('Storage for the recording'), value: free === null ? '–' : tr('{size} free', {size: free >= 1000 ? `${fmt(free / 1000, 1)} GB` : `${free} MB`})}
      : {ok: false, title: tr('Not enough storage'), text: tr('The recording needs at least {size} free.', {size: `${FREE_MB} MB`}), value: `${free} MB`},
  ];
  // what else the planner finds in the way (its fix and the storage are above)
  for (const p of check?.problems ?? [])
    if (!['NO_RTK', 'POSITION_ACCURACY', 'DISK_SPACE'].includes(p.reason)) checks.push({ok: false, title: tr('Not possible right now'), text: calibText(p.message)});
  // driving by hand needs recording mode, only to be had while idle
  if (byHand && state?.current_state !== 'AREA_RECORDING' && !hasAction(ACTION.startRecording))
    checks.push({ok: false, title: tr('The mower is busy'), text: tr('Driving by hand only works while it is idle. Send it home or wait until it is.')});
  const bad = checks.some((c) => !c.ok);
  const missing = byHand ? [!room && tr('Room to drive'), !stay && tr('You stay with it')].filter(Boolean) : [];
  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-label={tr('Ready to calibrate?')} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetHead}>
          <div>
            <h2>{tr('Ready to calibrate?')}</h2>
            <p className={styles.dim}>
              {byHand ? tr('{way} · about {n} minutes', {way: tr('Drive it yourself'), n: 5}) : tr('On the next mowing run')}
            </p>
          </div>
        </div>
        <span className={styles.groupLabel}>{tr('MowBite checks')}</span>
        <div className={styles.checks}>
          {checks.map((c) => (
            <div key={`${c.title}|${c.text ?? ''}`} className={[styles.check, c.ok ? '' : styles.checkBad].join(' ')}>
              <span className={[styles.mark, c.open ? styles.markOpen : c.ok ? styles.markOk : styles.markBad].join(' ')}>
                {c.open ? '?' : c.ok ? <CheckIcon size={14} /> : <CloseIcon size={14} />}
              </span>
              <div>
                {c.title}
                {c.text && <small>{c.text}</small>}
              </div>
              {c.value && <span className={styles.value}>{c.value}</span>}
            </div>
          ))}
        </div>
        {byHand && !bad && (
          <>
            <span className={styles.groupLabel}>{tr('You confirm')}</span>
            <div className={styles.checks}>
              <label className={styles.check}>
                <input type="checkbox" checked={room} onChange={(e) => setRoom(e.target.checked)} />
                <div>
                  {tr('Room to drive')}
                  <small>{tr('A level lane of about 7 × 3 m, no beds, edges or toys')}</small>
                </div>
              </label>
              <label className={styles.check}>
                <input type="checkbox" checked={stay} onChange={(e) => setStay(e.target.checked)} />
                <div>
                  {tr('You stay with it')}
                  <small>{tr('and can stop it any time with Cancel or the stop button')}</small>
                </div>
              </label>
            </div>
          </>
        )}
        {!byHand && !bad && (
          <p className={styles.dim}>
            {tr("It records from now on and ends by itself after the next mow, after 2 hours at the latest: start a mow soon. The blade runs as always, nothing else changes.")}
          </p>
        )}
        {bad ? null : missing.length === 1 ? (
          <p className={styles.dim}>{tr('Tick “{what}” too, then it starts.', {what: missing[0] as string})}</p>
        ) : missing.length === 2 ? (
          <p className={styles.dim}>{tr('Tick both points above, then it starts.')}</p>
        ) : (
          <Link href="/guide/calibration" className={styles.link}>
            {tr('Read the guide first (2 min)')}
          </Link>
        )}
        <div className={styles.buttons}>
          <button onClick={onClose}>{bad ? tr('Close') : tr('Cancel')}</button>
          {!bad && !missing.length && (
            <button className={styles.primary} onClick={onGo}>
              <PlayIcon size={18} />
              {tr("Let's go")}
            </button>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

// the calibration of OpenMower's sizes from a drive: recorded and worked out by the MowBite Planner (planner.calib.*),
// what's taken written into mower_params.yaml by the MowBite Updater (?calib), by hand without it. nothing of it runs
// in a build without it or without a planner that offers it
export default function CalibrationPage() {
  useLang();
  const missing = calibMissing(useRpcMethods());
  if (!missing) return <Calibration />;
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <TitleRow>
          <h1>
            <TitleMark />
            {tr('Calibration')}
          </h1>
        </TitleRow>
        <Link href="/settings#mower" className={styles.link}>
          ← {tr('Settings')}
        </Link>
        {missing === 'connecting' ? (
          <p className={styles.dim}>{tr('connecting…')}</p>
        ) : (
          <section className={styles.card}>
            <p>{calibMissingText(missing)}</p>
          </section>
        )}
      </main>
    </div>
  );
}

function Calibration() {
  const link = useMowerState();
  const {state} = link;
  const live = isLive(link);
  const {hasAction, publishAction} = useMowerActions();
  const progress = useSyncExternalStore(calibProgress.subscribe, calibProgress.get, calibProgress.initial);

  const [mode, setMode] = useState<CalibMode>('joystick');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalibResult | null>(null);
  const [sent, setSent] = useState<{before: string; values: CalibValue[]; byHand: CalibValue[]} | null>(null);
  // a request of this page to the updater (taking values, setting back): its state before, to tell the answer from it
  const [asked, setAsked] = useState<string | null>(null);
  const {status, again} = useUpdater(asked);
  const paths = readPaths(status?.calib_paths);

  const recordingMode = state?.current_state === 'AREA_RECORDING';
  // where the updater writes: idle on the station
  const docked = isDocked(state, useSensorValue('om_v_charge', (v) => v));
  // a recording started or seen on this page (its start for the clock)
  const [since, setSince] = useState<number | null>(null);
  const phase = progress?.phase ?? null;
  // the result is shown once worked out while the page is open (not after cancel), or when asked for
  const [show, setShow] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [was, setWas] = useState(phase);
  // the recording driven by hand from here ended: back to the dock in recording mode, then out of it
  const [ended, setEnded] = useState(false);
  if (phase !== was) {
    setWas(phase);
    if (was === 'recording') setEnded(true);
    // (evaluating may come and go between two messages)
    if ((was === 'evaluating' || was === 'recording') && phase === 'done' && !cancelled) {
      setShow(true);
      setSent(null);
    }
  }
  const failed = progress?.error ?? null;
  useEffect(() => {
    if (!show || phase !== 'done' || failed) return;
    let stop = false;
    calibResult().then(
      (r) => !stop && setResult(r),
      (e) => !stop && setError(calibText(e instanceof Error ? e.message : String(e))),
    );
    return () => {
      stop = true;
    };
  }, [show, phase, failed]);

  // a joystick recording waiting for recording mode to start, then started (once: the planner says no to a second one)
  // driving by hand: recording mode first (OpenMower takes the gps in then), the mower driven into position with the
  // stick, then the recording started from there (once: the planner says no to a second one)
  const [placing, setPlacing] = useState(false);
  const [starting, setStarting] = useState(false);
  const called = useRef(false);
  useEffect(() => {
    if (!starting || !recordingMode || called.current) return;
    called.current = true;
    let stop = false;
    calibStart('joystick').then(
      () => {
        if (stop) return;
        setStarting(false);
        setPlacing(false);
      },
      (e) => {
        if (stop) return;
        setStarting(false);
        setError(calibText(e instanceof Error ? e.message : String(e)));
      },
    );
    return () => {
      stop = true;
    };
  }, [starting, recordingMode]);
  useEffect(() => {
    if (!starting) called.current = false;
  }, [starting]);
  // recording mode asked for and not there within 10 s
  useEffect(() => {
    if (!placing || recordingMode) return;
    const t = setTimeout(() => {
      setPlacing(false);
      setError(tr("The mower didn't go into recording mode. Is it busy right now?"));
    }, 10000);
    return () => clearTimeout(t);
  }, [placing, recordingMode]);

  // the docking station recorded again after the antenna moved (Sent's card): with the record page's guide
  const router = useRouter();
  const startStation = () => router.push('/record?station=1');

  const go = async () => {
    setAsking(false);
    setError(null);
    setCancelled(false);
    setEnded(false);
    setTaken(false);
    setShow(false);
    setResult(null);
    setSent(null);
    setSince(nowMs());
    if (mode === 'mow') {
      try {
        await calibStart('mow');
      } catch (e) {
        setError(calibText(e instanceof Error ? e.message : String(e)));
      }
      return;
    }
    if (!recordingMode) publishAction(ACTION.startRecording);
    setPlacing(true);
  };
  const stopRecording = async (cancel: boolean) => {
    setCancelled(cancel);
    try {
      await calibStop();
    } catch (e) {
      setError(calibText(e instanceof Error ? e.message : String(e)));
    }
  };
  const endRecordingMode = () => {
    if (hasAction(A('exit_recording_mode'))) publishAction(A('exit_recording_mode'));
    setPlacing(false);
    setStarting(false);
  };
  // the result taken: not offered again until the next recording
  const [taken, setTaken] = useState(false);
  const take = async (values: CalibValue[], lines: string, byHand: CalibValue[]) => {
    const before = status?.calib ?? '';
    if (lines) await takeCalib(lines);
    setTaken(true);
    setSent({before, values, byHand});
    setAsked(lines ? before : null);
    setShow(false);
    setResult(null);
    again();
  };
  const back = async () => {
    const before = status?.calib ?? '';
    await calibBack();
    setAsked(before);
    again();
  };

  const list = progress ? lacks(progress) : [];
  const drivingByHand = calibByHand(progress, recordingMode);
  // driving it back to the dock after driving by hand, in recording mode still
  const homeDrive = ended && phase !== 'recording' && recordingMode;

  let body: React.ReactNode;
  if (!state) {
    body = <p className={styles.dim}>{tr('connecting…')}</p>;
  } else if (placing && phase !== 'recording') {
    // into position with the stick first, then the recording started
    body = recordingMode ? (
      <Drive progress={null} since={null} placing starting={starting} onStart={() => setStarting(true)} onStop={endRecordingMode} onDone={endRecordingMode} />
    ) : (
      <p className={styles.dim}>{tr('Starting recording mode…')}</p>
    );
  } else if (drivingByHand) {
    body = <Drive progress={progress!} since={since} onStop={() => void stopRecording(true)} onDone={() => void stopRecording(false)} />;
  } else if (phase === 'recording') {
    // the next mow: nothing to do but to start it
    body = (
      <>
        <section className={styles.card}>
          <span className={styles.live}>
            {since ? tr('Measures while mowing · since {time}', {time: clock(since / 1000)}) : tr('Measures while mowing')}
          </span>
          <p className={styles.now}>{tr("It mows and measures along. You don't need to do anything.")}</p>
          <p className={styles.dim}>{tr('Ends by itself once there\'s enough, after {n} hours at the latest.', {n: 2})}</p>
          {hasAction(ACTION.startMowing) && (
            <button className={styles.primary} disabled={!live} onClick={() => publishAction(ACTION.startMowing)}>
              <PlayIcon size={18} />
              {tr('Start mowing')}
            </button>
          )}
        </section>
        {list.length > 0 && (
          <section className={styles.card}>
            <h2>{tr('Still to measure')}</h2>
            <div className={styles.rows}>
              {list.map((l) => (
                <div key={l.part} className={[styles.row, lackDone(l) ? styles.rowDone : ''].join(' ')}>
                  <span>
                    {tr({still: 'Stand {n} s', straight: 'Straight lanes', left: 'Turns left', right: 'Turns right'}[l.part], {n: fmt(l.need, 0)})}
                    <small>{tr('{n} of {m}', {n: fmt(l.has, 0), m: fmt(l.need, 0)})}</small>
                  </span>
                  <b>{lackDone(l) ? <CheckIcon size={16} /> : l.left > 0 ? tr('{n} more', {n: fmt(Math.ceil(l.left), 0)}) : tr('{n} more rounds on the spot', {n: fmt(l.more, 1)})}</b>
                </div>
              ))}
            </div>
            {list.some((l) => (l.part === 'left' || l.part === 'right') && l.left === 0 && l.more > 0) && (
              <p className={styles.dim}>{tr('The antenna needs turns on the spot, a mow seldom has them: then drive it yourself for the antenna.')}</p>
            )}
          </section>
        )}
        <button className={styles.danger} onClick={() => void stopRecording(true)}>
          {tr('Cancel')}
        </button>
      </>
    );
  } else if (phase === 'evaluating') {
    body = (
      <section className={styles.card}>
        <span className={styles.live}>{tr('Works it out')}</span>
        <p className={styles.dim}>{tr('The planner works the values out from the recording. That can take a few minutes, after driving by hand mostly under a minute.')}</p>
      </section>
    );
  } else if (show && result) {
    body = (
      <ResultView
        result={result}
        paths={paths}
        onTake={take}
        onDrop={() => {
          setShow(false);
          setResult(null);
        }}
      />
    );
  } else if (sent) {
    body = (
      <>
        <Sent sent={sent} status={status} docked={docked} onBack={back} onStation={startStation} />
        <button onClick={() => setSent(null)}>
          {tr('Close')}
        </button>
      </>
    );
  } else {
    body = (
      <>
        <p className={styles.lead}>
          {tr('Measures the distance per wheel turn, the wheel distance and where the antenna sits. Then it drives straighter lanes and docks more cleanly.')}
        </p>
        {phase === 'done' && failed && !cancelled && <p className={styles.warn}>{tr('The last recording gave no result: {why}', {why: calibText(failed)})}</p>}
        <section className={styles.card}>
          <h2>{tr(readLast(status?.calib_last) ? 'Calibrate again' : 'Calibrate')}</h2>
          <span className={styles.dim}>{tr('How should it measure?')}</span>
          {(
            [
              ['joystick', 'Drive it yourself', 'You drive with the joystick following the guide: straight runs, turns, standing still.', tr('~{n} min', {n: 5})],
              ['mow', 'On the next mowing run', 'It measures along while mowing. The antenna only when it also turns on the spot.', tr('up to {n} h', {n: 2})],
            ] as const
          ).map(([k, title, text, time]) => (
            <label key={k} className={[styles.choice, mode === k ? styles.choiceOn : ''].join(' ')}>
              <input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} />
              <div>
                <b>{tr(title)}</b>
                <span>{tr(text)}</span>
              </div>
              <span className={styles.chip}>{time}</span>
            </label>
          ))}
          <button className={styles.primary} disabled={!live} onClick={() => setAsking(true)}>
            <PlayIcon size={20} />
            {tr('Start calibration')}
          </button>
          <Link href="/guide/calibration" className={styles.link}>
            {tr('Guide: how to drive it right')}
          </Link>
        </section>
        {phase === 'done' && !failed && !taken && (
          <button onClick={() => setShow(true)}>
            {tr('Show the result of the last recording')}
          </button>
        )}
        <LastCalibration status={status} asked={asked} docked={docked} onBack={back} />
      </>
    );
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <TitleRow className={drivingByHand ? styles.hideOnPhone : undefined}>
          <h1>
            <TitleMark />
            {show && result ? tr('Result') : tr('Calibration')}
          </h1>
        </TitleRow>
        {!drivingByHand && (
          <Link href="/settings#mower" className={styles.link}>
            ← {tr('Settings')}
          </Link>
        )}
        {error && <p className={styles.warn}>{error}</p>}
        {/* first back to the dock (the updater writes only there), the result under it */}
        {homeDrive && (
          <>
            <p className={styles.dim}>{tr('The recording is done. Drive the mower back onto the docking station, then leave recording mode.')}</p>
            <Drive progress={progress} since={since} home onStop={endRecordingMode} onDone={endRecordingMode} />
          </>
        )}
        {body}
      </main>
      {asking && <Ready mode={mode} status={status} onGo={() => void go()} onClose={() => setAsking(false)} />}
    </div>
  );
}
