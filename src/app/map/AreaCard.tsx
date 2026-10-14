import {MergeIcon, ScissorsIcon, SimplifyIcon, TrashIcon} from '@/components/icons';
import InfoTip from '@/components/InfoTip';
import {polygonArea} from '@/lib/geometry';
import {fmt, tr} from '@/lib/i18n';
import {useAreaProperties} from '@/lib/areaProps';
import {usePlannerSettings} from '@/lib/mowerBody';
import {useState} from 'react';
import {AREA_TYPES, type Area, type UpdateArea} from './editing';
import styles from './page.module.css';

// name, type and active switch of the selected area, and what can be done with it
export default function AreaCard({
  area,
  showTools,
  confirmDelete,
  remember,
  update,
  onSplit,
  onMerge,
  onSimplify,
  onDelete,
  onDeleteBlur,
}: {
  area: Area;
  showTools: boolean;
  confirmDelete: boolean;
  remember: () => void;
  update: UpdateArea;
  onSplit: () => void;
  onMerge: () => void;
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
  const marginShown = !!keepOff && (type === 'obstacle' || area.properties.active === false || area.properties.mowable === false);
  const [marginDraft, setMarginDraft] = useState<string | null>(null);
  const marginCm = typeof area.properties.margin === 'number' ? String(Math.round(area.properties.margin * 1000) / 10) : '';
  const defaultCm = typeof keepOff?.value === 'number' ? String(Math.round(keepOff.value * 1000) / 10) : '';
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
            {tr('Ignored by the mower and not drivable. Careful: if the mower stands on an inactive area, it gets stuck.')}
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
            {tr('Own distance')}
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
              {tr('How far the mower keeps its body off this one. Empty: the distance to obstacles of the planner ({cm} cm). It counts once the map is saved.', {
                cm: defaultCm,
              })}
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
          {area.properties.active === false
            ? tr('inactive: not driven on and not mowed')
            : type === 'mow' && area.properties.mowable === false
              ? tr('driven on, but not mowed')
              : tr(AREA_TYPES.find((t) => t.value === type)?.hint ?? '')}
          {' · '}
          {fmt(polygonArea(area.outline), 1)} m²
        </span>
      </div>
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
