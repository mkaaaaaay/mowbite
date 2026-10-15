'use client';

import {useMowerParams} from '@/hooks/useMowerParams';
import {tr} from '@/lib/i18n';
import {
  loadKept,
  PARAM_FIELDS,
  PARAM_GROUPS,
  paramField,
  paramValue,
  parseParam,
  saveKept,
  setParams,
  showParam,
  type KeptParams,
  type ParamField,
  type ParamGroup,
} from '@/lib/mowerParams';
import {RPC} from '@/lib/openmower';
import {RpcError, rpcMethods} from '@/lib/rpc';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import InfoTip from './InfoTip';
import local from './MowerParamSettings.module.css';

type Styles = Record<string, string>;
const never = () => () => {};

// whether this mower takes params.set (a newer OpenMower), false until it has told
export function useCanSetParams(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let alive = true;
    void rpcMethods().then((m) => alive && setCan(!!m?.has(RPC.setParams)));
    return () => {
      alive = false;
    };
  }, []);
  return can;
}

// what the container sets again after a restart of the mower, one copy for every page. undefined until asked, null
// when there's no container that keeps it
let kept: KeptParams | null | undefined;
let asked = false;
const listeners = new Set<() => void>();
const setKept = (k: KeptParams | null) => {
  kept = k;
  listeners.forEach((l) => l());
};
function subscribe(l: () => void) {
  if (!asked) {
    asked = true;
    void loadKept().then(setKept);
  }
  listeners.add(l);
  return () => listeners.delete(l);
}
const useKept = () =>
  useSyncExternalStore(
    subscribe,
    () => kept,
    () => undefined,
  );

// shown at once, back as it was when the container didn't take it
async function storeKept(next: KeptParams) {
  const before = kept ?? null;
  setKept(next);
  try {
    await saveKept(next);
  } catch (e) {
    setKept(before);
    throw e;
  }
}

class NotKept extends Error {}

// sets it on the mower, and has the container keep what the mower took
async function apply(f: ParamField, value: number | boolean) {
  const applied = await setParams({[f.key]: value});
  const took = applied[f.key] ?? value;
  if (kept?.enabled)
    await storeKept({...kept, values: {...kept.values, [f.key]: took}}).catch(() => {
      throw new NotKept(tr("Set on the mower, but MowBite couldn't keep it for after a restart."));
    });
}

// one setting: its value on the mower, changed right there
export function ParamRow({field: f}: {field: ParamField}) {
  const params = useMowerParams();
  const k = useKept();
  const value = paramValue(params, f);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = async (v: number | boolean) => {
    if (v === value) return;
    setBusy(true);
    setError(null);
    try {
      await apply(f, v);
    } catch (e) {
      setError(e instanceof NotKept || (e instanceof RpcError && e.code !== 'timeout') ? e.message : tr('The mower did not answer.'));
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

  return (
    <div className={local.row}>
      <div className={local.line}>
        <span className={local.label}>
          {tr(f.label)}
          {f.help && <InfoTip>{tr(f.help)}</InfoTip>}
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
              aria-label={tr(f.label)}
            />
            {f.unit && <span>{f.unit}</span>}
          </span>
        )}
      </div>
      {isKept && (
        <span className={local.kept}>
          {tr('set again after a restart')}
          <button
            onClick={() => {
              const values = {...k!.values};
              delete values[f.key];
              storeKept({...k!, values}).catch(() => {});
            }}
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
  const fields = PARAM_FIELDS.filter((f) => keys.includes(f.key));
  if (!can || !fields.length) return null;
  // folded, under a problem it's only for when it keeps happening
  return (
    <details className={local.fix}>
      <summary className={local.fixTitle}>{tr('Change on the mower')}</summary>
      {fields.map((f) => (
        <ParamRow key={f.key} field={f} />
      ))}
    </details>
  );
}

// the values that matter most of a group, read in its folded line
function summary(group: ParamGroup, params: Record<string, unknown>): string {
  const v = (key: string) => paramValue(params, paramField(key)!);
  const n = (key: string) => showParam(paramField(key)!, v(key) as number);
  switch (group) {
    case 'mowing':
      return [tr('{n} outline passes', {n: n('outline_count')}), tr('lanes {n} cm apart', {n: n('tool_width')}), tr('turned by {n}°', {n: n('mow_angle_offset')})].join(' · ');
    case 'auto':
      return [tr(paramField('rain_mode')!.choices![v('rain_mode') as number] ?? ''), tr(AUTOMATIC_SHORT[v('automatic_mode') as number] ?? '')].join(' · ');
    case 'gps':
      return [tr('{n} s without a fix', {n: n('gps_timeout')}), tr('better than {n} cm', {n: n('max_position_accuracy')})].join(' · ');
    case 'docking':
      return [tr('approach from {n} m', {n: n('docking_approach_distance')}), tr('{n} tries', {n: n('docking_retry_count')})].join(' · ');
    case 'motor':
      return tr('pauses at {hot} °C, on again at {cold} °C', {hot: n('motor_hot_temperature'), cold: n('motor_cold_temperature')});
  }
}
const AUTOMATIC_SHORT = ['starts by hand', 'semi-automatic', 'automatic'];

// the settings page's group: everything folded when the page opens, every time
export function OpenMowerSettings({styles}: {styles: Styles}) {
  const can = useCanSetParams();
  const params = useMowerParams();
  const k = useKept();
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
          {tr('OpenMower')}
          <small>{tr('Its own settings from mower_params.yaml')}</small>
        </span>
      </summary>
      <div className={styles.groupBody}>
        <p className={styles.dim}>
          {tr(
            "Settings of OpenMower itself, the ones from mower_params.yaml. A change counts right away, no restart. OpenMower doesn't store it: after its restart the file's values are back.",
          )}
        </p>
        {k && (
          <label className={styles.check}>
            <input type="checkbox" checked={k.enabled} onChange={(e) => storeKept({...k, enabled: e.target.checked}).catch(() => {})} />
            {tr('MowBite sets what you change here again after a restart')}
          </label>
        )}
        {PARAM_GROUPS.map((g) => (
          <details key={g.key} className={local.section}>
            <summary>
              <span className={local.title}>
                {tr(g.title)}
                <small>{summary(g.key, params)}</small>
              </span>
            </summary>
            <div className={local.rows}>
              {PARAM_FIELDS.filter((f) => f.group === g.key).map((f) => (
                <ParamRow key={f.key} field={f} />
              ))}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}
