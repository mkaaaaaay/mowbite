'use client';

import {useRpcMethods} from '@/hooks/useRpcMethods';
import {cmMetres, cmText, tr} from '@/lib/i18n';
import {
  autoOutlineModel,
  BODY_SETTINGS,
  bodyFrom,
  loadPlannerSettings,
  modelOf,
  MOWER_MODELS,
  measuredOutline,
  num,
  OUTLINE_LEEWAY,
  grownOutline,
  loadGeometry,
  outlineOf,
  outsideLimits,
  plannerOutline,
  saveGeometry,
  savePlannerSettings,
  sizesBody,
  slic3rPlans,
  usePlannerSettings,
  withModelOutline,
  type BodySetting,
  type Geometry,
  type MowerSizes,
  type Outline,
  type PlannerSetting,
} from '@/lib/mowerBody';
import {RPC} from '@/lib/openmower';
import {RpcError} from '@/lib/rpc';
import {answerError} from '@/lib/rpcText';
import {useRouter} from 'next/navigation';
import {saveSettings, settingsStore} from '@/lib/settings';
import {useEffect, useState, useSyncExternalStore} from 'react';
import local from './MowerBodySettings.module.css';
import {ANTENNA_LABELS, useAntennaFields} from './AntennaFields';
import {MowerSketch} from './MowerSketch';

// The mower's sizes for the MowBite Planner on the mower (planner.settings): it keeps the body clear of the edges in
// turns and corners and draws the mower at its real size on the map. Kept by the planner, so every app and the
// planner itself use the same ones. Set once, so in the settings. On MowBite OS the OS keeps them with the antenna
// (robot.geometry), its planner only shows them.

const LABELS: Record<BodySetting, string> = {
  robot_width: 'Width',
  robot_front: 'Rear axle to the front',
  robot_rear: 'Rear axle to the back',
  mower_width: 'Blade diameter',
  blade_ahead: 'Blade ahead of the rear axle',
  blade_offset: 'Blade to the left of the middle',
};

// the other sizes MowBite OS may name in a refusal
const GEOMETRY_LABELS: Record<string, string> = {...LABELS, robot_outline: 'Outline of the body', ...ANTENNA_LABELS};

// why MowBite OS didn't take the sizes (robot.geometry.set's reasons), in words; anything else as for any card
function geometryError(e: unknown): string {
  const d = e instanceof RpcError ? e.data : undefined;
  if (!d || typeof d.reason !== 'string' || d.reason === 'HOLD' || d.event) return answerError(e);
  const key = typeof d.key === 'string' ? d.key : '';
  const what = GEOMETRY_LABELS[key] ? tr(GEOMETRY_LABELS[key]) : key;
  const range = {what, min: cmText(d.min), max: cmText(d.max)};
  switch (d.reason) {
    case 'BUSY':
      return tr('The sizes change only while the mower is idle, not while it records, drives or mows.');
    case 'VERSION':
      return tr('The sizes were changed elsewhere in the meantime, they are shown as they are now. Save again to keep yours.');
    case 'OUT_OF_RANGE':
      return tr('{what} has to be between {min} and {max} cm.', range);
    case 'OUTSIDE_BODY':
      return tr('{what} has to be inside the body, between {min} and {max} cm.', range);
    case 'NOT_SETTABLE':
      return tr("{what} comes with the mower's platform, it can't be changed here.", {what});
    case 'INVALID_VALUE':
      return tr('{what} is not a valid value.', {what});
  }
  // UNKNOWN_KEY, INVALID_REQUEST: a mistake of the app, in the OS's words
  return tr('The mower did not take the sizes: {why}', {why: (e as RpcError).message});
}

type Styles = Record<string, string>;
type Form = Record<BodySetting, string>;

// the outline stored, as measured for a model (the planner has it 1 cm larger)
const outlineFrom = (settings: Record<string, {value: unknown}> | undefined): Outline | null =>
  measuredOutline(outlineOf(settings?.robot_outline?.value)) ?? null;

function formFrom(settings: Record<string, {value: unknown}> | undefined): Form {
  const f = {} as Form;
  for (const key of BODY_SETTINGS) f[key] = cmText(settings?.[key]?.value);
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

// a planner setting's name among the sizes
const SIZE_KEY = Object.fromEntries(MODEL_FIELDS) as Record<BodySetting, (typeof MODEL_FIELDS)[number][1]>;

const sizesOf = (f: Form): MowerSizes => Object.fromEntries(MODEL_FIELDS.map(([key, size]) => [size, cmMetres(f[key]) ?? undefined]));

// A planner that knows the body's sizes but has none: it plans without checking the body, whatever the collision check
// and the distances say. Sizes set in this app before the planner came only draw the mower on the map, they are
// offered to the planner here, or the way to the sizes in the settings
export function NoSizesWarning() {
  const router = useRouter();
  const settings = usePlannerSettings();
  const app = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const [state, setState] = useState<{busy?: boolean; error?: string}>({});
  const known = settings?.settings;
  if (!known?.robot_width || !known.robot_front || !known.robot_rear || slic3rPlans(settings) || bodyFrom(settings)) return null;
  if (known.robot_width.settable === false) return null;
  const own = sizesBody(withModelOutline(app.mower, app.keepRectangle));

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
      setState({error: answerError(e)});
    }
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
      <button type="button" onClick={() => router.push('/settings#sizes')}>
        {own ? tr('Or set them in the settings') : tr('Set them in the settings')}
      </button>
      {state.error && <span>{state.error}</span>}
    </div>
  );
}

export function MowerBodySettings({styles}: {styles: Styles}) {
  const settings = usePlannerSettings();
  const app = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  // MowBite OS: the sizes are its own (robot.geometry), null until read
  const onOs = !!useRpcMethods()?.has(RPC.geometry);
  const [geo, setGeo] = useState<Geometry | null>(null);
  const source = onOs ? geo?.settings : settings?.settings;
  const [form, setForm] = useState<Form>(() => formFrom(source));
  const [state, setState] = useState<{busy?: boolean; error?: string; saved?: boolean; offline?: boolean; picked?: boolean}>({});
  // "other mower" picked while the fields still hold a model's sizes
  const [other, setOther] = useState(false);
  // the body's real contour (robot_outline), from a model; typed sizes go back to the rectangle
  // the measured one, the planner has it 1 cm larger
  const [outline, setOutline] = useState<Outline | null>(() => outlineFrom(source));
  // the turn radius of the model just picked, saved with the sizes
  const [turn, setTurn] = useState<number | null>(null);
  // the stored sizes arrive after the first render or change elsewhere (the warning's button, another device): each
  // field follows them as long as nothing is typed in it, saving would clear what they don't show
  const [shown, setShown] = useState(source);
  if (shown !== source) {
    setShown(source);
    const before = formFrom(shown);
    const now = formFrom(source);
    setForm(Object.fromEntries(BODY_SETTINGS.map((k) => [k, form[k] === before[k] ? now[k] : form[k]])) as Form);
    if (JSON.stringify(outline) === JSON.stringify(outlineFrom(shown))) setOutline(outlineFrom(source));
  }

  useEffect(() => {
    loadPlannerSettings(true).catch(() => setState({offline: true}));
  }, []);
  useEffect(() => {
    if (onOs) loadGeometry().then(setGeo, () => setState({offline: true}));
  }, [onOs]);

  const known = source ?? {};
  const loaded = !!source;
  const keys = BODY_SETTINGS;
  // what the form would make of it: the sketch follows the fields while typing
  const metres = (key: BodySetting) => cmMetres(form[key]);
  const rect = bodyFrom({
    settings: Object.fromEntries(BODY_SETTINGS.map((k) => [k, {value: metres(k)} as never])),
  });
  const {antenna, fields: antennaFields, typed: antennaTyped, bad: antennaBad, clear: clearAntenna} = useAntennaFields(
    styles,
    onOs ? (geo ? {x: num(geo, 'antenna_x') ?? 0, y: num(geo, 'antenna_y') ?? 0} : null) : undefined,
  );
  const sketch = rect && outline ? {...rect, outline} : rect;
  // the model whose outline it is, named so a wrong pick shows
  const outlineModel = outline ? MOWER_MODELS.find((m) => m.outline && JSON.stringify(m.outline) === JSON.stringify(outline)) : undefined;
  // the outline the app gave the planner by itself, while the card shows what's stored
  const taken =
    !onOs &&
    !!outlineModel &&
    app.autoOutline === outlineModel.key &&
    JSON.stringify(outline) === JSON.stringify(outlineFrom(known)) &&
    JSON.stringify(form) === JSON.stringify(formFrom(known));
  const missing = loaded ? keys.filter((k) => !known[k]) : [];
  const model = other ? '' : (modelOf(sizesOf(form)) ?? '');
  // a model with a measured outline, while the rectangle is still in use: offered, not put in on its own
  const offered = !outline ? MOWER_MODELS.find((m) => m.key === model && m.outline) : undefined;
  // a planner from before the body check takes robot_width as "the lines are walls": its centre then keeps half the
  // width off them all the way round, so the width only goes to one that knows the rest too. One that has them from
  // elsewhere (MowBite OS) doesn't take them
  const usable = (key: BodySetting) =>
    !!known[key] && known[key].settable !== false && (onOs || key !== 'robot_width' || (!!known.robot_front && !!known.edges));
  // the picked model's turn radius where the planner's is another (the planner's on MowBite OS too)
  const t = settings?.settings.turn_radius;
  const turnChange = turn !== null && t && t.settable !== false && (typeof t.value !== 'number' || Math.abs(t.value - turn) > 1e-6) ? turn : null;

  // a save decides: an outline the app gave by itself is no longer that, one sent along ends a kept rectangle, the
  // rectangle saved for a model's sizes (to a planner that knows outlines) is kept
  const decided = (o: Outline | null) => {
    const now = settingsStore.snapshot();
    const keep = o ? undefined : known.robot_outline && autoOutlineModel(sizesOf(form)) ? true : now.keepRectangle;
    if (now.autoOutline === undefined && now.keepRectangle === keep) return;
    saveSettings({...now, autoOutline: undefined, keepRectangle: keep});
  };

  // the fields as saved
  const showStored = (stored: Record<string, PlannerSetting>) => {
    setForm(formFrom(stored));
    setOutline(outlineFrom(stored));
  };

  const save = async (o: Outline | null = outline) => {
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
      const outside = outsideLimits(SIZE_KEY[key], v);
      if (outside) {
        setState({error: tr('{what} has to be between {min} and {max} cm.', {what: tr(LABELS[key]), ...outside})});
        return;
      }
      // the planner keeps one it takes from mower_logic as its own, MowBite OS only what differs from the platform's
      if ((!onOs && !s.stored) || typeof s.value !== 'number' || Math.abs(s.value - v) > 1e-6) changes[key] = Math.round(v * 10000) / 10000;
    }
    // the contour only to a planner that knows it, null is the rectangle again
    const send = o ? plannerOutline(o) : null;
    if (known.robot_outline && JSON.stringify(outlineOf(known.robot_outline.value) ?? null) !== JSON.stringify(send)) {
      changes.robot_outline = send;
    }
    if (onOs) return saveOnOs(changes);
    if (turnChange !== null) changes.turn_radius = turnChange;
    if (!Object.keys(changes).length) {
      decided(o);
      setState({saved: true});
      return;
    }
    setState({busy: true});
    try {
      const s = await savePlannerSettings(changes);
      decided(o);
      showStored(s.settings);
      setTurn(null);
      setState({saved: true});
    } catch (e) {
      setState({error: answerError(e)});
    }
  };

  // to MowBite OS: the sizes and the antenna (cleared ones back to the platform's, no outline is []), the turn radius
  // still to the planner
  const saveOnOs = async (changes: Record<string, unknown>) => {
    if (!geo) return;
    if (antennaBad) {
      setState({error: tr('{what} is not a number.', {what: tr(GEOMETRY_LABELS[antennaBad])})});
      return;
    }
    if (antennaTyped) {
      changes.antenna_x = antennaTyped.x;
      changes.antenna_y = antennaTyped.y;
    }
    const values: Record<string, unknown> = {};
    const reset: string[] = [];
    for (const [k, v] of Object.entries(changes)) {
      if (v !== null) values[k] = v;
      else if (k === 'robot_outline') values[k] = [];
      else reset.push(k);
    }
    const toOs = Object.keys(values).length > 0 || reset.length > 0;
    if (!toOs && turnChange === null) {
      setState({saved: true});
      return;
    }
    setState({busy: true});
    try {
      if (toOs) {
        const g = await saveGeometry(geo.version, values, reset);
        setGeo(g);
        showStored(g.settings);
        clearAntenna();
      }
      if (turnChange !== null) await savePlannerSettings({turn_radius: turnChange});
      setTurn(null);
      setState({saved: true});
    } catch (e) {
      // read again for the next try, what's typed stays
      if (e instanceof RpcError && e.data?.reason === 'VERSION') loadGeometry().then(setGeo, () => {});
      setState({error: geometryError(e)});
    }
  };

  // the rectangle for a model's sizes: the planner checks it again and the outline doesn't come back on its own
  const toRectangle = async () => {
    setState({busy: true});
    try {
      const s = await savePlannerSettings({robot_outline: null});
      saveSettings({...settingsStore.snapshot(), keepRectangle: true, autoOutline: undefined});
      setOutline(outlineFrom(s.settings));
      setState({});
    } catch (e) {
      setState({error: answerError(e)});
    }
  };

  const set = (key: keyof Form, value: string) => {
    setForm({...form, [key]: value});
    if (key === 'robot_width' || key === 'robot_front' || key === 'robot_rear') setOutline(null);
    setOther(false);
    setTurn(null);
    setState({});
  };

  // a model fills in its sizes and its turn radius, saving keeps them; the leeway stays
  const pick = (key: string) => {
    const m = MOWER_MODELS.find((x) => x.key === key);
    setOther(!m);
    setTurn(m?.turnRadius ?? null);
    if (!m) return;
    const next = {...form};
    for (const [field, size] of MODEL_FIELDS) next[field] = cmText(m.sizes[size]);
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
      {state.offline && !loaded && <span className={styles.error}>{tr('The mower did not answer.')}</span>}
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
      {sketch && <MowerSketch body={sketch} antenna={antenna} />}
      {outline && (
        <p className={styles.dim}>
          {outlineModel ? tr(known.robot_outline ? 'Outline of the {model} plus 1 cm, measured on a photo from straight above. It counts for this model only.' : 'Outline of the {model}, measured on a photo from straight above. It counts for this model only, the planner on the mower checks the rectangle until it knows outlines (newer image).', {model: outlineModel.label}) : tr('A stored outline that is none of the models: pick the model again or enter the sizes.')}
        </p>
      )}
      {taken && (
        <p className={styles.dim}>
          {tr("Picked by itself: the sizes match this model exactly.")}{' '}
          <button className={styles.linkButton} disabled={state.busy} onClick={() => void toRectangle()}>
            {tr('Keep the rectangle')}
          </button>
        </p>
      )}
      {offered && !known.robot_outline && (
        <p className={styles.dim}>
          {tr("This model has a measured outline. The planner on the mower doesn't support outlines yet (needs a newer image), until then it checks the rectangle.")}
        </p>
      )}
      {offered && known.robot_outline && (
        <p className={styles.dim}>
          {tr('This model has a measured outline.')}{' '}
          <button
            className={styles.linkButton}
            disabled={state.busy}
            onClick={() => {
              setOutline(offered.outline ?? null);
              void save(offered.outline ?? null);
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
              placeholder={known[key] ? cmText(known[key].default) || tr('none') : ''}
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
        <button className={styles.pillButton} onClick={() => void save()} disabled={state.busy || !loaded}>
          {state.busy ? tr('Saving…') : tr('Save')}
        </button>
        {state.saved && (
          <span className={styles.dim}>
            {outline && !known.robot_outline
              ? tr("Saved, without the outline: the planner on the mower doesn't support outlines yet.")
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
      {antennaFields}
    </section>
  );
}
