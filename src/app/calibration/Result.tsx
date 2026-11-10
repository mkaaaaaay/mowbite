'use client';

import {CheckIcon, HomeIcon, UndoIcon} from '@/components/icons';
import {useMowerActions} from '@/hooks/useMowerActions';
import {isLive, useMowerState} from '@/hooks/useMowerState';
import {answerTo, calibLines, calibText, changeOf, preselected, readLast, readPaths, readState, type CalibPath, type CalibResult, type CalibValue} from '@/lib/calibration';
import {copyText} from '@/lib/clipboard';
import {clock} from '@/lib/dates';
import {fmt, locale, tr} from '@/lib/i18n';
import {ACTION} from '@/lib/openmower';
import {rpcErrorText} from '@/lib/rpcText';
import {useState} from 'react';
import styles from './page.module.css';

// how the dialog names each value; the paths of the planner's table, for writing them in by hand when the updater has
// no list (an older one, or no file it can write)
const NAMES: Record<string, [string, string?]> = {
  ticks_per_m: ['Distance per wheel turn', 'Ticks per meter'],
  wheel_distance_m: ['Wheel distance'],
  antenna_offset_x: ['Antenna ahead of the axle'],
  antenna_offset_y: ['Antenna left of the middle'],
};
const KNOWN_PATHS: Record<string, string> = {
  ticks_per_m: 'll/services/diff_drive/ticks_per_m',
  wheel_distance_m: 'll/services/diff_drive/wheel_distance_m',
  antenna_offset_x: 'xbot_positioning/antenna_offset_x',
  antenna_offset_y: 'xbot_positioning/antenna_offset_y',
};
// a big change as the planner marks it: over 10 % for the ticks, 5 % for the wheels, 5 cm for the antenna
const BIG_LIMIT: Record<string, string> = {ticks_per_m: '10 %', wheel_distance_m: '5 %', antenna_offset_x: '5 cm', antenna_offset_y: '5 cm'};
// the antenna moved by more than this: the docking station lies that far off on the map
const STATION_AGAIN = 0.02;

const decimals = (v: number) => Math.min(4, (String(v).split('.')[1] ?? '').length);
export const nameOf = (name: string) => tr(NAMES[name]?.[0] ?? name);
export function showValue(name: string, v: number): string {
  return name === 'ticks_per_m' ? fmt(v, decimals(v) ? 1 : 0) : `${fmt(v, Math.max(2, decimals(v)))} m`;
}
const signed = (v: number, digits: number) => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmt(Math.abs(v), digits);
// a difference in the unit it reads best in: ticks, mm for the wheels, cm for the antenna
function showDiff(name: string, d: number): string {
  if (name === 'ticks_per_m') return signed(d, 1);
  if (name === 'wheel_distance_m') return `${signed(d * 1000, 1)} mm`;
  return `${signed(d * 100, 1)} cm`;
}
const showSigma = (name: string, s: number) => showDiff(name, s).replace(/^[+−±]/, '');

const QUALITY: Record<string, string> = {good: 'good', fair: 'fair', poor: 'poor'};

// the names of what the updater wrote, by its paths
function nameByPath(path: string, paths: Record<string, CalibPath>): string {
  return Object.entries(paths).find(([, p]) => p.path === path)?.[0] ?? Object.entries(KNOWN_PATHS).find(([, p]) => p === path)?.[0] ?? path;
}

// the antenna moved by more than STATION_AGAIN by the values taken: the station is to be recorded again
export function stationAgain(values: {name: string; old: number | null; value: number | null}[]): number | null {
  const moved = values.filter((v) => v.name.startsWith('antenna_offset_') && v.old !== null && v.value !== null).map((v) => Math.abs(v.value! - v.old!));
  const most = Math.max(0, ...moved);
  return most > STATION_AGAIN ? most : null;
}

// what the planner worked out, each value against the one set now, to tick what to take
export function ResultView({
  result,
  paths,
  onTake,
  onDrop,
}: {
  result: CalibResult;
  paths: Record<string, CalibPath>;
  onTake: (taken: CalibValue[], lines: string, byHand: CalibValue[]) => Promise<void>;
  onDrop: () => void;
}) {
  const [chosen, setChosen] = useState(() => new Set(result.values.filter(preselected).map((v) => v.name)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = result.values.filter((v) => v.ok && chosen.has(v.name)).length;
  const speed = typeof result.info.speed_ratio === 'number' ? result.info.speed_ratio : null;
  // each wheel's ticks a metre against RTK (from the wheels' own counters): one value for both is all OpenMower has
  const sides = typeof result.info.ticks_per_m_left === 'number' && typeof result.info.ticks_per_m_right === 'number' ? [result.info.ticks_per_m_left, result.info.ticks_per_m_right] : null;
  const take = async () => {
    const {lines, byHand} = calibLines(result.values, chosen, paths);
    setBusy(true);
    setError(null);
    try {
      await onTake(
        result.values.filter((v) => v.ok && chosen.has(v.name)),
        lines,
        byHand,
      );
    } catch (e) {
      setError(rpcErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className={styles.lead}>
        {tr('From {m} m in {runs} runs and {turns} turns. Tick what to apply.', {
          m: fmt(result.basedOn.m, 0),
          runs: result.basedOn.runs,
          turns: fmt(result.basedOn.turns, 0),
        })}
      </p>
      {result.values.map((v) => {
        const c = changeOf(v);
        const quality = v.quality ? (v.ok ? tr(QUALITY[v.quality]) : tr('too inaccurate')) : null;
        return (
          <section key={v.name} className={[styles.card, styles.result, c?.big ? styles.big : '', v.ok ? '' : styles.off].join(' ')}>
            <div className={styles.resultTop}>
              <div className={styles.name}>
                {nameOf(v.name)}
                {NAMES[v.name]?.[1] && <small>{tr(NAMES[v.name][1]!)}</small>}
              </div>
              {quality && <span className={[styles.chip, styles[v.ok ? (v.quality ?? 'poor') : 'poor']].join(' ')}>{quality}</span>}
            </div>
            <div className={styles.change}>
              <span className={styles.old}>{v.old !== null ? showValue(v.name, v.old) : '–'}</span>
              <span>→</span>
              <span className={styles.new}>{v.value !== null ? showValue(v.name, v.value) : '–'}</span>
              {c && (
                <span className={styles.delta}>
                  {showDiff(v.name, c.abs)}
                  {c.pct !== null && v.name !== 'antenna_offset_x' && v.name !== 'antenna_offset_y' && ` · ${signed(c.pct, 1)} %`}
                  {c.big && ` · ${tr('big change')}`}
                </span>
              )}
            </div>
            {c?.unchanged && v.sigma !== null && (
              <p className={styles.note}>{tr('Unchanged: the difference is smaller than the measuring accuracy (±{sigma}).', {sigma: showSigma(v.name, v.sigma)})}</p>
            )}
            {c?.big && (
              <p className={styles.note}>
                {v.name.startsWith('antenna_offset_')
                  ? tr('More than {limit}. Is the antenna still fixed tightly? If so, the old value was probably off.', {limit: BIG_LIMIT[v.name]})
                  : tr('More than {limit}. Check it before you apply it.', {limit: BIG_LIMIT[v.name]})}
              </p>
            )}
            {v.warning && !(c?.big && v.warning.startsWith('large change')) && <p className={styles.note}>{calibText(v.warning)}</p>}
            {v.ok ? (
              <label className={styles.take}>
                <input
                  type="checkbox"
                  checked={chosen.has(v.name)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(v.name);
                    else next.delete(v.name);
                    setChosen(next);
                  }}
                />
                {c?.unchanged ? tr('Apply anyway') : tr('Apply')}
              </label>
            ) : (
              <p className={styles.note}>{tr("Can't be applied.")}</p>
            )}
          </section>
        );
      })}

      {(result.warnings.length > 0 || speed !== null || sides) && (
        <section className={[styles.card, styles.info].join(' ')}>
          <b>{tr('Just for your information')}</b>
          {result.warnings.map((w) => (
            <p key={w}>{calibText(w)}</p>
          ))}
          {speed !== null && <p>{tr('It drives at {p} % of the speed asked for.', {p: fmt(speed * 100, 0)})}</p>}
          {sides && <p>{tr('Each wheel on its own: left {l}, right {r} ticks/m ({d} % apart).', {l: fmt(sides[0], 0), r: fmt(sides[1], 0), d: fmt(Math.abs(sides[0] / sides[1] - 1) * 100, 1)})}</p>}
        </section>
      )}

      {error && <p className={styles.warn}>{error}</p>}
      <div className={styles.buttons}>
        <button onClick={onDrop} disabled={busy}>
          {tr('Drop it')}
        </button>
        <button className={styles.primary} disabled={!n || busy} onClick={() => void take()}>
          {n === 1 ? tr('Apply 1 value') : tr('Apply {n} values', {n})}
        </button>
      </div>
    </>
  );
}

// the values to write into mower_params.yaml by hand, as yaml
export function ByHand({values}: {values: {name: string; value: number}[]}) {
  const tree: Record<string, unknown> = {};
  for (const v of values) {
    const keys = (KNOWN_PATHS[v.name] ?? v.name).split('/');
    let at = tree;
    keys.slice(0, -1).forEach((k) => (at = (at[k] ??= {}) as Record<string, unknown>));
    at[keys[keys.length - 1]] = v.value;
  }
  const yaml = (o: Record<string, unknown>, ind = ''): string =>
    Object.entries(o)
      .map(([k, v]) => (typeof v === 'object' ? `${ind}${k}:\n${yaml(v as Record<string, unknown>, ind + '  ')}` : `${ind}${k}: ${v}\n`))
      .join('');
  const text = yaml(tree);
  const [copied, setCopied] = useState(false);
  return (
    <section className={styles.card}>
      <h2>{tr('Values to enter by hand')}</h2>
      <p className={styles.dim}>{tr("Your updater can't write them itself: an older one, or it finds no mower_params.yaml it may write.")}</p>
      <p>{tr('Enter them in {file} and restart OpenMower ({cmd}).', {file: 'mower_params.yaml', cmd: 'openmower restart'})}</p>
      <pre className={styles.code}>{text}</pre>
      <button onClick={() => (copyText(text), setCopied(true))}>{copied ? tr('Copied') : tr('Copy')}</button>
    </section>
  );
}

// what the updater says about the last request, a line
function stateLine(
  calib: string | undefined,
  asked: string | null,
  docked: boolean,
): {what: string; chip: string; text: string; tone: 'fair' | 'good' | 'poor'} | null {
  const fresh = answerTo(calib, asked);
  const time = fresh ? clock(fresh.at) : '';
  // OpenMower takes the gyro's zero from its first seconds, moved then the mower turns by itself afterwards
  const still = tr("Don't touch the mower in the dock until OpenMower has restarted: it measures the gyro in its first seconds.");
  if (!fresh)
    return asked !== null
      ? {
          what: 'asked',
          chip: tr('asked'),
          text: `${docked ? tr('The updater takes it within a minute.') : tr('The updater writes them once the mower stands quietly in the dock.')} ${still}`,
          tone: 'fair',
        }
      : null;
  switch (fresh.what) {
    case 'waiting':
      return {
        what: fresh.what,
        chip: tr('waiting'),
        text: `${tr('Takes effect after a restart of OpenMower. The updater restarts it by itself once the mower stands quietly in the dock.')} ${still}`,
        tone: 'fair',
      };
    case 'written':
      return {what: fresh.what, chip: tr('in effect'), text: tr('Restarted, in effect since {time}.', {time}), tone: 'good'};
    case 'back':
      return {what: fresh.what, chip: tr('in effect'), text: tr('Set back, OpenMower restarted at {time}.', {time}), tone: 'good'};
    case 'refused':
      return {what: fresh.what, chip: tr('not written'), text: tr('The updater wrote nothing: {why}', {why: (fresh.why ?? '').replace(/_/g, ' ')}), tone: 'poor'};
    default:
      return {
        what: fresh.what,
        chip: tr('not written'),
        text:
          fresh.why === 'not_docked'
            ? tr("The mower wasn't idle in the dock within 30 minutes, nothing was written. Try again once it's in the dock.")
            : fresh.why === 'not_running'
              ? tr("OpenMower didn't come up again with the new values, the file before is back.")
              : tr('The updater could not hold the schedule, nothing was written.'),
        tone: 'poor',
      };
  }
}

// after taking them: what was asked to be written, what the updater did with it. the antenna moved: the docking station
// recorded again with the record page's guide (onStation) once the values are in effect
export function Sent({
  sent,
  status,
  docked,
  onBack,
  onStation,
}: {
  sent: {before: string; values: CalibValue[]; byHand: CalibValue[]};
  status: Record<string, string> | null;
  docked: boolean;
  onBack: () => Promise<void>;
  onStation: () => void;
}) {
  const link = useMowerState();
  const {hasAction} = useMowerActions();
  const asked = sent.values.filter((v) => !sent.byHand.includes(v));
  const line = stateLine(status?.calib, sent.before, docked);
  const written = line?.what === 'written';
  const moved = stationAgain(asked);
  const paths = readPaths(status?.calib_paths);
  // recording mode, only to be had while idle (or still on)
  const idle = link.state?.current_state === 'AREA_RECORDING' || hasAction(ACTION.startRecording);
  return (
    <>
      {asked.length > 0 && (
        <section className={styles.card}>
          <div className={styles.sheetHead}>
            {written && (
              <span className={[styles.badge, styles.good].join(' ')}>
                <CheckIcon size={22} />
              </span>
            )}
            <div>
              <h2>
                {written
                  ? asked.length === 1
                    ? tr('1 value applied')
                    : tr('{n} values applied', {n: asked.length})
                  : line?.what === 'back'
                    ? tr('Values set back')
                    : line?.tone === 'poor'
                      ? tr('Not applied')
                      : asked.length === 1
                        ? tr('Applying 1 value')
                        : tr('Applying {n} values', {n: asked.length})}
              </h2>
              {written && <p className={styles.dim}>{tr('in mower_params.yaml, the old ones are kept')}</p>}
            </div>
          </div>
          <div className={styles.rows}>
            {asked.map((v) => (
              <div key={v.name} className={styles.row}>
                <span>
                  {nameOf(v.name)}
                  <code>{paths[v.name]?.path ?? KNOWN_PATHS[v.name]}</code>
                </span>
                <b>{showValue(v.name, v.value!)}</b>
              </div>
            ))}
          </div>
          {line && (
            <div className={styles.stateLine}>
              <span className={[styles.chip, styles[line.tone]].join(' ')}>{line.chip}</span>
              <span>{line.text}</span>
            </div>
          )}
        </section>
      )}
      {moved !== null && line?.what !== 'back' && (
        <section className={[styles.card, styles.warnCard].join(' ')}>
          <b>
            <HomeIcon size={18} /> {tr('Record the docking station again')}
          </b>
          <p>
            {tr(
              'The antenna sits {cm} cm differently than assumed. So the docking station lies that far off on the map, and it docks askew. Record it once again after the restart, the record page guides you.',
              {cm: fmt(moved * 100, 0)},
            )}
          </p>
          {/* (with the values before the station would be recorded just as far off again) */}
          <button className={[styles.primary, styles.pill].join(' ')} disabled={!written || !idle || !isLive(link)} onClick={onStation}>
            <HomeIcon size={18} />
            {tr('Record it now')}
          </button>
          {!written ? (
            <p className={styles.dim}>{tr('Possible once the new values are in effect.')}</p>
          ) : (
            !idle && <p className={styles.dim}>{tr('Only possible while the mower is idle.')}</p>
          )}
        </section>
      )}
      {sent.byHand.length > 0 && <ByHand values={sent.byHand.map((v) => ({name: v.name, value: v.value!}))} />}
      {written && <SetBack status={status} onBack={onBack} text={tr('Changed your mind? Everything back to how it was.')} />}
    </>
  );
}

// back to the file before the last calibration, asked once more first
function SetBack({status, onBack, text}: {status: Record<string, string> | null; onBack: () => Promise<void>; text: string}) {
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status?.calib_backup) return null;
  return (
    <div className={styles.resetLine}>
      <span className={styles.dim}>{sure ? tr('mower_params.yaml back to how it was before, OpenMower restarted in the dock.') : text}</span>
      <button
        onClick={() => {
          if (!sure) return setSure(true);
          setSure(false);
          onBack().catch((e) => setError(rpcErrorText(e)));
        }}
      >
        <UndoIcon size={16} />
        {sure ? tr('Yes, set back') : tr('Set back')}
      </button>
      {error && <p className={styles.warn}>{error}</p>}
    </div>
  );
}

// the last calibration the updater wrote: when, each value before and after, set back
export function LastCalibration({
  status,
  asked,
  docked,
  onBack,
}: {
  status: Record<string, string> | null;
  asked: string | null;
  docked: boolean;
  onBack: () => Promise<void>;
}) {
  const last = readLast(status?.calib_last);
  const paths = readPaths(status?.calib_paths);
  const state = readState(status?.calib);
  const line = asked !== null ? stateLine(status?.calib, asked, docked) : null;
  // set back since: the values before apply again (the copy stays, setting back again changes nothing)
  const reverted = !!last && state?.what === 'back' && state.at >= last.at;
  const when = (t: number) => new Date(t * 1000).toLocaleString(locale(), {day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'});
  return (
    <section className={styles.card}>
      <h2>{tr('Last calibration')}</h2>
      {!last ? (
        <p className={styles.dim}>{tr('Never calibrated')}</p>
      ) : (
        <>
          <p className={styles.dim}>{when(last.at)}</p>
          <div className={styles.rows}>
            {last.values.map((v) => {
              const name = nameByPath(v.path, paths);
              return (
                <div key={v.path} className={styles.row}>
                  <span>{nameOf(name)}</span>
                  <b>
                    {showValue(name, v.old)} → {showValue(name, v.new)}
                  </b>
                </div>
              );
            })}
          </div>
        </>
      )}
      {line ? (
        <div className={styles.stateLine}>
          <span className={[styles.chip, styles[line.tone]].join(' ')}>{line.chip}</span>
          <span>{line.text}</span>
        </div>
      ) : (
        reverted && <p className={styles.dim}>{tr('Set back on {date}, the values before apply again.', {date: when(state!.at)})}</p>
      )}
      {!reverted && <SetBack status={status} onBack={onBack} text={tr('Everything back to how it was before the last calibration.')} />}
    </section>
  );
}
