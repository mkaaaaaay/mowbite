'use client';

import {numParam, useMowerParams} from '@/hooks/useMowerParams';
import {tr} from '@/lib/i18n';
import {MAX_BLADE, modelOf, MOWER_MODELS, outlineOf, sizesBody, type MowerBody, type MowerSizes, type Outline} from '@/lib/mowerBody';
import {PARAM} from '@/lib/openmower';
import {saveSettings, settingsStore, type Settings} from '@/lib/settings';
import {useState} from 'react';
import local from './MowerSizesSettings.module.css';

// The mower's sizes without the MowBite Planner, optional: with them the map draws its outline and blade and, along the track, the strip the blade
// really cuts. Kept with the other settings. The mowing plan and its preview stay with OpenMower's tool_width.

const FIELDS = [
  ['width', 'Width'],
  ['front', 'Rear axle to the front'],
  ['rear', 'Rear axle to the back'],
  ['blade', 'Blade diameter'],
  ['bladeAhead', 'Blade ahead of the rear axle'],
  ['bladeOffset', 'Blade to the left of the middle'],
] as const;
type Field = (typeof FIELDS)[number][0];
type Form = Record<Field, string>;

type Styles = Record<string, string>;

const cm = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 1000) / 10) : '');

function formFrom(s: MowerSizes | undefined): Form {
  return Object.fromEntries(FIELDS.map(([key]) => [key, cm(s?.[key])])) as Form;
}

const metres = (text: string) => {
  const v = parseFloat(text.replace(',', '.'));
  return text.trim() && Number.isFinite(v) ? v / 100 : null;
};

const sizesOf = (f: Form) => Object.fromEntries(FIELDS.map(([key]) => [key, metres(f[key]) ?? undefined])) as MowerSizes;

// the mower from above, heading right, to scale: body, blade, the point it follows and the gps antenna
function Sketch({body, antenna}: {body: MowerBody; antenna?: {x: number; y: number}}) {
  const pad = 0.12;
  // more room on the left, the width is written there
  const left = pad + 0.06;
  const halfW = Math.max(body.width / 2, body.blade / 2 + Math.abs(body.bladeOffset));
  const x0 = -body.rear - left;
  const w = body.front + body.rear + pad + left;
  const h = 2 * halfW + 2 * pad;
  const label = (v: number) => `${Math.round(v * 100)} cm`;
  return (
    <svg className={local.sketch} viewBox={`${x0} ${-halfW - pad} ${w} ${h}`} role="img" aria-label={tr('The mower from above')}>
      {/* y flipped: left of the mower is up */}
      <g transform="scale(1 -1)">
        {body.outline ? (
          <polygon className={local.body} points={body.outline.map(([ahead, left]) => `${ahead},${left}`).join(' ')} />
        ) : (
          <rect className={local.body} x={-body.rear} y={-body.width / 2} width={body.front + body.rear} height={body.width} rx={0.03} />
        )}
        {body.blade > 0 && <circle className={local.blade} cx={body.bladeAhead} cy={body.bladeOffset} r={body.blade / 2} />}
        <line className={local.axle} x1={0} y1={-body.width / 2} x2={0} y2={body.width / 2} />
        <circle className={local.point} cx={0} cy={0} r={0.015} />
        <path className={local.heading} d={`M ${body.front - 0.09} 0 l -0.05 0.035 m 0.05 -0.035 l -0.05 -0.035`} />
        {antenna && <circle className={local.antenna} cx={antenna.x} cy={antenna.y} r={0.02} />}
      </g>
      <text className={local.text} x={body.front / 2} y={-body.width / 2 - 0.03} textAnchor="middle">
        {label(body.front)}
      </text>
      <text className={local.text} x={-body.rear / 2} y={-body.width / 2 - 0.03} textAnchor="middle">
        {label(body.rear)}
      </text>
      <text className={local.text} x={-body.rear - 0.02} y={0.015} textAnchor="end">
        {label(body.width)}
      </text>
    </svg>
  );
}

export function MowerSizesSettings({settings, styles}: {settings: Settings; styles: Styles}) {
  const sizes = settings.mower;
  const [form, setForm] = useState<Form>(() => formFrom(sizes));
  // the body's real contour, from a model; typed sizes go back to the rectangle
  const [outline, setOutline] = useState<Outline | null>(() => outlineOf(sizes?.outline) ?? null);
  // the saved sizes arrive after the first render (the page is built ahead, then the container answers) or change on
  // another device: the fields follow them as long as nothing is typed in them
  const [shown, setShown] = useState(sizes);
  if (shown !== sizes) {
    setShown(sizes);
    if (JSON.stringify(form) === JSON.stringify(formFrom(shown))) {
      setForm(formFrom(sizes));
      setOutline(outlineOf(sizes?.outline) ?? null);
    }
  }
  // "other mower" picked while the fields still hold a model's sizes
  const [other, setOther] = useState(false);
  const [state, setState] = useState<{error?: string; saved?: boolean; picked?: boolean}>({});
  const params = useMowerParams();
  const toolWidth = numParam(params, PARAM.toolWidth);
  const antennaX = numParam(params, PARAM.antennaX);
  const antenna = antennaX === undefined ? undefined : {x: antennaX, y: numParam(params, PARAM.antennaY) ?? 0};

  // the sketch follows the fields while typing
  const typed = sizesOf(form);
  const model = other ? '' : (modelOf(typed) ?? '');
  const rect = sizesBody(typed);
  const sketch = rect && outline ? {...rect, outline} : rect;
  // a model with a measured outline, while the rectangle is still in use: offered, not put in on its own
  const offered = !outline ? MOWER_MODELS.find((m) => m.key === model && m.outline) : undefined;
  // the model whose outline it is, named so a wrong pick shows
  const outlineModel = outline ? MOWER_MODELS.find((m) => m.outline && JSON.stringify(m.outline) === JSON.stringify(outline)) : undefined;
  const stored = !!sizesBody(sizes);
  const blade = typed.blade;

  const store = (next: MowerSizes | null) => saveSettings({...settingsStore.snapshot(), mower: next ?? undefined});

  const save = () => {
    const next: MowerSizes = {};
    for (const [key, label] of FIELDS) {
      if (!form[key].trim()) continue;
      const v = metres(form[key]);
      if (v === null) return setState({error: tr('{what} is not a number.', {what: tr(label)})});
      next[key] = Math.round(v * 10000) / 10000;
    }
    if (!Object.keys(next).length) {
      store(null);
      return setState({saved: true});
    }
    if (!sizesBody(next)) return setState({error: tr('Width and the lengths to the front and back are needed.')});
    if (outline) next.outline = outline;
    if (next.blade !== undefined && (next.blade <= 0 || next.blade > MAX_BLADE))
      return setState({error: tr('The blade diameter can be at most {n} cm.', {n: MAX_BLADE * 100})});
    store(next);
    setState({saved: true});
  };

  const remove = () => {
    store(null);
    setForm(formFrom(undefined));
    setOutline(null);
    setState({});
  };

  const set = (key: Field, value: string) => {
    setForm({...form, [key]: value});
    if (key === 'width' || key === 'front' || key === 'rear') setOutline(null);
    setOther(false);
    setState({});
  };

  // a model fills in its sizes, saving keeps them
  const pick = (key: string) => {
    const m = MOWER_MODELS.find((x) => x.key === key);
    setOther(!m);
    if (!m) return;
    setForm(formFrom(m.sizes));
    setOutline(m.outline ?? null);
    setState({picked: true});
  };

  // what the blade cuts against how far apart OpenMower lays the lanes
  const lanes =
    blade && blade > 0 && blade <= MAX_BLADE && toolWidth
      ? Math.round((blade - toolWidth) * 100) === 0
        ? tr('OpenMower lays the lanes {w} cm apart, they just touch.', {w: Math.round(toolWidth * 100)})
        : blade > toolWidth
          ? tr('OpenMower lays the lanes {w} cm apart, so they overlap by {d} cm.', {
              w: Math.round(toolWidth * 100),
              d: Math.round((blade - toolWidth) * 100),
            })
          : tr('OpenMower lays the lanes {w} cm apart, so {d} cm stay uncut between them.', {
              w: Math.round(toolWidth * 100),
              d: Math.round((toolWidth - blade) * 100),
            })
      : null;

  return (
    <section className={styles.card}>
      <h2>{tr('Mower sizes')}</h2>
      <p className={styles.dim}>
        {tr(
          'Optional. Measured from the middle between the rear drive wheels, the point OpenMower follows. With them the map shows the mower’s outline with its blade, along the track the strip the blade really cuts, and the real edges: the outlines were recorded with the middle of the mower, the lawn reaches half its width further out and obstacles are that much smaller. All of it can be switched on and off under the layers of the map, the mower icon too. The map itself, the mowing plan and its preview stay as they are.',
        )}
      </p>
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
      {sketch && <Sketch body={sketch} antenna={antenna} />}
      {outline && <p className={styles.dim}>{outlineModel ? tr('Outline of the {model}, measured on a photo from straight above. It counts for this model only.', {model: outlineModel.label}) : tr('A stored outline that is none of the models: pick the model again or enter the sizes.')}</p>}
      {offered && (
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
        {FIELDS.map(([key, label]) => (
          <label key={key} className={styles.field}>
            {tr(label)} (cm)
            <input inputMode="decimal" value={form[key]} onChange={(e) => set(key, e.target.value)} />
          </label>
        ))}
      </div>
      {blade !== undefined && blade > 0 && blade <= MAX_BLADE && (
        <p className={styles.dim}>
          <strong>{tr('Cut width {n} cm', {n: Math.round(blade * 1000) / 10})}</strong>
          {lanes && ` · ${lanes}`}
        </p>
      )}
      {antenna && (
        <p className={styles.dim}>
          {tr(
            'The GPS antenna is already taken out by OpenMower: antenna_offset_x {x} cm and antenna_offset_y {y} cm in mower_params.yaml (the green dot). If that is off, the outline and the strip are off by as much.',
            {x: Math.round(antenna.x * 1000) / 10, y: Math.round(antenna.y * 1000) / 10},
          )}
        </p>
      )}
      <div className={local.actions}>
        <button className={styles.pillButton} onClick={save}>
          {tr('Save')}
        </button>
        {stored && (
          <button className={styles.pillButton} onClick={remove}>
            {tr('Remove')}
          </button>
        )}
        {state.saved && <span className={styles.dim}>{tr('Saved.')}</span>}
        {state.picked && <span className={styles.dim}>{tr('Filled in, save to keep them.')}</span>}
        {state.error && <span className={styles.error}>{state.error}</span>}
      </div>
    </section>
  );
}
