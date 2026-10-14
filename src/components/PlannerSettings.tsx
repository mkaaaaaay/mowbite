'use client';

import {tr} from '@/lib/i18n';
import {loadPlannerSettings, savePlannerSettings, usePlannerSettings, type PlannerSetting} from '@/lib/mowerBody';
import {ANGLE_FOR_ALL, BODY_KEYS, COUNTED, DROPPED, DROPPED_CHOICES, FIELDS, fromInput, GROUPS, RETIRED, SIMPLE, toInput, type Field, type Group} from '@/lib/plannerFields';
import {RpcError} from '@/lib/rpc';
import {useEffect, useState} from 'react';
import InfoTip from './InfoTip';
import local from './PlannerSettings.module.css';

// The MowBite Planner's settings for all areas the planner menu at the map doesn't have (planner.settings /
// planner.settings.set), each saved right away. Built from what the planner reports, so a newer planner's settings
// show up too. An area can set some of them for itself (This area).

type Styles = Record<string, string>;
type Value = string | string[];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function formFrom(settings: Record<string, PlannerSetting>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [key, s] of Object.entries(settings)) {
    if (s.type === 'list') out[key] = Array.isArray(s.value) ? (s.value as string[]) : [];
    else if (s.type === 'string') out[key] = String(s.value ?? '');
    else if (s.type === 'boolean') out[key] = s.value ? 'true' : 'false';
    // (one from mower_logic shows as its placeholder, it's not set here)
    else out[key] = s.from && !s.stored ? '' : toInput(FIELDS[key], s.value);
  }
  return out;
}

// one setting as typed in, null: back to the default, undefined: unchanged or not valid (error set)
function change(key: string, s: PlannerSetting, value: Value): {value?: unknown; error?: string} {
  const field = FIELDS[key];
  if (s.type === 'list') return same(value, s.value) ? {} : {value: same(value, s.default) && s.stored ? null : value};
  if (s.type === 'string' || s.type === 'boolean') {
    const v = s.type === 'boolean' ? value === 'true' : value;
    return v === s.value ? {} : {value: v === s.default && s.stored ? null : v};
  }
  const v = fromInput(field, value as string);
  if (v === 'invalid') return {error: tr('{what} is not a number.', {what: tr(field?.label ?? key)})};
  if (v === null) return s.stored ? {value: null} : {};
  return typeof s.value === 'number' && Math.abs(s.value - v) < 1e-9 && s.stored ? {} : {value: v};
}

export function PlannerField({
  name,
  setting,
  value,
  onChange,
  styles,
  placeholder,
  globalLabel,
  warning,
}: {
  name: string;
  setting: PlannerSetting;
  value: Value;
  onChange: (v: Value) => void;
  styles: Styles;
  // for a number left empty
  placeholder?: string;
  // a choice field per area: the extra choice "as set for all areas"
  globalLabel?: string;
  // what's off about the value set, shown under it
  warning?: string | null;
}) {
  const field: Field | undefined = FIELDS[name];
  const label = (
    <span className={local.label}>
      {tr(field?.label ?? name)}
      {field?.unit === 'deg' ? ' (°)' : field?.unit === 'm' ? ' (m)' : ''}
      {field?.help && <InfoTip>{tr(field.help)}</InfoTip>}
    </span>
  );
  const choices = (setting.choices ?? []).filter((c) => !DROPPED_CHOICES[name]?.includes(c));
  if (setting.type === 'list') {
    const on = Array.isArray(value) ? value : [];
    return (
      <div className={local.wide}>
        {label}
        <div className={local.checks}>
          {choices.map((c) => (
            <label key={c} className={styles.check}>
              <input
                type="checkbox"
                checked={on.includes(c)}
                // in the planner's order of preference
                onChange={(e) => onChange(choices.filter((k) => (k === c ? e.target.checked : on.includes(k))))}
              />
              {tr(field?.choices?.[c] ?? c)}
            </label>
          ))}
        </div>
      </div>
    );
  }
  if (setting.type === 'string' && choices.length) {
    return (
      <div className={local.wide}>
        {label}
        <div className={styles.segment}>
          {globalLabel !== undefined && (
            <button className={value === '' ? styles.segmentOn : undefined} onClick={() => onChange('')}>
              {globalLabel}
            </button>
          )}
          {choices.map((c) => (
            <button key={c} className={value === c ? styles.segmentOn : undefined} onClick={() => onChange(c)}>
              {tr(field?.choices?.[c] ?? c)}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (setting.type === 'boolean') {
    return (
      <label className={styles.check}>
        <input type="checkbox" checked={value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} />
        {label}
      </label>
    );
  }
  // a number the planner can work out itself (perimeter_passes -1): a button for that next to it
  const auto = setting.auto_value !== undefined ? String(setting.auto_value) : null;
  const isAuto = auto !== null && value === auto;
  const fromText =
    setting.from && !setting.stored && toInput(field, setting.value) ? tr('OpenMower: {value}', {value: toInput(field, setting.value)}) : null;
  const input = (
    <input
      inputMode="decimal"
      value={isAuto ? '' : (value as string)}
      step={field?.step}
      placeholder={isAuto ? tr('automatic') : (placeholder ?? fromText ?? (toInput(field, setting.default) || tr('none')))}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  return (
    <label className={styles.field}>
      {label}
      {auto === null ? (
        input
      ) : (
        <span className={local.withAuto}>
          {input}
          <button
            type="button"
            className={isAuto ? local.autoOn : undefined}
            onClick={(e) => {
              e.preventDefault();
              onChange(isAuto ? '' : auto);
            }}
          >
            {tr('Auto')}
          </button>
        </span>
      )}
      {warning && <span className={styles.error}>{warning}</span>}
    </label>
  );
}

export function PlannerSettings({styles}: {styles: Styles}) {
  const settings = usePlannerSettings();
  // numbers as typed, saved once the field is left
  const [form, setForm] = useState<Record<string, Value>>({});
  const [state, setState] = useState<{busy?: boolean; error?: string; saved?: number; confirm?: boolean}>({});

  useEffect(() => {
    loadPlannerSettings(true).catch(() => {});
  }, []);
  // "saved" shows for a moment
  useEffect(() => {
    if (!state.saved) return;
    const t = setTimeout(() => setState((s) => (s.saved === state.saved ? {} : s)), 2500);
    return () => clearTimeout(t);
  }, [state.saved]);

  if (settings === null) {
    return (
      <section className={styles.card}>
        <h2>{tr('Planner')}</h2>
        <p className={styles.dim}>{tr('Only with the MowBite Planner on the mower (OM_PLANNER=mowbite).')}</p>
      </section>
    );
  }
  if (!settings) return null;

  const all = settings.settings;
  const shown = {...formFrom(all), ...form};
  // the ones the planner menu above doesn't have (a direction for all areas: each area has its own)
  const keys = Object.keys(all).filter(
    (k) => !BODY_KEYS.includes(k) && !DROPPED.includes(k) && !RETIRED.includes(k) && !SIMPLE.includes(k) && !ANGLE_FOR_ALL.includes(k) && all[k].settable,
  );
  const fixed = Object.keys(all).filter((k) => !all[k].settable && !COUNTED.includes(k));
  const group = (k: string): Group => FIELDS[k]?.group ?? 'fine';
  const advanced = (k: string) => !FIELDS[k] || !!FIELDS[k].advanced;
  const typed = (k: string) => !['list', 'string', 'boolean'].includes(all[k].type);

  const store = async (values: Record<string, unknown>) => {
    setState({busy: true});
    try {
      await savePlannerSettings(values);
      setState((s) => ({saved: (s.saved ?? 0) + 1}));
    } catch (e) {
      setState({error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };
  // a choice right away, a number once its field is left
  const commit = (k: string, v: Value) => {
    const c = change(k, all[k], v);
    if (c.error) return setState({error: c.error});
    const rest = {...form};
    delete rest[k];
    setForm(rest);
    if ('value' in c) void store({[k]: c.value});
  };
  const reset = async () => {
    if (!state.confirm) return setState({confirm: true});
    const stored = keys.filter((k) => all[k].stored);
    setForm({});
    if (stored.length) await store(Object.fromEntries(stored.map((k) => [k, null])));
    else setState({});
  };

  // choices and lists take the whole row
  const wide = (k: string) => all[k].type === 'list' || (all[k].type === 'string' && !!all[k].choices?.length);
  const field = (k: string) => (
    <div
      key={k}
      className={[wide(k) ? local.wide : '', all[k].stored ? local.changed : ''].filter(Boolean).join(' ') || undefined}
      onBlur={() => typed(k) && form[k] !== undefined && commit(k, form[k])}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
    >
      <PlannerField
        name={k}
        setting={all[k]}
        value={shown[k] ?? ''}
        styles={styles}
        onChange={(v) => {
          if (!typed(k)) return commit(k, v);
          setForm({...form, [k]: v});
          setState({});
        }}
      />
    </div>
  );

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>{tr('More planner settings')}</h2>
        {state.saved && <span className={styles.dim}>✓ {tr('saved')}</span>}
      </div>
      <p className={styles.dim}>
        {tr('For all areas, each one is saved on the mower right away. An area can set some of them for itself (This area).')}
      </p>
      {GROUPS.map((g) => {
        const main = keys.filter((k) => group(k) === g.key && !advanced(k));
        if (!main.length) return null;
        return (
          <div key={g.key} className={local.group}>
            <h3>{tr(g.label)}</h3>
            <div className={local.grid}>{main.map(field)}</div>
          </div>
        );
      })}
      <details className={local.more}>
        <summary>{tr('Rarely needed')}</summary>
        {GROUPS.map((g) => {
          const more = keys.filter((k) => group(k) === g.key && advanced(k));
          if (!more.length) return null;
          return (
            <div key={g.key} className={local.group}>
              <h3>{tr(g.label)}</h3>
              <div className={local.grid}>{more.map(field)}</div>
            </div>
          );
        })}
        {fixed.length > 0 && (
          <p className={styles.dim}>
            {tr('Set by OpenMower with every plan, not here: {which}.', {which: fixed.join(', ')})}
          </p>
        )}
      </details>
      <div className={local.actions}>
        <button
          className={styles.pillButton}
          onClick={() => void reset()}
          onBlur={() => state.confirm && setState({})}
          disabled={state.busy || !keys.some((k) => all[k].stored)}
        >
          {state.confirm ? tr('Really reset these?') : tr('Reset these to the defaults')}
        </button>
        {state.error && <span className={styles.error}>{state.error}</span>}
      </div>
    </section>
  );
}
