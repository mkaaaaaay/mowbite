import {MergeIcon, ScissorsIcon, SimplifyIcon, TrashIcon} from '@/components/icons';
import InfoTip from '@/components/InfoTip';
import {tr} from '@/lib/i18n';
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
  const tool = [styles.pillButton, styles.tool].join(' ');
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
            {tr("Inactive areas are ignored by the mower. Careful with mowing areas: an inactive one is also no longer drivable, so the mower gets stuck if it stands on it.")}
          </InfoTip>
        </label>
        {type === 'mow' && area.properties.active !== false && (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={!!area.properties.skip_mowing}
              onChange={() => update({skip_mowing: area.properties.skip_mowing ? undefined : true})}
            />
            {tr("don't mow")}
            <InfoTip>
              {tr("Left out when mowing, but the mower can still drive across it, unlike an inactive area. Needs an OpenMower version that knows it.")}
            </InfoTip>
          </label>
        )}
        <span className={styles.dim}>
          {area.properties.active === false
            ? tr('inactive, the mower ignores it')
            : type === 'mow' && area.properties.skip_mowing
              ? tr('driven on, but left out when mowing')
              : tr(AREA_TYPES.find((t) => t.value === type)?.hint ?? '')}
          {' · '}
          {tr('{n} points', {n: area.outline.length})}
        </span>
      </div>
      {showTools && (
        <div className={styles.toolbar}>
          <span className={styles.toolLabel}>
            {tr('Edit')}
            <InfoTip>
              <b>{tr('Split zone')}:</b>{' '}
              {tr("Cuts the area in two along a line through two points you click. Both halves keep the type and settings.")}
              <br />
              <b>{tr('Merge')}:</b>{' '}
              {tr("Joins this area with another one you click, e.g. two halves of a lawn. They need to overlap or touch.")}
              <br />
              <b>{tr('Reduce points')}:</b>{' '}
              {tr("Recorded outlines have a point every few cm. This drops the ones that hardly change the shape, you pick how far the new outline may be off. You can go back up with the slider until you reload the page.")}
            </InfoTip>
          </span>
          <button className={tool} onClick={onSplit}>
            <ScissorsIcon size={16} />
            {tr('Split zone')}
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
