'use client';

import {tr} from '@/lib/i18n';
import {
  BODY_SETTINGS,
  bodyFrom,
  loadPlannerSettings,
  modelOf,
  MOWER_MODELS,
  measuredOutline,
  OUTLINE_LEEWAY,
  grownOutline,
  outlineOf,
  savePlannerSettings,
  sizesBody,
  slic3rPlans,
  usePlannerSettings,
  type BodySetting,
  type MowerSizes,
  type Outline,
} from '@/lib/mowerBody';
import {RpcError} from '@/lib/rpc';
import {settingsStore} from '@/lib/settings';
import {useEffect, useState, useSyncExternalStore} from 'react';
import local from './MowerBodySettings.module.css';
import {MowerSketch} from './MowerSketch';

// The mower's sizes for the MowBite Planner on the mower (planner.settings): it keeps the body clear of the edges in
// turns and corners and draws the mower at its real size on the map. Kept by the planner, so every app and the
// planner itself use the same ones.

const LABELS: Record<BodySetting, string> = {
  robot_width: 'Width',
  robot_front: 'Rear axle to the front',
  robot_rear: 'Rear axle to the back',
  mower_width: 'Blade diameter',
  blade_ahead: 'Blade ahead of the rear axle',
  blade_offset: 'Blade to the left of the middle',
};

type Styles = Record<string, string>;
type Form = Record<BodySetting, string>;

const cm = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 1000) / 10) : '');

function formFrom(settings: Record<string, {value: unknown}> | undefined): Form {
  const f = {} as Form;
  for (const key of BODY_SETTINGS) f[key] = cm(settings?.[key]?.value);
  return f;
}

// the planner's names for a model's sizes
const MODEL_FIELDS = [
  ['robot_width', 'width'],
  ['robot_front', 'front'],
  ['robot_rear', 'rear'],
  ['mower_width', 'blade'],
  ['blade_ahead', 'bladeAhead'],
  ['blade_offset', 'bladeOffset'],
] as const;

const sizesOf = (f: Form): MowerSizes =>
  Object.fromEntries(
    MODEL_FIELDS.map(([key, size]) => {
      const v = parseFloat(f[key].replace(',', '.'));
      return [size, Number.isFinite(v) ? v / 100 : undefined];
    }),
  );

// A planner that knows the body's sizes but has none: it plans without checking the body, whatever the collision check
// and the distances say. Sizes set in this app before the planner came only draw the mower on the map, they are
// offered to the planner here. With an area picked the sizes aren't on the page, the way there is said.
export function NoSizesWarning({inArea}: {inArea?: boolean}) {
  const settings = usePlannerSettings();
  const app = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const [state, setState] = useState<{busy?: boolean; error?: string}>({});
  const known = settings?.settings;
  if (!known?.robot_width || !known.robot_front || !known.robot_rear || slic3rPlans(settings) || bodyFrom(settings)) return null;
  const own = sizesBody(app.mower);

  const take = async () => {
    if (!own) return;
    const changes: Record<string, unknown> = {robot_width: own.width, robot_front: own.front, robot_rear: own.rear};
    if (known.mower_width && own.blade > 0) changes.mower_width = own.blade;
    if (known.blade_ahead) changes.blade_ahead = own.bladeAhead;
    if (known.blade_offset) changes.blade_offset = own.bladeOffset;
    if (known.robot_outline && own.outline) changes.robot_outline = grownOutline(own.outline, OUTLINE_LEEWAY);
    setState({busy: true});
    try {
      await savePlannerSettings(changes);
      setState({});
    } catch (e) {
      setState({error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };
  const open = () => {
    const fold = document.getElementById('fold-mowerSizes') as HTMLDetailsElement | null;
    if (!fold) return;
    fold.open = true;
    fold.scrollIntoView({behavior: 'smooth', block: 'start'});
  };

  return (
    <div className={local.warning}>
      <span>
        {tr(
          'The planner has no mower sizes. It plans without checking the body: the collision check does nothing, and the front can swing out past the edge in turns.',
        )}
      </span>
      {own && (
        <>
          <span>
            {tr('The sizes set in this app ({w} cm wide, {l} cm long) only draw the mower on the map, the planner does not have them.', {
              w: Math.round(own.width * 100),
              l: Math.round((own.front + own.rear) * 100),
            })}
          </span>
          <button type="button" disabled={state.busy} onClick={() => void take()}>
            {state.busy ? tr('Saving…') : tr('Give these sizes to the planner')}
          </button>
        </>
      )}
      {inArea ? (
        <span>{own ? tr('Or set them under Mower sizes, with no area picked.') : tr('Set them under Mower sizes, with no area picked.')}</span>
      ) : (
        <button type="button" onClick={open}>
          {own ? tr('Or set them under Mower sizes') : tr('Set them under Mower sizes')}
        </button>
      )}
      {state.error && <span>{state.error}</span>}
    </div>
  );
}

export function MowerBodySettings({styles}: {styles: Styles}) {
  const settings = usePlannerSettings();
  const [form, setForm] = useState<Form>(() => formFrom(settings?.settings));
  const [state, setState] = useState<{busy?: boolean; error?: string; saved?: boolean; offline?: boolean; picked?: boolean}>({});
  // "other mower" picked while the fields still hold a model's sizes
  const [other, setOther] = useState(false);
  // the body's real contour (robot_outline), from a model; typed sizes go back to the rectangle
  // the measured one, the planner has it 1 cm larger
  const [outline, setOutline] = useState<Outline | null>(() => measuredOutline(outlineOf(settings?.settings.robot_outline?.value)) ?? null);
  // the turn radius of the model just picked, saved with the sizes
  const [turn, setTurn] = useState<number | null>(null);
  // the stored sizes arrive after the first render or change elsewhere (the warning's button, another device): the
  // fields follow them as long as nothing is typed in them, saving would clear what they don't show
  const [shown, setShown] = useState(settings);
  if (shown !== settings) {
    setShown(settings);
    const untouched =
      JSON.stringify(form) === JSON.stringify(formFrom(shown?.settings)) &&
      JSON.stringify(outline) === JSON.stringify(measuredOutline(outlineOf(shown?.settings.robot_outline?.value)) ?? null);
    if (untouched) {
      setForm(formFrom(settings?.settings));
      setOutline(measuredOutline(outlineOf(settings?.settings.robot_outline?.value)) ?? null);
    }
  }

  useEffect(() => {
    loadPlannerSettings(true).catch(() => setState({offline: true}));
  }, []);

  const known = settings?.settings ?? {};
  const keys = BODY_SETTINGS;
  // what the form would make of it: the sketch follows the fields while typing
  const metres = (key: BodySetting) => {
    const v = parseFloat(form[key].replace(',', '.'));
    return Number.isFinite(v) ? v / 100 : null;
  };
  const rect = bodyFrom({
    settings: Object.fromEntries(BODY_SETTINGS.map((k) => [k, {value: metres(k)} as never])),
  });
  const sketch = rect && outline ? {...rect, outline} : rect;
  // the model whose outline it is, named so a wrong pick shows
  const outlineModel = outline ? MOWER_MODELS.find((m) => m.outline && JSON.stringify(m.outline) === JSON.stringify(outline)) : undefined;
  const missing = keys.filter((k) => !known[k]);
  const model = other ? '' : (modelOf(sizesOf(form)) ?? '');
  // a model with a measured outline, while the rectangle is still in use: offered, not put in on its own
  const offered = !outline ? MOWER_MODELS.find((m) => m.key === model && m.outline) : undefined;
  // a planner from before the body check takes robot_width as "the lines are walls": its centre then keeps half the
  // width off them all the way round, so the width only goes to one that knows the rest too
  const usable = (key: BodySetting) => !!known[key] && (key !== 'robot_width' || (!!known.robot_front && !!known.edges));
  // the picked model's turn radius where the planner's is another
  const stored = known.turn_radius?.value;
  const turnChange = turn !== null && known.turn_radius && (typeof stored !== 'number' || Math.abs(stored - turn) > 1e-6) ? turn : null;

  const save = async () => {
    const changes: Record<string, unknown> = {};
    for (const key of keys) {
      const s = known[key];
      if (!s || !usable(key)) continue;
      const text = form[key].trim();
      if (!text) {
        if (s.stored) changes[key] = null; // back to the default
        continue;
      }
      const v = metres(key);
      if (v === null) {
        setState({error: tr('{what} is not a number.', {what: tr(LABELS[key])})});
        return;
      }
      if (!s.stored || typeof s.value !== 'number' || Math.abs(s.value - v) > 1e-6) changes[key] = Math.round(v * 10000) / 10000;
    }
    // the contour only to a planner that knows it, null is the rectangle again
    const send = outline ? grownOutline(outline, OUTLINE_LEEWAY) : null;
    if (known.robot_outline && JSON.stringify(outlineOf(known.robot_outline.value) ?? null) !== JSON.stringify(send)) {
      changes.robot_outline = send;
    }
    if (turnChange !== null) changes.turn_radius = turnChange;
    if (!Object.keys(changes).length) {
      setState({saved: true});
      return;
    }
    setState({busy: true});
    try {
      const s = await savePlannerSettings(changes);
      setForm(formFrom(s.settings));
      setOutline(measuredOutline(outlineOf(s.settings.robot_outline?.value)) ?? null);
      setTurn(null);
      setState({saved: true});
    } catch (e) {
      setState({error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };

  const set = (key: keyof Form, value: string) => {
    setForm({...form, [key]: value});
    if (key === 'robot_width' || key === 'robot_front' || key === 'robot_rear') setOutline(null);
    setOther(false);
    setState({});
  };

  // a model fills in its sizes and its turn radius, saving keeps them; the leeway stays
  const pick = (key: string) => {
    const m = MOWER_MODELS.find((x) => x.key === key);
    setOther(!m);
    setTurn(m?.turnRadius ?? null);
    if (!m) return;
    const next = {...form};
    for (const [field, size] of MODEL_FIELDS) next[field] = cm(m.sizes[size]);
    setForm(next);
    setOutline(m.outline ?? null);
    setState({picked: true});
  };

  return (
    <section className={styles.card}>
      <h2>{tr('Mower sizes')}</h2>
      <p className={styles.dim}>
        {tr(
          'Measured from the middle between the rear drive wheels, the point the mower follows. The planner keeps the body clear of the edges in turns and corners, the map shows the mower at its real size (⚙ on the map, Mower icon, "Real size").',
        )}
      </p>
      {state.offline && settings === undefined && <span className={styles.error}>{tr('The mower did not answer.')}</span>}
      <label className={`${styles.field} ${local.model}`}>
        {tr('Model')}
        <select value={model} onChange={(e) => pick(e.target.value)}>
          <option value="">{tr('Other mower: enter the sizes below')}</option>
          {MOWER_MODELS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {sketch && <MowerSketch body={sketch} />}
      {outline && (
        <p className={styles.dim}>
          {outlineModel ? tr(known.robot_outline ? 'Outline of the {model} plus 1 cm, measured on a photo from straight above. It counts for this model only.' : 'Outline of the {model}, measured on a photo from straight above. It counts for this model only, the planner on the mower checks the rectangle until it knows outlines (newer image).', {model: outlineModel.label}) : tr('A stored outline that is none of the models: pick the model again or enter the sizes.')}
        </p>
      )}
      {offered && !known.robot_outline && (
        <p className={styles.dim}>
          {tr('This model has a measured outline. The planner on the mower does not know outlines yet (newer image), it checks the rectangle until then.')}
        </p>
      )}
      {offered && known.robot_outline && (
        <p className={styles.dim}>
          {tr('This model has a measured outline.')}{' '}
          <button
            className={styles.linkButton}
            onClick={() => {
              setOutline(offered.outline ?? null);
              setState({picked: true});
            }}
          >
            {tr('Use it')}
          </button>
        </p>
      )}
      <div className={local.grid}>
        {keys.map((key) => (
          <label key={key} className={styles.field}>
            {tr(LABELS[key])} (cm)
            <input
              inputMode="decimal"
              value={form[key]}
              placeholder={known[key] ? cm(known[key].default) || tr('none') : ''}
              disabled={!usable(key)}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
        ))}
      </div>
      {missing.length > 0 && settings && (
        <p className={styles.error}>
          {tr('The planner on the mower is older and does not know all sizes yet ({which}), it needs a new image.', {
            which: keys.filter((k) => !usable(k))
              .map((k) => tr(LABELS[k]))
              .join(', '),
          })}
        </p>
      )}
      <div className={local.actions}>
        <button className={styles.pillButton} onClick={save} disabled={state.busy || !settings}>
          {state.busy ? tr('Saving…') : tr('Save')}
        </button>
        {state.saved && (
          <span className={styles.dim}>
            {outline && !known.robot_outline
              ? tr('Saved, without the outline: the planner on the mower does not know outlines yet.')
              : tr('Saved. It counts from the next plan, an interrupted area starts again.')}
          </span>
        )}
        {state.picked && (
          <span className={styles.dim}>
            {turnChange !== null
              ? tr('Filled in, save to keep them. The turn radius goes to {cm} cm with them, gentle on the lawn for this mower.', {
                  cm: Math.round(turnChange * 100),
                })
              : tr('Filled in, save to keep them.')}
          </span>
        )}
        {state.error && <span className={styles.error}>{state.error}</span>}
      </div>
    </section>
  );
}
