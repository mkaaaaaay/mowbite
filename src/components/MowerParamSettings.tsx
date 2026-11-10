'use client';

import {useMowerParams} from '@/hooks/useMowerParams';
import {tr} from '@/lib/i18n';
import {
  loadKept,
  PARAM_FIELDS,
  PARAM_GROUPS,
  paramField,
  paramConflict,
  paramName,
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
import {useRpcMethods} from '@/hooks/useRpcMethods';
import {answerError} from '@/lib/rpcText';
import Link from 'next/link';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import InfoTip from './InfoTip';
import local from './MowerParamSettings.module.css';

type Styles = Record<string, string>;
const never = () => () => {};

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

// one change to what the container keeps as it has it now (another device may have kept more since it was asked
// for), shown at once and back as it was when the container didn't take it. one after the other, each on the last
let storing: Promise<unknown> = Promise.resolve();
function storeKept(change: (k: KeptParams) => KeptParams): Promise<void> {
  const run = storing.then(async () => {
    const before = kept ?? null;
    if (before) setKept(change(before));
    try {
      const now = (await loadKept()) ?? before;
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

class NotKept extends Error {}

// sets it on the mower, and has the container keep what the mower took (MowBite OS keeps it itself)
async function apply(f: ParamField, value: number | boolean) {
  const applied = await setParams({[f.key]: value});
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
export function ParamRow({field: f, os}: {field: ParamField; os: boolean}) {
  const params = useMowerParams();
  const k = useKept();
  const value = paramValue(params, f);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = async (v: number | boolean) => {
    if (v === value) return;
    const conflict = paramConflict(params, f.key, v);
    setError(conflict && tr(conflict));
    if (conflict) return;
    setBusy(true);
    try {
      await apply(f, v);
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
          <input type="checkbox" className={local.check} checked={value as boolean} disabled={busy} onChange={(e) => void set(e.target.checked)} />
        ) : f.type === 'choice' ? (
          <select className={local.select} value={String(value)} disabled={busy} onChange={(e) => void set(Number(e.target.value))}>
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
export function summary(group: ParamGroup, params: Record<string, unknown>): string {
  const v = (key: string) => paramValue(params, paramField(key)!);
  const n = (key: string) => showParam(paramField(key)!, v(key) as number);
  switch (group) {
    case 'mowing':
      return [v('outline_count') === 1 ? tr('1 outline pass') : tr('{n} outline passes', {n: n('outline_count')}), tr('lanes {n} cm apart', {n: n('tool_width')}), tr('turned by {n}°', {n: n('mow_angle_offset')})].join(' · ');
    case 'auto':
      // a value it doesn't know (a newer OpenMower) is left out
      return [paramField('rain_mode')!.choices![v('rain_mode') as number], AUTOMATIC_SHORT[v('automatic_mode') as number]]
        .filter((t) => t !== undefined)
        .map((t) => tr(t))
        .join(' · ');
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
  const k = useKept();
  const os = useMowbiteOs();
  return (
    <div className={local.rows}>
      <p className={styles.dim}>{tr("OpenMower's own values from mower_params.yaml, for every area without its own. A change counts right away.")}</p>
      {k && !k.enabled && (
        <label className={styles.check}>
          <input type="checkbox" checked={false} onChange={() => storeKept((k) => ({...k, enabled: true})).catch(() => {})} />
          {tr('MowBite sets what you change here again after a restart')}
        </label>
      )}
      {PARAM_FIELDS.filter((f) => f.group === 'mowing').map((f) => (
        <ParamRow key={f.key} field={f} os={os} />
      ))}
    </div>
  );
}

// the settings page's group: everything folded when the page opens, every time
export function OpenMowerSettings({styles}: {styles: Styles}) {
  const can = useCanSetParams();
  const params = useMowerParams();
  const k = useKept();
  const os = useMowbiteOs();
  // folded whenever the page opens, unless a link led here
  const linked = useSyncExternalStore(
    never,
    () => window.location.hash === '#openmower',
    () => false,
  );
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? linked;
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (can && linked) ref.current?.scrollIntoView({block: 'start'});
  }, [can, linked]);
  if (!can) return null;
  return (
    <details
      className={styles.group}
      id="openmower"
      ref={ref}
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (now !== open) setToggled(now);
      }}
    >
      <summary>
        <span className={styles.groupTitle}>
          {os ? tr('Mower settings') : tr('OpenMower')}
          <small>{os ? tr('Kept on the mower itself') : tr('Its own settings from mower_params.yaml')}</small>
        </span>
      </summary>
      <div className={styles.groupBody}>
        <p className={styles.dim}>
          {os
            ? tr('Settings of the mower itself, kept on it. A change counts right away, it takes one only while the mower is idle.')
            : tr(
                "Settings of OpenMower itself, the ones from mower_params.yaml. A change counts right away, no restart. OpenMower doesn't store it: after its restart the file's values are back.",
              )}
        </p>
        {k && (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={k.enabled}
              onChange={(e) => {
                const on = e.target.checked;
                // switched on again: the values the mower has now, not the ones kept from before (changed meanwhile)
                const now = (k: KeptParams) =>
                  Object.fromEntries(
                    Object.entries(k.values).map(([key, v]) => {
                      const m = params[paramName(key)];
                      return [key, typeof m === 'number' || typeof m === 'boolean' ? m : v];
                    }),
                  );
                storeKept((k) => ({...k, enabled: on, ...(on ? {values: now(k)} : {})})).catch(() => {});
              }}
            />
            {tr('MowBite sets what you change here again after a restart')}
          </label>
        )}
        <p className={styles.dim}>
          {tr('The mowing values (outline passes, lane spacing, direction) are with the map: under "Mowing for all areas", with the MowBite Planner in its menu there.')}{' '}
          <Link href="/map">{tr('To the map')}</Link>
        </p>
        {PARAM_GROUPS.filter((g) => g.key !== 'mowing').map((g) => (
          <details key={g.key} className={local.section}>
            <summary>
              <span className={local.title}>
                {tr(g.title)}
                <small>{summary(g.key, params)}</small>
              </span>
            </summary>
            <div className={local.rows}>
              {PARAM_FIELDS.filter((f) => f.group === g.key).map((f) => (
                <ParamRow key={f.key} field={f} os={os} />
              ))}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}
