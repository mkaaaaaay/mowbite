import {areaLook, facing, LookPicker, LookSwatch, placeThing, type Look} from '@/components/gardenLook';
import {GROUND_KEYS, PICTURES} from '@/components/gardenPictures';
import {MagnetIcon, MergeIcon, ScissorsIcon, SimplifyIcon, SubtractIcon, TrashIcon} from '@/components/icons';
import InfoTip from '@/components/InfoTip';
import {polygonArea} from '@/lib/geometry';
import {fmt, tr} from '@/lib/i18n';
import {useAreaProperties} from '@/lib/areaProps';
import {usePlannerSettings} from '@/lib/mowerBody';
import {saveSettings, settingsStore} from '@/lib/settings';
import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {AREA_TYPES, type Area, type UpdateArea} from './editing';
import styles from './page.module.css';

// name, type and active switch of the selected area, and what can be done with it. areas: the map's as edited
export default function AreaCard({
  area,
  areas,
  showTools,
  confirmDelete,
  remember,
  update,
  onSplit,
  onMerge,
  onSubtract,
  onSnap,
  onSimplify,
  onDelete,
  onDeleteBlur,
}: {
  area: Area;
  areas: Area[];
  showTools: boolean;
  confirmDelete: boolean;
  remember: () => void;
  update: UpdateArea;
  onSplit: () => void;
  onMerge: () => void;
  onSubtract: () => void;
  onSnap: () => void;
  onSimplify: () => void;
  onDelete: () => void;
  onDeleteBlur: () => void;
}) {
  const type = area.properties.type ?? 'draft';
  const supported = useAreaProperties();
  const tool = [styles.pillButton, styles.tool].join(' ');
  // how far the body keeps off it, with a planner that checks the mower's body (obstacle_margin): for an obstacle, an
  // area not mowed or an inactive one. The mower keeps it as a property of the area it doesn't know (not in
  // map.area_properties), the planner takes it once the map is saved
  const planner = usePlannerSettings();
  const keepOff = planner?.settings.obstacle_margin;
  const marginShown = !!keepOff && type !== 'decor' && (type === 'obstacle' || area.properties.active === false || area.properties.mowable === false);
  const [marginDraft, setMarginDraft] = useState<string | null>(null);
  const marginCm = typeof area.properties.margin === 'number' ? String(Math.round(area.properties.margin * 1000) / 10) : '';
  const defaultCm = typeof keepOff?.value === 'number' ? String(Math.round(keepOff.value * 1000) / 10) : '';
  // in the garden map style the picture a way, an obstacle or decoration is drawn as, kept with the app's settings (not the map)
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const pictured = settings.mapStyle === 'garden' && (type === 'obstacle' || type === 'decor' || type === 'nav');
  const picked = settings.looks?.[area.id];
  const shown = areaLook(area, settings.looks);
  const [picking, setPicking] = useState(false);
  // the color of a picture that comes in several, none: its usual one (or one of its own by the area)
  const variants = PICTURES[shown]?.variants;
  const kept = settings.lookVariants?.[area.id];
  const variant = variants?.some((v) => v.key === kept) ? kept : undefined;
  // what's kept for the area's picture: which one, its color, size, direction and the ground under it. null takes one
  // back to auto, left out it stays
  const keep = (to: {look?: string | null; variant?: string | null; size?: number | null; turn?: number | null; closed?: true | null; ground?: string | null}) => {
    const cur = settingsStore.snapshot();
    const put = <T,>(all: Record<string, T> | undefined, v: T | null | undefined) => {
      if (v === undefined) return all;
      const next = {...all};
      if (v === null) delete next[area.id];
      else next[area.id] = v;
      return Object.keys(next).length ? next : undefined;
    };
    saveSettings({
      ...cur,
      looks: put(cur.looks, to.look) ?? {},
      lookVariants: put(cur.lookVariants, to.variant),
      lookSizes: put(cur.lookSizes, to.size),
      lookTurns: put(cur.lookTurns, to.turn),
      lookClosed: put(cur.lookClosed, to.closed),
      lookGrounds: put(cur.lookGrounds, to.ground),
    });
  };
  // the ground under and round a picture standing in the area (what shows between a bed's plants too), none: its own
  const grounded = pictured && !!PICTURES[shown]?.thing;
  const ground = grounded && GROUND_KEYS.includes(settings.lookGrounds?.[area.id] ?? '') ? settings.lookGrounds?.[area.id] : undefined;
  const setGround = (key: string | undefined) => keep({ground: key ?? null});
  // another picture starts with its own usual color, size and direction
  const setLook = (look: Look | undefined) => keep({look: look ?? null, variant: null, size: null, turn: null, closed: null});
  const setVariant = (key: string | undefined) => keep({variant: key ?? null});
  // how big a picture standing in the area is drawn (m across, a long one its length, bushes each), none: by the area and
  // its usual size. the slider starts about where it is and goes from a good deal smaller to a good deal bigger
  const pic = PICTURES[shown];
  const sizable = pictured && !!pic?.thing && !pic.fill;
  const ownSize = sizable ? settings.lookSizes?.[area.id] : undefined;
  const fitted = useMemo(() => (sizable && area.outline.length > 2 ? placeThing(shown, area.outline) : null), [sizable, shown, area.outline]);
  const autoSize = (() => {
    if (!fitted) return 1;
    const [lo, hi] = pic.size ?? [fitted.w, fitted.w];
    if (pic.over) return Math.min(Math.max(fitted.w, lo), hi);
    if (pic.many) return Math.min(Math.max((lo + Math.min(hi, fitted.w)) / 2, lo), hi);
    return Math.min(fitted.w, hi);
  })();
  const sizeFrom = Math.max(0.1, Math.round(Math.min(pic?.size?.[0] ?? autoSize, autoSize) * 4) / 10);
  const sizeTo = Math.min(30, Math.round(Math.max(pic?.size?.[1] ?? autoSize, autoSize) * 25) / 10);
  const setSize = (v: number | undefined) => keep({size: v ?? null});
  // a step bigger or smaller from what it's drawn at, finer while it's small
  const stepSize = (dir: 1 | -1) => {
    const now = settingsStore.snapshot().lookSizes?.[area.id] ?? Math.round(autoSize * 10) / 10;
    const by = now < 2 ? 0.1 : now < 10 ? 0.5 : 1;
    setSize(Math.min(sizeTo, Math.max(sizeFrom, Math.round((now + dir * by) / by) * by)));
  };
  // which way it lies (degrees on the map, 0 east), a cantilever parasol which way it reaches. none: along the area, a
  // parasol towards the seats next to it or into the lawn like the map draws it. not for what looks the same turned
  // any way
  const turnable = sizable && !pic.round;
  const ownTurn = turnable ? settings.lookTurns?.[area.id] : undefined;
  const faces = turnable && !!pic.turn;
  // the map's y points up, the drawing's down
  const faced = useMemo(
    () => (faces && area.outline.length > 2 ? facing(area, areas, settings.looks, (p) => ({x: p.x, y: -p.y})) : null),
    [faces, areas, area, settings.looks],
  );
  const autoDeg = faced ?? (fitted && pic.long ? -fitted.deg : 0);
  const autoTurn = (Math.round((((autoDeg % 360) + 360) % 360) / 5) * 5) % 360;
  const setTurn = (v: number | undefined) => keep({turn: v ?? null});
  const stepTurn = (dir: 1 | -1) => setTurn((((settingsStore.snapshot().lookTurns?.[area.id] ?? autoTurn) + dir * 5) % 360 + 360) % 360);
  // a parasol open or folded up
  const folds = sizable && !!pic.folds;
  const closed = folds && settings.lookClosed?.[area.id] === true;
  const compass = (deg: number) => ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  const applyMargin = () => {
    if (marginDraft === null) return;
    const v = Number(marginDraft.trim().replace(',', '.'));
    setMarginDraft(null);
    if (!marginDraft.trim()) return update({margin: undefined});
    if (Number.isFinite(v)) update({margin: Math.min(100, Math.max(0, v)) / 100});
  };
  return (
    <div className={styles.areaEditor}>
      <div className={styles.areaHead}>
        <input
          className={styles.nameInput}
          value={area.properties.name ?? ''}
          placeholder={tr('unnamed')}
          // one undo step per rename, not per keystroke
          onFocus={remember}
          onChange={(e) => update({name: e.target.value}, false)}
        />
        <select className={styles.typeSelect} value={type} onChange={(e) => update({type: e.target.value})}>
          {AREA_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {tr(t.label)}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.areaMeta}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={area.properties.active !== false}
            onChange={() => update({active: area.properties.active === false})}
          />
          {tr('active')}
          <InfoTip>
            {type === 'obstacle'
              ? tr("Off: the mower ignores the obstacle and mows over the spot as if it wasn't there.")
              : type === 'decor'
                ? tr('Off: drawn faded. The mower ignores decoration either way.')
                : tr('Ignored by the mower and not drivable. Careful: if the mower stands on an inactive area, it gets stuck.')}
          </InfoTip>
        </label>
        {type === 'mow' && area.properties.active !== false && supported.has('mowable') && (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={area.properties.mowable === false}
              onChange={() => update({mowable: area.properties.mowable === false ? undefined : false})}
            />
            {tr("don't mow")}
            <InfoTip>
              {tr('Not mowed, but the mower may drive across it (unlike inactive).')}
            </InfoTip>
          </label>
        )}
        {type === 'mow' && area.properties.active !== false && area.properties.mowable === false && supported.has('mow_around') && (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={area.properties.mow_around === true}
              onChange={() => update({mow_around: area.properties.mow_around ? undefined : true})}
            />
            {tr('mow around it')}
            <InfoTip>
              {tr(
                'The mowing areas it lies in end their lanes at its edge and go around it once. Otherwise the lanes go across it with the blade off. It stays drivable either way.',
              )}
            </InfoTip>
          </label>
        )}
        {marginShown && (
          <label className={styles.toggle}>
            {tr('Own safety distance')}
            <input
              className={styles.marginInput}
              inputMode="decimal"
              value={marginDraft ?? marginCm}
              placeholder={defaultCm}
              onChange={(e) => setMarginDraft(e.target.value)}
              onBlur={applyMargin}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            cm
            <InfoTip>
              {tr('How far the mower keeps its body off this one. It counts once the map is saved.')}
            </InfoTip>
          </label>
        )}
        {marginShown && (
          <span className={styles.dim}>
            {marginCm
              ? tr('Counts here in place of the {cm} cm for all obstacles (planner menu, Obstacles).', {cm: defaultCm})
              : tr('Empty: the {cm} cm for all obstacles (planner menu, Obstacles).', {cm: defaultCm})}
          </span>
        )}
        <span className={styles.dim}>
          {area.properties.active === false && type !== 'decor'
            ? type === 'obstacle'
              ? tr('inactive: ignored, the mower mows there')
              : tr('inactive: not driven on and not mowed')
            : type === 'mow' && area.properties.mowable === false
              ? tr('driven on, but not mowed')
              : tr(AREA_TYPES.find((t) => t.value === type)?.hint ?? '')}
          {' · '}
          {fmt(polygonArea(area.outline), 1)} m²
        </span>
      </div>
      {pictured && (
        <div className={styles.lookRow}>
          <span className={styles.dim}>{tr('Picture on the map')}</span>
          <button className={styles.lookButton} onClick={() => setPicking(true)}>
            <LookSwatch look={shown} size={28} seed={area.id} variant={variant} />
            {tr(PICTURES[shown].label)}
            {!picked && <span className={styles.dim}>({tr('auto')})</span>}
          </button>
        </div>
      )}
      {pictured && variants && (
        <div className={styles.lookRow}>
          <span className={[styles.dim, styles.variantLabel].join(' ')}>{tr('Color')}</span>
          <div className={styles.variantList} role="radiogroup" aria-label={tr('Color')}>
            <button
              role="radio"
              aria-checked={!variant}
              className={[styles.variantButton, styles.variantText, !variant ? styles.variantOn : ''].join(' ')}
              onClick={() => setVariant(undefined)}
            >
              {tr('auto')}
            </button>
            {variants.map((v) => (
              <button
                key={v.key}
                role="radio"
                aria-checked={variant === v.key}
                className={[styles.variantButton, variant === v.key ? styles.variantOn : ''].join(' ')}
                onClick={() => setVariant(v.key)}
                title={tr(v.label)}
                aria-label={tr(v.label)}
              >
                <LookSwatch look={shown} size={30} seed={area.id} variant={v.key} />
              </button>
            ))}
          </div>
        </div>
      )}
      {grounded && (
        <div className={styles.lookRow}>
          <span className={[styles.dim, styles.variantLabel].join(' ')}>{tr('Ground under it')}</span>
          <div className={styles.variantList} role="radiogroup" aria-label={tr('Ground under it')}>
            <button
              role="radio"
              aria-checked={!ground}
              className={[styles.variantButton, styles.variantText, !ground ? styles.variantOn : ''].join(' ')}
              onClick={() => setGround(undefined)}
            >
              {tr('auto')}
            </button>
            {GROUND_KEYS.map((key) => (
              <button
                key={key}
                role="radio"
                aria-checked={ground === key}
                className={[styles.variantButton, ground === key ? styles.variantOn : ''].join(' ')}
                onClick={() => setGround(key)}
                title={tr(PICTURES[key].label)}
                aria-label={tr(PICTURES[key].label)}
              >
                <LookSwatch look={key} size={30} />
              </button>
            ))}
          </div>
        </div>
      )}
      {sizable && (
        <div className={styles.lookRow}>
          <span className={[styles.dim, styles.variantLabel].join(' ')}>{tr('Size')}</span>
          <div className={styles.variantList}>
            <button
              role="switch"
              aria-checked={!ownSize}
              className={[styles.variantButton, styles.variantText, !ownSize ? styles.variantOn : ''].join(' ')}
              onClick={() => setSize(undefined)}
            >
              {tr('auto')}
            </button>
            <Stepper label={tr('Size')} text={`${fmt(ownSize ?? Math.round(autoSize * 10) / 10, 1)} m`} dim={!ownSize} onStep={stepSize} />
          </div>
        </div>
      )}
      {folds && (
        <div className={styles.lookRow}>
          <span className={[styles.dim, styles.variantLabel].join(' ')}>{tr('Canopy')}</span>
          <div className={styles.variantList} role="radiogroup" aria-label={tr('Canopy')}>
            {[false, true].map((shut) => (
              <button
                key={String(shut)}
                role="radio"
                aria-checked={closed === shut}
                className={[styles.variantButton, styles.variantText, closed === shut ? styles.variantOn : ''].join(' ')}
                onClick={() => keep({closed: shut ? true : null})}
              >
                {shut ? tr('Folded') : tr('Opened up')}
              </button>
            ))}
          </div>
        </div>
      )}
      {turnable && (
        <div className={styles.lookRow}>
          <span className={[styles.dim, styles.variantLabel].join(' ')}>{pic.turn ? tr('Direction') : tr('Rotation')}</span>
          <div className={styles.variantList}>
            <button
              role="switch"
              aria-checked={ownTurn === undefined}
              className={[styles.variantButton, styles.variantText, ownTurn === undefined ? styles.variantOn : ''].join(' ')}
              onClick={() => setTurn(undefined)}
            >
              {tr('auto')}
            </button>
            <Stepper
              label={pic.turn ? tr('Direction') : tr('Rotation')}
              text={pic.turn ? tr(compass(ownTurn ?? autoTurn)) : `${ownTurn ?? autoTurn}°`}
              dim={ownTurn === undefined}
              onStep={stepTurn}
            />
          </div>
        </div>
      )}
      {picking && (
        <LookPicker
          value={picked}
          auto={areaLook(area)}
          onPick={(look) => {
            setLook(look);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {showTools && (
        <div className={styles.toolbar}>
          <span className={styles.toolLabel}>
            {tr('Edit')}
            <InfoTip>
              <b>{tr('Split area')}:</b>{' '}
              {tr('Cuts the area in two along a line, or cuts a shape out of it. All parts keep type and settings.')}
              <br />
              <b>{tr('Merge')}:</b>{' '}
              {tr('Joins this area with another one you click. They need to overlap or touch.')}
              <br />
              <b>{tr('Take out')}:</b>{' '}
              {tr('Cuts another area you click out of this one, e.g. a path lying over the lawn. The other one stays as it is.')}
              <br />
              <b>{tr('Lay against')}:</b>{' '}
              {tr('Moves the corners of this area that lie close to another one you click onto its edge, so the two meet without a gap. A mowing area stays as it is, unless both are.')}
              <br />
              <b>{tr('Reduce points')}:</b>{' '}
              {tr('Recorded outlines have a point every few cm. This removes the ones that barely change the shape, the slider sets how far the outline may move.')}
            </InfoTip>
          </span>
          <button className={tool} onClick={onSplit}>
            <ScissorsIcon size={16} />
            {tr('Split area')}
          </button>
          <button className={tool} onClick={onMerge}>
            <MergeIcon size={16} />
            {tr('Merge')}
          </button>
          <button className={tool} onClick={onSubtract}>
            <SubtractIcon size={16} />
            {tr('Take out')}
          </button>
          <button className={tool} onClick={onSnap}>
            <MagnetIcon size={16} />
            {tr('Lay against')}
          </button>
          <button className={tool} onClick={onSimplify}>
            <SimplifyIcon size={16} />
            {tr('Reduce points')}
          </button>
          <button className={[tool, styles.danger].join(' ')} onClick={onDelete} onBlur={onDeleteBlur}>
            <TrashIcon size={16} />
            {confirmDelete ? tr('Really delete?') : tr('Delete area')}
          </button>
        </div>
      )}
    </div>
  );
}

// a value set a step at a time with - and +, held down it goes on, faster and faster. no slider: a finger scrolling the
// card over one moved it. a tap steps once, a finger that scrolls on is no tap (the browser takes it over)
function Stepper({label, text, dim, onStep}: {label: string; text: string; dim: boolean; onStep: (dir: 1 | -1) => void}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const button = (dir: 1 | -1) => (
    <button
      className={[styles.variantButton, styles.variantText, styles.stepButton].join(' ')}
      aria-label={dir > 0 ? tr('More') : tr('Less')}
      onPointerDown={() => {
        held.current = false;
        stop();
        let wait = 450;
        const again = () => {
          held.current = true;
          onStep(dir);
          wait = Math.max(60, wait * 0.75);
          timer.current = setTimeout(again, wait);
        };
        timer.current = setTimeout(again, wait);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={() => {
        if (!held.current) onStep(dir);
        held.current = false;
      }}
    >
      {dir > 0 ? '+' : '−'}
    </button>
  );
  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      {button(-1)}
      <span className={[styles.sizeValue, dim ? styles.dim : ''].join(' ')} aria-live="polite">
        {text}
      </span>
      {button(1)}
    </div>
  );
}
