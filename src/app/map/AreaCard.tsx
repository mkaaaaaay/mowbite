import {areaLook, facing, LookPicker, LookSwatch, placeThing, type Look} from '@/components/gardenLook';
import {PICTURES} from '@/components/gardenPictures';
import {MagnetIcon, MergeIcon, ScissorsIcon, SimplifyIcon, SubtractIcon, TrashIcon} from '@/components/icons';
import InfoTip from '@/components/InfoTip';
import {polygonArea} from '@/lib/geometry';
import {fmt, tr} from '@/lib/i18n';
import {useAreaProperties} from '@/lib/areaProps';
import {realInsides, useMowerBody, usePlannerSettings} from '@/lib/mowerBody';
import {settingsStore} from '@/lib/settings';
import {useMemo, useState, useSyncExternalStore} from 'react';
import {AREA_TYPES, type Area, type UpdateArea} from './editing';
import PictureRows, {keepLook} from './PictureRows';
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
  // the color picked for it, its swatch shows it
  const variant = PICTURES[shown]?.variants?.some((v) => v.key === settings.lookVariants?.[area.id]) ? settings.lookVariants?.[area.id] : undefined;
  // another picture starts with its own usual color, size and direction
  const setLook = (look: Look | undefined) => keepLook(area.id, {look: look ?? null, variant: null, size: null, turn: null, closed: null});
  // how big a picture standing in the area is drawn without a size of its own: by the area and its usual size
  const pic = PICTURES[shown];
  const sizable = pictured && !!pic?.thing && !pic.fill;
  // where the map places it: in the real edge once the mower's sizes are known (gardenThings)
  const body = useMowerBody();
  const inside = useMemo(() => (sizable && body ? realInsides(areas, body).get(area.id) : null) ?? area.outline, [sizable, body, areas, area]);
  const fitted = useMemo(() => (sizable && inside.length > 2 ? placeThing(shown, inside) : null), [sizable, shown, inside]);
  const autoSize = (() => {
    if (!fitted) return 1;
    const [lo, hi] = pic.size ?? [fitted.w, fitted.w];
    if (pic.over) return Math.min(Math.max(fitted.w, lo), hi);
    if (pic.many) return Math.min(Math.max((lo + Math.min(hi, fitted.w)) / 2, lo), hi);
    return Math.min(fitted.w, hi);
  })();
  // which way it lies by itself: along the area, a parasol towards the seats next to it or into the lawn like the map
  // draws it
  const faces = sizable && !pic.round && !!pic.turn;
  // the map's y points up, the drawing's down
  const faced = useMemo(
    () => (faces && area.outline.length > 2 ? facing(area, areas, settings.looks, (p) => ({x: p.x, y: -p.y})) : null),
    [faces, areas, area, settings.looks],
  );
  const autoDeg = faced ?? (fitted && pic.long ? -fitted.deg : 0);
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
      {pictured && <PictureRows id={area.id} look={shown} autoSize={autoSize} autoDeg={autoDeg} grounded={!!pic?.thing} />}
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
