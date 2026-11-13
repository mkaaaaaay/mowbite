'use client';

import {datumFromParams, useMowerParams} from '@/hooks/useMowerParams';
import {tr} from '@/lib/i18n';
import {
  loadKept,
  mowsIntoNight,
  onOs,
  PARAM_FIELDS,
  paramField,
  paramConflict,
  paramName,
  paramShown,
  paramValue,
  parseParam,
  saveKept,
  setParams,
  showParam,
  type KeptParams,
  type ParamField,
  type ParamGroup,
} from '@/lib/mowerParams';
import {isMowbiteOs, systemInfo, useMowbiteOs} from '@/lib/mowerOs';
import {RPC} from '@/lib/openmower';
import {sunTimes} from '@/lib/sun';
import {useRpcMethods} from '@/hooks/useRpcMethods';
import {answerError} from '@/lib/rpcText';
import {useState, useSyncExternalStore} from 'react';
import InfoTip from './InfoTip';
import local from './MowerParamSettings.module.css';

type Styles = Record<string, string>;

// whether this mower takes params.set (a newer OpenMower), false until it has told
export const useCanSetParams = (): boolean => !!useRpcMethods()?.has(RPC.setParams);

// what the container sets again after a restart of the mower, one copy for every page. undefined until asked, null
// when there's no container that keeps it and on MowBite OS (it keeps them itself)
let kept: KeptParams | null | undefined;
let asked = false;
let askIn = 10000;
const listeners = new Set<() => void>();
const setKept = (k: KeptParams | null) => {
  kept = k;
  listeners.forEach((l) => l());
};
function ask() {
  asked = true;
  // (no answer, a container that's slow to come up included: asked again by the next page that wants it and, while one
  // shows it, less and less often; also while it isn't known yet what runs on the mower)
  void systemInfo().then(async (i) => {
    const os = isMowbiteOs(i);
    const k = os ? null : await loadKept();
    if (!k || i === undefined) asked = false;
    // (what's known stays when it doesn't answer this time: a change says then that it couldn't be kept)
    if (k || !kept) setKept(k);
    if (k || os) askIn = 10000;
    else {
      setTimeout(() => {
        if (!asked && listeners.size) ask();
      }, askIn);
      askIn = Math.min(askIn * 2, 300000);
    }
  });
}
function subscribe(l: () => void) {
  if (!asked) ask();
  listeners.add(l);
  return () => listeners.delete(l);
}
const useKept = () =>
  useSyncExternalStore(
    subscribe,
    () => kept,
    () => undefined,
  );

// one change to what the container keeps as it has it now (another device may have changed it since it was asked for),
// shown at once and back as it was when the container didn't answer or take it. one after the other, each on the last
let storing: Promise<unknown> = Promise.resolve();
function storeKept(change: (k: KeptParams) => KeptParams): Promise<void> {
  const run = storing.then(async () => {
    const before = kept ?? null;
    if (before) setKept(change(before));
    try {
      const now = await loadKept();
      if (!now) throw new Error('nothing kept');
      setKept(await saveKept(change(now)));
    } catch (e) {
      setKept(before);
      throw e;
    }
  });
  storing = run.catch(() => {});
  return run;
}

// keeping switched off, or on again with the values the mower has now instead of older kept ones, one it hasn't told left out
export function switchKeeping(on: boolean, params: Record<string, unknown>) {
  const now = (k: KeptParams) =>
    Object.fromEntries(
      Object.keys(k.values).flatMap((key) => {
        const m = params[paramName(key)];
        return typeof m === 'number' || typeof m === 'boolean' ? [[key, m]] : [];
      }),
    );
  return storeKept((k) => ({...k, enabled: on, ...(on ? {values: now(k)} : {})}));
}

class NotKept extends Error {}

// sets it on the mower, and has the container keep what the mower took (MowBite OS keeps it itself)
async function apply(f: ParamField, value: number | boolean, os = false) {
  const applied = await setParams({[f.key]: value}, os);
  const took = applied[f.key] ?? value;
  // not known (yet): asked now, a container that keeps an older value of it would set that one again
  if (kept == null && !isMowbiteOs(await systemInfo())) {
    const now = await loadKept();
    if (now) setKept(now);
  }
  if (kept?.enabled)
    await storeKept((k) => ({...k, values: {...k.values, [f.key]: took}})).catch(() => {
      throw new NotKept(tr("Set on the mower, but MowBite couldn't keep it for after a restart."));
    });
}

// one of OpenMower's settings changed from elsewhere (the planner's menu), kept like one changed here
export async function setOpenMowerParam(key: string, value: number | boolean) {
  const f = paramField(key);
  if (f) await apply(f, value);
}

// one setting: its value on the mower, changed right there. os: on MowBite OS
export function ParamRow({field, os}: {field: ParamField; os: boolean}) {
  const f = onOs(field, os);
  const params = useMowerParams();
  const k = useKept();
  const value = paramValue(params, f);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // switching it off waits for a yes
  const [asking, setAsking] = useState(false);
  // the sun's times where the mower is, for going home at sunset
  const datum = f.key === 'dock_at_sunset' ? datumFromParams(params) : undefined;
  const sun = datum ? sunTimes(datum.lat, datum.lon) : null;

  const set = async (v: number | boolean) => {
    setAsking(false);
    if (v === value) return;
    const conflict = paramConflict(params, f.key, v);
    setError(conflict && tr(conflict));
    if (conflict) return;
    setBusy(true);
    try {
      await apply(f, v, os);
    } catch (e) {
      setError(e instanceof NotKept ? e.message : answerError(e));
    } finally {
      setBusy(false);
    }
  };
  const commit = () => {
    if (draft === null) return;
    const v = parseParam(f, draft);
    setDraft(null);
    if (v !== null) void set(v);
  };
  const isKept = !!k?.enabled && f.key in k.values;
  const label = tr((os && f.osLabel) || f.label);
  const help = (os && f.osHelp) || f.help;

  return (
    <div className={local.row}>
      <div className={local.line}>
        <span className={local.label}>
          {label}
          {help && <InfoTip>{tr(help)}</InfoTip>}
        </span>
        {f.type === 'bool' ? (
          <input
            type="checkbox"
            className={local.check}
            checked={(value as boolean) && !asking}
            disabled={busy}
            onChange={(e) => (!e.target.checked && f.confirmOff ? setAsking(true) : void set(e.target.checked))}
            aria-label={label}
          />
        ) : f.type === 'choice' ? (
          <select className={local.select} value={String(value)} disabled={busy} onChange={(e) => void set(Number(e.target.value))} aria-label={label}>
            {f.choices!.map((c, i) => (
              <option key={c} value={i}>
                {tr(c)}
              </option>
            ))}
          </select>
        ) : (
          <span className={local.number}>
            <input
              inputMode="decimal"
              value={draft ?? showParam(f, value as number)}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-label={label}
            />
            <span className={local.unit}>{f.unit ?? ''}</span>
          </span>
        )}
      </div>
      {sun && <span className={local.kept}>{value ? tr('today at {set}', {set: sun.set}) : tr('off: mows on after sunset (today {set})', {set: sun.set})}</span>}
      {asking && (
        <span className={local.ask}>
          {tr(f.confirmOff!)}
          <button className={local.askOff} onClick={() => void set(false)}>
            {tr('Switch off')}
          </button>
          <button onClick={() => setAsking(false)}>{tr('Keep on')}</button>
        </span>
      )}
      {isKept && (
        <span className={local.kept}>
          {tr('set again after a restart')}
          <button
            onClick={() =>
              storeKept((k) => {
                const values = {...k.values};
                delete values[f.key];
                return {...k, values};
              }).catch(() => {})
            }
          >
            {tr('no longer')}
          </button>
        </span>
      )}
      {error && <span className={local.error}>{error}</span>}
    </div>
  );
}

// a few of the settings next to a problem they help with (activity page)
export function ParamFix({keys}: {keys: string[]}) {
  const can = useCanSetParams();
  const os = useMowbiteOs();
  const fields = PARAM_FIELDS.filter((f) => keys.includes(f.key));
  if (!can || !fields.length) return null;
  // folded, under a problem it's only for when it keeps happening
  return (
    <details className={local.fix}>
      <summary className={local.fixTitle}>{tr('Change on the mower')}</summary>
      {fields.map((f) => (
        <ParamRow key={f.key} field={f} os={os} />
      ))}
    </details>
  );
}

// the values that matter most of a group, read in its folded line
export function summary(group: ParamGroup, params: Record<string, unknown>, os: boolean): string {
  const v = (key: string) => paramValue(params, onOs(paramField(key)!, os));
  const n = (key: string) => showParam(paramField(key)!, v(key) as number);
  switch (group) {
    case 'mowing':
      return [v('outline_count') === 1 ? tr('1 outline pass') : tr('{n} outline passes', {n: n('outline_count')}), tr('lanes {n} cm apart', {n: n('tool_width')}), tr('turned by {n}°', {n: n('mow_angle_offset')})].join(' · ');
    case 'auto': {
      // a value it doesn't know (a newer OpenMower) is left out
      const known = (t: string | undefined) => (t === undefined ? [] : [tr(t)]);
      return [
        ...known(paramField('rain_mode')!.choices![v('rain_mode') as number]),
        ...(mowsIntoNight(params) ? [tr('mows on after sunset')] : []),
        ...known(AUTOMATIC_SHORT[v('automatic_mode') as number]),
      ].join(' · ');
    }
    case 'gps':
      return [tr('{n} s without a fix', {n: n('gps_timeout')}), tr('better than {n} cm', {n: n('max_position_accuracy')})].join(' · ');
    case 'docking':
      return [tr('approach from {n} m', {n: n('docking_approach_distance')}), v('docking_retry_count') === 1 ? tr('1 retry') : tr('{n} retries', {n: n('docking_retry_count')})].join(' · ');
    case 'motor':
      return tr('pauses at {hot} °C, on again at {cold} °C', {hot: n('motor_hot_temperature'), cold: n('motor_cold_temperature')});
  }
}
const AUTOMATIC_SHORT = ['starts by hand', 'semi-automatic', 'automatic'];

// OpenMower's own values for mowing every area (mower_params.yaml), with the map where an area can have its own
export function OpenMowerMowing({styles}: {styles: Styles}) {
  const params = useMowerParams();
  const k = useKept();
  const os = useMowbiteOs();
  return (
    <div className={local.rows}>
      <p className={styles.dim}>{tr("OpenMower's own values from mower_params.yaml, for every area without its own. A change counts right away.")}</p>
      {k && !k.enabled && (
        <label className={styles.check}>
          <input type="checkbox" checked={false} onChange={() => switchKeeping(true, params).catch(() => {})} />
          {tr('MowBite sets what you change here again after a restart')}
        </label>
      )}
      {PARAM_FIELDS.filter((f) => f.group === 'mowing').map((f) => (
        <ParamRow key={f.key} field={f} os={os} />
      ))}
    </div>
  );
}

// under OpenMower's groups on the settings page: where the values come from, and keeping them over a restart
export function OpenMowerNote({styles, params, os}: {styles: Styles; params: Record<string, unknown>; os: boolean}) {
  const k = useKept();
  return (
    <>
      <p className={styles.dim}>
        {os
          ? tr('Settings of the mower itself, kept on it. A change counts right away, it takes one only while the mower is idle.')
          : tr("These values are in mower_params.yaml. A change counts right away, after a restart the file's values are back.")}
      </p>
      {k && (
        <label className={styles.check}>
          <input type="checkbox" checked={k.enabled} onChange={(e) => switchKeeping(e.target.checked, params).catch(() => {})} />
          {tr('MowBite sets what you change here again after a restart')}
        </label>
      )}
    </>
  );
}

// the values of one of OpenMower's groups that this mower has
export function ParamGroupRows({group, params, os}: {group: ParamGroup; params: Record<string, unknown>; os: boolean}) {
  return (
    <div className={`${local.rows} ${local.inGroup}`}>
      {PARAM_FIELDS.filter((f) => f.group === group && paramShown(f, params)).map((f) => (
        <ParamRow key={f.key} field={f} os={os} />
      ))}
    </div>
  );
}
