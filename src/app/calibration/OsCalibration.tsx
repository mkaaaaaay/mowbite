'use client';

import {CalibrationStop} from '@/components/CalibrationStop';
import {TitleMark} from '@/components/Logo';
import MapView from '@/components/MapView';
import {geometryError} from '@/components/MowerBodySettings';
import {TitleRow} from '@/components/TopWeather';
import {CheckIcon, CloseIcon, GuideIcon, HomeIcon, PlayIcon, UndoIcon} from '@/components/icons';
import {useJustReset} from '@/hooks/useEmergencyReset';
import {useMowerMap} from '@/hooks/useMowerMap';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {isLive, useMowerState} from '@/hooks/useMowerState';
import {useCalibEvents} from '@/hooks/useOsCalibration';
import {useRpcMethods} from '@/hooks/useRpcMethods';
import {calibText} from '@/lib/calibration';
import {dayClock} from '@/lib/dates';
import {describe, reasonSentence} from '@/lib/events';
import {fmt, tr} from '@/lib/i18n';
import {loadGeometry, type Geometry} from '@/lib/mowerBody';
import {
  backSettings,
  CHECK_EVERY_MS,
  CHECK_FRESH_MS,
  notTaken,
  offers,
  offersApply,
  offersDrive,
  offersResult,
  osCalibCheck,
  osCalibResult,
  osCalibStart,
  preselected,
  setBack,
  setSizes,
  startRefused,
  stationAgain,
  stripCorners,
  takeSettings,
  type CalibProblem,
  type CalibSpace,
  type Offered,
  type OsCheck,
  type OsResult,
} from '@/lib/osCalibration';
import {RpcError} from '@/lib/rpc';
import {rpcErrorText} from '@/lib/rpcText';
import {GOES_ON, inCalibration, plainIdle, staleText} from '@/lib/status';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import {nameOf, ResultInfo, showValue, ValueCard} from './Result';
import styles from './page.module.css';

type Note = {text: string; warn: boolean};

// a problem of calibration.check in words: its reason's, the mower's own text for one the app doesn't know
const problemText = (p: CalibProblem) => (p.reason ? reasonSentence(p.reason, 'CALIBRATION_REFUSED', p) : p.message || tr('Not possible right now'));

// what became of a start that didn't go through
function startNote(e: unknown): Note {
  const refused = startRefused(e);
  if (refused) {
    const said = describe(refused, undefined, true);
    return {text: said.text, warn: said.severity !== 'info'};
  }
  if (e instanceof RpcError && e.code === 'held') return {text: e.message, warn: true};
  if (e instanceof RpcError && e.code === 'timeout')
    return {text: e.message === 'offline' ? tr('Not sent, no connection to the mower.') : tr("The mower didn't answer (yet)."), warn: true};
  return {text: rpcErrorText(e), warn: true};
}

const meters = (v: number) => fmt(v, 1);

// before the drive: what moves, what the user confirms. the start only with both ticked
function Confirm({space, canStart, onGo, onClose}: {space: CalibSpace | null; canStart: boolean; onGo: () => void; onClose: () => void}) {
  const [clear, setClear] = useState(false);
  const [stay, setStay] = useState(false);
  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-label={tr('The mower moves in a moment')} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetHead}>
          <div>
            <h2>{tr('The mower moves in a moment')}</h2>
            <p className={styles.dim}>{tr('Forward only and slowly, for several minutes. It stops by itself at the end.')}</p>
          </div>
        </div>
        <div className={styles.checks}>
          <div className={styles.check}>
            <span className={[styles.mark, styles.markOk].join(' ')}>
              <CheckIcon size={14} />
            </span>
            <div>{tr('The blade stays off')}</div>
          </div>
        </div>
        <span className={styles.groupLabel}>{tr('You confirm')}</span>
        <div className={styles.checks}>
          <label className={styles.check}>
            <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />
            <div>
              {tr('The strip is clear')}
              <small>
                {space && `${meters(space.length)} × ${meters(space.width)} m: `}
                {tr('no people, no animals, nothing lying there. The mower only knows what is on the map.')}
              </small>
            </div>
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={stay} onChange={(e) => setStay(e.target.checked)} />
            <div>
              {tr('You stay with it')}
              <small>{tr('next to the mower until it stands, a hand at its STOP button')}</small>
            </div>
          </label>
        </div>
        <p className={styles.warn}>
          {tr('Closing the app or losing the connection does not stop the mower. Stop in the app only works while it is connected: when in doubt, press STOP at the mower.')}
        </p>
        <div className={styles.buttons}>
          <button onClick={onClose}>{tr('Cancel')}</button>
          <button className={styles.primary} disabled={!clear || !stay || !canStart} onClick={onGo}>
            <PlayIcon size={18} />
            {tr('Let the mower drive')}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

// the values of a result that can be ticked, and the ones that can't with why
function Values({
  result,
  offered,
  canChange,
  busy,
  apply,
  onSet,
}: {
  result: OsResult;
  offered: Offered[];
  canChange: boolean;
  busy: boolean;
  apply: boolean;
  onSet: (settings: Record<string, number>, back: boolean) => void;
}) {
  const [chosen, setChosen] = useState(() => new Set(offered.filter(preselected).map((o) => o.value.name)));
  const [asking, setAsking] = useState<'take' | 'back' | null>(null);
  const taking = offered.filter((o) => o.offer === 'take' && chosen.has(o.value.name));
  const back = backSettings(offered);
  const moved = stationAgain(result, offered);
  const old = offered.some((o) => o.offer === 'stale');
  const takeable = offered.some((o) => o.offer === 'take');
  // taking none on purpose: the setup's step is ticked with it too
  const keepable = apply && !result.applied && !old;
  if (asking && !canChange) setAsking(null);
  const range = (o: Offered) => ({min: showValue(o.value.name, o.min ?? NaN), max: showValue(o.value.name, o.max ?? NaN)});
  return (
    <>
      {old && <p className={styles.warn}>{tr('The sizes were changed after this drive. Its values no longer fit: drive again.')}</p>}
      {offered.map((o) => (
        <ValueCard key={o.value.name} v={o.value}>
          {o.offer === 'take' ? (
            <label className={styles.take}>
              <input
                type="checkbox"
                checked={chosen.has(o.value.name)}
                disabled={!canChange || busy}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(o.value.name);
                  else next.delete(o.value.name);
                  setChosen(next);
                }}
              />
              {tr('Apply')}
            </label>
          ) : o.offer === 'applied' ? (
            <p className={styles.note}>
              <b>{tr('Applied')}</b>
            </p>
          ) : o.offer === 'same' ? (
            <p className={styles.note}>{tr('The mower has this value already.')}</p>
          ) : o.offer === 'no_key' ? (
            <p className={styles.note}>{tr('No setting on the mower for it.')}</p>
          ) : o.offer === 'out_of_range' ? (
            <p className={styles.note}>{tr("Can't be applied: outside what the mower accepts ({min} to {max}).", range(o))}</p>
          ) : (
            o.offer === 'not_ok' && <p className={styles.note}>{tr("Can't be applied.")}</p>
          )}
          {o.value.key === 'track' && (o.offer === 'take' || o.offer === 'applied') && (
            <p className={styles.note}>{tr('Saved, it only affects driving with a later version.')}</p>
          )}
        </ValueCard>
      ))}
      <ResultInfo result={result} />
      {moved !== null && (
        <section className={[styles.card, styles.warnCard].join(' ')}>
          <b>
            <HomeIcon size={18} /> {tr('Record the docking station again')}
          </b>
          <p>
            {tr('The antenna sits {cm} cm differently than assumed. So the docking station lies that far off on the map, and it docks askew. Record it once again, the record page guides you.', {
              cm: fmt(moved * 100, 0),
            })}
          </p>
          <Link href="/record?station=1" className={[styles.primary, styles.pill].join(' ')}>
            <HomeIcon size={18} />
            {tr('Record it now')}
          </Link>
        </section>
      )}
      {asking && (
        <section className={styles.card} role="group" aria-label={asking === 'take' ? tr('Apply these values?') : tr('Set back to the values before this drive?')}>
          <h2>{asking === 'take' ? tr('Apply these values?') : tr('Set back to the values before this drive?')}</h2>
          <div className={styles.rows}>
            {(asking === 'take' ? taking : offered.filter((o) => o.value.key! in back && o.offer === 'applied')).map((o) => (
              <div key={o.value.name} className={styles.row}>
                <span>{nameOf(o.value.name)}</span>
                <b>
                  {asking === 'take'
                    ? `${o.value.old !== null ? showValue(o.value.name, o.value.old) : '–'} → ${showValue(o.value.name, o.value.value!)}`
                    : `${showValue(o.value.name, o.value.value!)} → ${showValue(o.value.name, o.value.old!)}`}
                </b>
              </div>
            ))}
          </div>
          <p className={styles.dim}>
            {asking === 'take'
              ? tr('The mower saves them as its sizes. The values before stay in this result to set back, until the next calibration drive.')
              : tr('The mower saves the values from before the drive as its sizes again.')}
          </p>
          <div className={styles.buttons}>
            <button onClick={() => setAsking(null)}>{tr('Cancel')}</button>
            <button
              className={styles.primary}
              disabled={busy || !canChange}
              onClick={() => {
                const settings = asking === 'take' ? takeSettings(offered, chosen) : back;
                setAsking(null);
                onSet(settings, asking === 'back');
              }}
            >
              {asking === 'back' ? tr('Yes, set back') : taking.length === 1 ? tr('Apply 1 value') : tr('Apply {n} values', {n: taking.length})}
            </button>
          </div>
        </section>
      )}
      {result.applied?.keys.length === 0 && <p className={styles.dim}>{tr('Kept the sizes as they were ({date}).', {date: dayClock(result.applied.t)})}</p>}
      {!asking && (takeable || keepable) && (
        <div className={styles.buttons}>
          {keepable && (
            <button disabled={busy || !canChange} onClick={() => onSet({}, false)}>
              {tr('Keep the sizes')}
            </button>
          )}
          {takeable && (
            <button className={styles.primary} disabled={!taking.length || busy || !canChange} onClick={() => setAsking('take')}>
              {taking.length === 1 ? tr('Apply 1 value') : tr('Apply {n} values', {n: taking.length})}
            </button>
          )}
        </div>
      )}
      {!asking && Object.keys(back).length > 0 && (
        <div className={styles.resetLine}>
          <span className={styles.dim}>{tr('Changed your mind? The values before this drive are kept until the next one.')}</span>
          <button disabled={busy || !canChange} onClick={() => setAsking('back')}>
            <UndoIcon size={16} />
            {tr('Set back')}
          </button>
        </div>
      )}
      {!canChange && <p className={styles.dim}>{tr('The sizes change only while the mower is idle, not while it records, drives or mows.')}</p>}
    </>
  );
}

// the last result as the OS keeps it: how the drive ended, and its values against the sizes the mower has now
function Result({
  result,
  geo,
  canChange,
  apply,
  onGeo,
  onResult,
}: {
  result: OsResult;
  geo: Geometry | null;
  canChange: boolean;
  apply: boolean;
  onGeo: (g: Geometry) => void;
  onResult: (r: OsResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (settings: Record<string, number>, back: boolean) => {
    if (!geo) return;
    setBusy(true);
    setError(null);
    (back ? setBack(geo, settings).then((geometry) => ({geometry, applied: null})) : setSizes(geo, settings, apply))
      .then(
        ({geometry: g, applied}) => {
          onGeo(g);
          if (applied) onResult({...result, applied});
          const off = notTaken(settings, g);
          if (off.length) setError(tr('The mower answered with other values than the ones sent: {keys}. Check its sizes.', {keys: off.join(', ')}));
        },
        (e) => {
          const d = e instanceof RpcError ? e.data : undefined;
          // changed elsewhere meanwhile: shown as they are now, nothing is sent again by itself
          if (d?.reason === 'VERSION' || d?.reason === 'OUTDATED') {
            loadGeometry().then(onGeo, () => {});
            setError(
              d.reason === 'OUTDATED'
                ? tr('The sizes were changed after this drive. Its values no longer fit: drive again.')
                : tr('The sizes on the mower changed meanwhile. Check the values again.'),
            );
          } else if (d?.reason === 'NO_RESULT') setError(tr('The mower has no result to apply any more. Drive again.'));
          else if (d?.reason === 'NOT_OK') setError(tr("{key} wasn't measured well enough to apply.", {key: String(d.key ?? '')}));
          else setError(geometryError(e));
        },
      )
      .finally(() => setBusy(false));
  };
  const drive = result.reason && result.reason !== 'DONE' ? describe({id: '', t: result.time, type: 'CALIBRATION_FAILED', reason: result.reason, message: result.message}) : null;
  return (
    <>
      <section className={styles.card}>
        <h2>{tr('Last calibration drive')}</h2>
        <p className={styles.dim}>{dayClock(result.time)}</p>
        {result.status === 'done' ? (
          <p className={styles.lead}>
            {tr('From {m} m in {runs} runs and {turns} turns. Tick what to apply.', {
              m: fmt(result.basedOn.m, 0),
              runs: result.basedOn.runs,
              turns: fmt(result.basedOn.turns, 0),
            })}
          </p>
        ) : result.status === 'not_evaluated' ? (
          <p>{tr('Driven, but not evaluated: the planner on the mower is missing or did not answer. Drive again.')}</p>
        ) : drive ? (
          <p>{drive.text}</p>
        ) : (
          <>
            <p>{tr('The evaluation found no usable values.')}</p>
            {result.error && <p className={styles.dim}>{calibText(result.error)}</p>}
          </>
        )}
        {result.status === 'done' && !geo && <p className={styles.warn}>{tr("The mower's sizes didn't come, so nothing can be applied right now.")}</p>}
      </section>
      {result.status === 'done' && geo && (
        <Values key={`${result.id}:${geo.version}`} result={result} offered={offers(result, geo, apply)} canChange={canChange} busy={busy} apply={apply} onSet={set} />
      )}
      {error && (
        <p className={styles.warn} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

// MowBite OS's calibration drive: what stands in its way here as the mower says it, the start after the user's
// confirmation, the drive with its stop, and the result to take into the mower's sizes
export function OsCalibration() {
  const link = useMowerState();
  const {state} = link;
  const live = isLive(link);
  const methods = useRpcMethods();
  const drive = offersDrive(methods);
  const kept = offersResult(methods);
  const running = !!state && inCalibration(state);
  const idle = !!state && plainIdle(state);
  const justReset = useJustReset(!!state?.emergency);
  const {phase, ended} = useCalibEvents(drive || kept);
  const map = useMowerMap();
  const position = useMowerPosition() ?? state?.pose;

  // asked again and again while the mower is idle and the page is seen: only its last answer counts for a start
  const asks = drive && live && idle;
  const [check, setCheck] = useState<{at: number; check: OsCheck} | null>(null);
  if (!asks && check) setCheck(null);
  useEffect(() => {
    if (!asks) return;
    let stop = false;
    const look = () => {
      if (document.visibilityState !== 'visible') return;
      osCalibCheck().then(
        (c) => !stop && setCheck(c && {at: Date.now(), check: c}),
        () => !stop && setCheck(null),
      );
    };
    look();
    const timer = setInterval(look, CHECK_EVERY_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [asks]);

  const [result, setResult] = useState<OsResult | null>(null);
  const [geo, setGeo] = useState<Geometry | null>(null);
  const connected = link.connected;
  // read when the page opens, after a drive and once the connection is back
  useEffect(() => {
    if (!kept || running || !connected) return;
    let stop = false;
    osCalibResult().then(
      (r) => !stop && setResult(r),
      () => {},
    );
    loadGeometry().then(
      (g) => !stop && setGeo(g),
      () => {},
    );
    return () => {
      stop = true;
    };
  }, [kept, running, connected]);

  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const ready = !!check?.check.ok && !justReset && !sending;
  if (asking && !ready) setAsking(false);
  const start = () => {
    setAsking(false);
    // the mower's own word from just now, an older one doesn't start anything
    if (!check?.check.ok || Date.now() - check.at > CHECK_FRESH_MS) return setNote({text: tr("The mower hasn't said just now that the drive can start. Try again in a moment."), warn: true});
    setNote(null);
    setSending(true);
    osCalibStart((late) => late instanceof RpcError && setNote(startNote(late)))
      .catch((e) => setNote(startNote(e)))
      .finally(() => setSending(false));
  };

  const space = check?.check.space ?? null;
  const strip = space && position ? stripCorners(space, position) : null;
  const lane = space && position ? [position, {x: position.x + Math.cos(space.heading) * space.lane_length, y: position.y + Math.sin(space.heading) * space.lane_length}] : null;
  const said = phase && describe({id: '', t: 0, type: 'CALIBRATION', phase: phase.phase}).text;
  const endedSaid = ended && !running ? describe(ended, undefined, true) : null;

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
        {methods === undefined ? (
          <p className={styles.dim}>{tr('connecting…')}</p>
        ) : running ? (
          <section className={styles.card}>
            <h2 className={styles.live}>{tr('Calibration drive running')}</h2>
            {said && (
              <p>
                {said}
                {phase!.index > 0 &&
                  phase!.phase !== 'evaluate' &&
                  ` · ${phase!.rounds ? tr('Round {n} of {of}', {n: phase!.index, of: phase!.rounds}) : tr('Round {n}', {n: phase!.index})}`}
                {!!phase!.seconds && ` · ${tr('about {n} minutes in all', {n: Math.max(1, Math.round(phase!.seconds / 60))})}`}
              </p>
            )}
            {phase?.phase === 'evaluate' && (
              <p className={styles.dim}>
                {tr('The drive is done, the mower stands. The values are being worked out, that can take a few minutes.')}{' '}
                {tr('Stopping now drops the evaluation, the recording is kept.')}
              </p>
            )}
            {!live && !link.resuming && (
              <p className={styles.warn} role="alert">
                {staleText(link, true)}. {tr(GOES_ON)}
              </p>
            )}
            {map && position && (
              <div className={styles.osMap}>
                <MapView map={map} mower={position} emergency={!!state?.emergency} follow followSpanMeters={10} mapStyle="plain" />
              </div>
            )}
          </section>
        ) : (
          <section className={styles.card}>
            <h2>{tr('Calibration drive')}</h2>
            <p className={styles.lead}>
              {tr('The mower measures itself: it drives back and forth on a straight strip, turns on the spot and stands still in between.')}
            </p>
            {!drive ? (
              <p>{reasonSentence('CALIBRATION_MISSING', 'CALIBRATION_REFUSED')}</p>
            ) : !live ? (
              <p className={styles.dim}>{link.resuming || !state ? tr('connecting…') : staleText(link, true)}</p>
            ) : !idle ? (
              <p className={styles.dim}>{tr('Only possible while the mower is idle.')}</p>
            ) : !check ? (
              <p className={styles.dim}>{tr('Asking the mower…')}</p>
            ) : (
              <>
                <div className={styles.checks}>
                  {check.check.problems.map((p, i) => (
                    <div key={`${p.reason}${i}`} className={[styles.check, styles.checkBad].join(' ')} data-problem={p.reason}>
                      <span className={[styles.mark, styles.markBad].join(' ')}>
                        <CloseIcon size={14} />
                      </span>
                      <div>{problemText(p)}</div>
                    </div>
                  ))}
                  {check.check.ok && (
                    <div className={styles.check}>
                      <span className={[styles.mark, styles.markOk].join(' ')}>
                        <CheckIcon size={14} />
                      </span>
                      <div>{tr('Nothing stands in the way of a calibration drive here.')}</div>
                    </div>
                  )}
                </div>
                {space && (
                  <p>
                    {tr('Needs a free strip of {length} × {width} m, the lane is {lane} m long.', {
                      length: meters(space.length),
                      width: meters(space.width),
                      lane: meters(space.lane_length),
                    })}
                  </p>
                )}
                {map && position && strip && lane && (
                  <div className={styles.osMap}>
                    <MapView
                      map={map}
                      mower={position}
                      follow
                      followSpanMeters={Math.max(10, space!.length * 2)}
                      mapStyle="plain"
                      overlay={[
                        {points: strip, color: 'blue', closed: true},
                        {points: lane, color: 'green', closed: false},
                      ]}
                    />
                  </div>
                )}
              </>
            )}
            {note && <p className={note.warn ? styles.warn : styles.dim}>{note.text}</p>}
            {drive && (
              <button className={styles.primary} disabled={!ready} onClick={() => setAsking(true)}>
                <PlayIcon size={18} />
                {tr('Start the calibration drive')}
              </button>
            )}
          </section>
        )}
        {endedSaid && (
          <section className={[styles.card, endedSaid.severity === 'info' ? '' : styles.warnCard].join(' ')}>
            <p>
              <b>{endedSaid.text}</b>
            </p>
            {ended!.type === 'CALIBRATION_FAILED' && <p className={styles.dim}>{tr('The mower stands where it stopped.')}</p>}
          </section>
        )}
        {kept && !running && result && <Result result={result} geo={geo} canChange={live && idle} apply={offersApply(methods)} onGeo={setGeo} onResult={setResult} />}
        {kept && !running && !result && methods !== undefined && <p className={styles.dim}>{tr('Not driven yet')}</p>}
        <Link href="/guide/calibration" className={`${styles.link} ${styles.guide}`}>
          <GuideIcon size={16} />
          {tr('How the calibration drive works')}
        </Link>
        <CalibrationStop running={running} fixed />
      </main>
      {asking && <Confirm space={space} canStart={ready} onGo={start} onClose={() => setAsking(false)} />}
    </div>
  );
}
