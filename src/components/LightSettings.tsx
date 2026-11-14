'use client';

import {useSure} from '@/hooks/useSure';
import {dec, fmt, tr, useLang} from '@/lib/i18n';
import {
  colorsUsed,
  fitted,
  loadLights,
  mayStand,
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
import {answerError} from '@/lib/rpcText';
import {useEffect, useState} from 'react';
import local from './LightSettings.module.css';

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
  SCHEDULE_START: 'Scheduled start',
};
const EFFECT_NAMES: Record<string, string> = {
  off: 'Off',
  solid: 'Steady',
  blink: 'Blinking',
  pulse: 'Pulsing',
  chase: 'Running light',
  gradient: 'Color gradient',
  fade: 'Fading',
  comet: 'Comet',
  scanner: 'Scanner',
  rainbow: 'Rainbow',
  sparkle: 'Sparkling',
  flash: 'Double flash',
  level: 'Battery level',
};
const named = (names: Record<string, string>, key: string) => (names[key] ? tr(names[key]) : key.replace(/_/g, ' ').toLowerCase());
// a preview shows this long, unless the mower allows less
const PREVIEW_S = 5;

// the colors of an effect as dots, next to its name
function Dots({e}: {e: LightEffect}) {
  const colors = e.effect === 'off' ? [] : (e.colors ?? []);
  return (
    <span className={local.dots} aria-hidden style={{opacity: 0.35 + 0.65 * (e.brightness ?? 1)}}>
      {colors.map((c, i) => (
        <span key={i} className={local.dot} style={{background: c}} />
      ))}
    </span>
  );
}

// the period as typed, taken when the field is left: a number in between doesn't jump to the limits
function PeriodField({value, effect, lights, styles, onChange}: {value: number; effect: string; lights: Lights; styles: Record<string, string>; onChange: (p: number) => void}) {
  const [text, setText] = useState<string | null>(null);
  const take = () => {
    const v = Number((text ?? '').replace(',', '.'));
    if (text !== null && text.trim() !== '' && Number.isFinite(v)) onChange(v);
    setText(null);
  };
  return (
    <label className={styles.field}>
      {effect === 'gradient' ? tr('One pass along the lights in s (0: it stands still)') : mayStand(effect) ? tr('One cycle in s (0: it stands still)') : tr('One cycle in s')}
      <input
        inputMode="decimal"
        value={text ?? dec(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={take}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <small className={styles.dim}>{tr('{min} to {max} s', {min: dec(minPeriod(effect, lights.limits)), max: dec(lights.limits.max_period)})}</small>
    </label>
  );
}

function EffectFields({value, lights, styles, onChange}: {value: LightEffect; lights: Lights; styles: Record<string, string>; onChange: (e: LightEffect) => void}) {
  const most = colorsUsed(value.effect, lights.limits.colors);
  const colors = value.colors ?? [];
  const set = (patch: Partial<LightEffect>) => onChange({...value, ...patch});
  const brightness = Math.round((value.brightness ?? 1) * 100);
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
          {tr('Colors')}
          <div className={local.colors}>
            {colors.map((c, i) => (
              <label key={i} className={local.swatch} style={{background: c}} title={c}>
                <input
                  type="color"
                  aria-label={tr('Color {n}', {n: i + 1})}
                  value={c}
                  onChange={(e) => set({colors: colors.map((x, j) => (j === i ? e.target.value : x))})}
                />
              </label>
            ))}
            {colors.length < most && (
              <button type="button" className={local.roundButton} aria-label={tr('+ color')} onClick={() => set({colors: [...colors, colors[colors.length - 1]]})}>
                +
              </button>
            )}
            {colors.length > 1 && (
              <button type="button" className={local.roundButton} aria-label={tr('− color')} onClick={() => set({colors: colors.slice(0, -1)})}>
                −
              </button>
            )}
          </div>
          {most === 2 && <small className={styles.dim}>{tr('The second color shows where it would be dark.')}</small>}
        </div>
      )}
      {moves(value.effect) && <PeriodField value={value.period ?? 1} effect={value.effect} lights={lights} styles={styles} onChange={(period) => set({period})} />}
      {value.effect !== 'off' && (
        <label className={styles.field}>
          {tr('Brightness {n} %', {n: brightness})}
          <input className={local.range} type="range" min={0} max={100} value={brightness} onChange={(e) => set({brightness: Number(e.target.value) / 100})} />
        </label>
      )}
    </>
  );
}

// the lights of a mower with MowBite OS: each state folded to its name and colors, tried on the mower and saved by
// itself
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
  const changed = (s: string) => !sameEffect(effectOf(s), lights.profile[s]);
  // the profile the mower keeps after a save or a reset, the drafts of that state or of all with it
  const apply = async (call: () => Promise<{profile: LightProfile}>, done: string, state?: string) => {
    setBusy(true);
    setNote(null);
    try {
      const {profile} = await call();
      setLights({...lights, profile});
      setDraft(state ? {...draft, [state]: profile[state]} : profile);
      setNote({state, text: done});
    } catch (e) {
      setNote({state, text: answerError(e), error: true});
    } finally {
      setBusy(false);
    }
  };
  // the mower keeps the whole profile: the one state saved, the others as they are on the mower
  const save = (s: string) => apply(() => saveLights({...lights.profile, [s]: effectOf(s)}), tr('Saved on the mower.'), s);
  const reset = () => apply(resetLights, tr('Back to the defaults.'));
  const preview = async (s: string) => {
    setNote(null);
    try {
      const r = await previewLight(effectOf(s), Math.min(PREVIEW_S, lights.limits.max_preview));
      setNote({state: s, text: r.emergency ? tr('Not visible right now: the lights show the emergency stop.') : tr('Shows on the mower for {n} s.', {n: fmt(r.duration, 0)})});
    } catch (e) {
      setNote({state: s, text: answerError(e), error: true});
    }
  };

  return (
    <>
      <p className={styles.dim}>{tr('{n} LEDs on the mower. Open a state to change it, try it on the mower, then save it.', {n: lights.leds})}</p>
      {states.map((s) => {
        const e = effectOf(s);
        return (
          <details key={s} className={local.state} data-light={s}>
            <summary>
              {named(STATE_NAMES, s)}
              <Dots e={e} />
              <span className={local.effectName}>{named(EFFECT_NAMES, e.effect)}</span>
              {changed(s) && <span className={local.changed}>{tr('changed')}</span>}
            </summary>
            <div className={local.body}>
              <EffectFields value={e} lights={lights} styles={styles} onChange={(v) => setDraft({...draft, [s]: v})} />
              <div className={local.actions}>
                {changed(s) && (
                  <button type="button" className={local.save} disabled={busy} onClick={() => void save(s)}>
                    {tr('Save')}
                  </button>
                )}
                <button type="button" className={styles.pillButton} disabled={busy} onClick={() => void preview(s)}>
                  {tr('Show on the mower')}
                </button>
                {changed(s) && (
                  <button type="button" className={styles.linkButton} disabled={busy} onClick={() => setDraft({...draft, [s]: lights.profile[s]})}>
                    {tr('Discard')}
                  </button>
                )}
              </div>
              {note?.state === s && <p className={note.error ? styles.error : styles.dim}>{note.text}</p>}
            </div>
          </details>
        );
      })}
      <div className={local.state}>
        <div className={local.body} style={{paddingTop: 12}}>
          <strong>
            {tr('Emergency stop')} <Dots e={lights.emergency} />
          </strong>
          <span className={styles.dim}>
            {named(EFFECT_NAMES, lights.emergency.effect)}
            {moves(lights.emergency.effect) && lights.emergency.period ? `, ${fmt(lights.emergency.period, 1)} s` : ''}. {tr('The same on every mower, no setting changes it.')}
          </span>
        </div>
      </div>
      <button type="button" className={styles.linkButton} disabled={busy} onClick={() => confirm('reset', () => void reset())}>
        {sure === 'reset' ? tr('Really back to the defaults?') : tr('All back to the defaults')}
      </button>
      {note && !note.state && <p className={note.error ? styles.error : styles.dim}>{note.text}</p>}
    </>
  );
}
