'use client';

import {useSure} from '@/hooks/useSure';
import {fmt, tr, useLang} from '@/lib/i18n';
import {
  colorsUsed,
  fitted,
  loadLights,
  minPeriod,
  moves,
  previewLight,
  resetLights,
  sameEffect,
  saveLights,
  statesOf,
  type LightEffect,
  type LightProfile,
  type Lights,
} from '@/lib/light';
import {RpcError} from '@/lib/rpc';
import {useEffect, useState} from 'react';

// the states and effects as the app calls them, one it doesn't know readable
const STATE_NAMES: Record<string, string> = {
  IDLE: 'Idle',
  MOWING: 'Mowing',
  PAUSED: 'Paused',
  DOCKING: 'Heading home',
  UNDOCKING: 'Leaving the dock',
  AREA_RECORDING: 'Recording an area',
  CHARGING: 'Charging in the dock',
  CHARGED: 'Fully charged',
  BATTERY_LOW: 'Battery low',
};
const EFFECT_NAMES: Record<string, string> = {
  off: 'Off',
  solid: 'Steady',
  blink: 'Blinking',
  pulse: 'Pulsing',
  chase: 'Running light',
  gradient: 'Colour gradient',
};
const named = (names: Record<string, string>, key: string) => (names[key] ? tr(names[key]) : key.replace(/_/g, ' ').toLowerCase());
const failed = (e: unknown) => (e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.'));
// a preview shows this long, unless the mower allows less
const PREVIEW_S = 5;

// the colours of an effect as dots, for a look at it without the mower
function Swatch({e}: {e: LightEffect}) {
  const colors = e.effect === 'off' ? [] : (e.colors ?? []);
  return (
    <span aria-hidden style={{display: 'inline-flex', gap: 4, verticalAlign: 'middle', opacity: 0.25 + 0.75 * (e.brightness ?? 1)}}>
      {colors.map((c, i) => (
        <span key={i} style={{width: 14, height: 14, borderRadius: 7, background: c, border: '1px solid var(--border, #8884)'}} />
      ))}
    </span>
  );
}

function EffectFields({
  value,
  lights,
  styles,
  onChange,
}: {
  value: LightEffect;
  lights: Lights;
  styles: Record<string, string>;
  onChange: (e: LightEffect) => void;
}) {
  const most = colorsUsed(value.effect, lights.limits.colors);
  const colors = (value.colors ?? []).slice(0, most);
  if (most > 0 && !colors.length) colors.push('#ffffff');
  const set = (patch: Partial<LightEffect>) => onChange({...value, colors, ...patch});
  return (
    <>
      <label className={styles.field}>
        {tr('Effect')}
        <select value={value.effect} onChange={(e) => set({effect: e.target.value})}>
          {[...new Set([...lights.effects, value.effect])].map((k) => (
            <option key={k} value={k}>
              {named(EFFECT_NAMES, k)}
            </option>
          ))}
        </select>
      </label>
      {most > 0 && (
        <div className={styles.field}>
          {tr('Colours')}
          <span style={{display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap'}}>
            {colors.map((c, i) => (
              <input
                key={i}
                type="color"
                aria-label={tr('Colour {n}', {n: i + 1})}
                value={c}
                onChange={(e) => set({colors: colors.map((x, j) => (j === i ? e.target.value : x))})}
              />
            ))}
            {colors.length < most && (
              <button type="button" className={styles.linkButton} onClick={() => set({colors: [...colors, colors[colors.length - 1]]})}>
                {tr('+ colour')}
              </button>
            )}
            {colors.length > 1 && (
              <button type="button" className={styles.linkButton} onClick={() => set({colors: colors.slice(0, -1)})}>
                {tr('− colour')}
              </button>
            )}
          </span>
          {most === 2 && <small className={styles.dim}>{tr('A second colour shows instead of dark.')}</small>}
        </div>
      )}
      {moves(value.effect) && (
        <label className={styles.field}>
          {value.effect === 'gradient' ? tr('One move along the lights in s, 0 stands still') : tr('One cycle in s')}
          <input
            type="number"
            inputMode="decimal"
            min={minPeriod(value.effect, lights.limits)}
            max={lights.limits.max_period}
            step={0.1}
            value={value.period ?? 1}
            onChange={(e) => e.target.value !== '' && set({period: Number(e.target.value)})}
          />
        </label>
      )}
      {value.effect !== 'off' && (
        <label className={styles.field}>
          {tr('Brightness {n} %', {n: Math.round((value.brightness ?? 1) * 100)})}
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((value.brightness ?? 1) * 100)}
            onChange={(e) => set({brightness: Number(e.target.value) / 100})}
          />
        </label>
      )}
    </>
  );
}

// the lights of a mower with MowBite OS: an effect for each state, tried on the mower before it's saved
export function LightSettings({styles}: {styles: Record<string, string>}) {
  useLang();
  // undefined: loading, null: it didn't answer
  const [lights, setLights] = useState<Lights | null>();
  const [draft, setDraft] = useState<LightProfile>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{state?: string; text: string; error?: boolean} | null>(null);
  const {sure, confirm} = useSure();
  useEffect(() => {
    let stop = false;
    loadLights().then(
      (l) => {
        if (stop) return;
        setLights(l);
        setDraft(l.profile);
      },
      () => !stop && setLights(null),
    );
    return () => {
      stop = true;
    };
  }, []);
  if (lights === undefined) return <p className={styles.dim}>{tr('loading…')}</p>;
  if (lights === null) return <p className={styles.error}>{tr('The mower did not answer.')}</p>;

  const states = statesOf(lights);
  const effectOf = (s: string) => fitted(draft[s] ?? lights.defaults[s] ?? {effect: 'off'}, lights.limits);
  const changed = states.some((s) => !sameEffect(effectOf(s), lights.profile[s]));
  const run = async (what: () => Promise<{profile: LightProfile}>, done: string) => {
    setBusy(true);
    setNote(null);
    try {
      const {profile} = await what();
      setLights({...lights, profile});
      setDraft(profile);
      setNote({text: done});
    } catch (e) {
      setNote({text: failed(e), error: true});
    } finally {
      setBusy(false);
    }
  };
  const preview = async (state: string) => {
    setNote(null);
    try {
      const r = await previewLight(effectOf(state), Math.min(PREVIEW_S, lights.limits.max_preview));
      setNote({
        state,
        text: r.emergency ? tr('An emergency stop shows over it right now.') : tr('Shows on the mower for {n} s.', {n: fmt(r.duration, 0)}),
      });
    } catch (e) {
      setNote({state, text: failed(e), error: true});
    }
  };

  return (
    <>
      <p className={styles.dim}>
        {tr('{n} LEDs on the mower. Each state shows its effect: try it on the mower, then save.', {n: lights.leds})}
      </p>
      {states.map((s) => {
        const e = effectOf(s);
        return (
          <section key={s} className={styles.card} data-light={s}>
            <h2>
              {named(STATE_NAMES, s)} <Swatch e={e} />
            </h2>
            <EffectFields value={e} lights={lights} styles={styles} onChange={(v) => setDraft({...draft, [s]: v})} />
            <button type="button" className={styles.pillButton} disabled={busy} onClick={() => void preview(s)}>
              {tr('Show on the mower')}
            </button>
            {note?.state === s && <p className={note.error ? styles.error : styles.dim}>{note.text}</p>}
          </section>
        );
      })}
      <section className={styles.card}>
        <h2>
          {tr('Emergency stop')} <Swatch e={lights.emergency} />
        </h2>
        <p className={styles.dim}>
          {named(EFFECT_NAMES, lights.emergency.effect)}
          {moves(lights.emergency.effect) && lights.emergency.period ? `, ${fmt(lights.emergency.period, 1)} s` : ''}.{' '}
          {tr('The same on every mower, no setting changes it.')}
        </p>
      </section>
      <section className={styles.card}>
        <button type="button" className={styles.pillButton} disabled={busy || !changed} onClick={() => void run(() => saveLights(Object.fromEntries(states.map((s) => [s, effectOf(s)]))), tr('Saved on the mower.'))}>
          {tr('Save')}
        </button>{' '}
        {changed && (
          <button type="button" className={styles.linkButton} disabled={busy} onClick={() => setDraft(lights.profile)}>
            {tr('Discard changes')}
          </button>
        )}{' '}
        <button type="button" className={styles.linkButton} disabled={busy} onClick={() => confirm('reset', () => void run(resetLights, tr('Back to the defaults.')))}>
          {sure === 'reset' ? tr('Really back to the defaults?') : tr('Back to the defaults')}
        </button>
        {note && !note.state && <p className={note.error ? styles.error : styles.dim}>{note.text}</p>}
      </section>
    </>
  );
}
