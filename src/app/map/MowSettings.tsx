import InfoTip from '@/components/InfoTip';
import {tr} from '@/lib/i18n';
import {DEG, normDeg, type Area, type UpdateArea} from './editing';
import styles from './page.module.css';
import {PATHS} from '@/lib/openmower';

export interface AngleMismatch {
  measured: number;
  planned: number;
  diff: number;
  date: string;
  since: number; // unix seconds, when that mow started
}

// what the mower's own parameters do to the angle, shown so the preview makes sense
export interface AngleParams {
  offset: number;
  offsetIsAbsolute: boolean;
  increment: number;
}

type Override = 'outline_count' | 'outline_overlap_count' | 'outline_offset';

// the per-area overrides of the mowing settings, with the angle preview switch
export default function MowSettings({
  area,
  autoAngle,
  globalValue,
  remember,
  update,
  onAngleEdit,
  showStripes,
  onToggleStripes,
  toolWidth,
  mismatch,
  previewCorrection,
  onPreviewCorrection,
  angle,
  planFromMower,
}: {
  area: Area;
  autoAngle: number;
  // placeholder for an empty field, e.g. "global 2"
  globalValue: (key: Override) => string;
  remember: () => void;
  update: UpdateArea;
  onAngleEdit?: () => void;
  showStripes: boolean;
  onToggleStripes: () => void;
  toolWidth: number | undefined;
  mismatch: AngleMismatch | null;
  previewCorrection: number;
  onPreviewCorrection: (deg: number) => void;
  angle: AngleParams;
  // the plan shown comes from the mower itself, not worked out here
  planFromMower: boolean;
}) {
  const p = area.properties;
  const setOverride = (key: Override, raw: string) => {
    const v = raw.trim() === '' ? undefined : Number(raw);
    if (v !== undefined && !Number.isFinite(v)) return;
    update({[key]: v}, false);
  };
  const number = (key: Override, label: string, tip: string, step: number, min?: number) => (
    <label>
      <span>
        {tr(label)}
        <InfoTip>{tr(tip)}</InfoTip>
      </span>
      <input
        type="number"
        min={min}
        step={step}
        value={p[key] ?? ''}
        placeholder={globalValue(key)}
        onFocus={remember}
        onChange={(e) => setOverride(key, e.target.value)}
      />
    </label>
  );

  return (
    <div className={styles.mowSettings}>
      <span className={styles.cardTitle}>{tr('Mowing settings')}</span>
      {number(
        'outline_count',
        'Outline passes',
        "How many rounds the mower drives along the edge before it mows the inside in stripes. Empty means the mower's global setting.",
        1,
        0,
      )}
      {number(
        'outline_overlap_count',
        'Overlapping passes',
        'How many of the edge rounds the stripes reach into, so no uncut strip is left between the edge and the stripes.',
        1,
        0,
      )}
      {number(
        'outline_offset',
        'Outline offset (m)',
        'Moves the mowing boundary in (positive, more distance to beds and walls) or out (negative). -1 to 1 m.',
        0.05,
      )}
      <label>
        <span>
          {tr('Mow angle (°)')}
          <InfoTip>
            {tr('Stripe direction, 0° = east, counter-clockwise. Empty = automatic. The mower adds its mow_angle_offset.')}
          </InfoTip>
        </span>
        <input
          type="number"
          step={1}
          min={-180}
          max={180}
          value={p.angle !== undefined ? Math.round(p.angle / DEG) : ''}
          placeholder={tr('auto {n}', {n: Math.round(autoAngle / DEG)})}
          onFocus={remember}
          onChange={(e) =>
            update({angle: e.target.value.trim() === '' ? undefined : normDeg(Number(e.target.value)) * DEG}, false)
          }
        />
      </label>
      <div className={styles.angleRow}>
        <AngleStep area={area} autoAngle={autoAngle} remember={remember} update={update} onEdit={onAngleEdit} by={-1} />
        <AngleSlider area={area} autoAngle={autoAngle} remember={remember} update={update} onEdit={onAngleEdit} />
        <AngleStep area={area} autoAngle={autoAngle} remember={remember} update={update} onEdit={onAngleEdit} by={1} />
        <button className={styles.pillButton} disabled={p.angle === undefined} onClick={() => update({angle: undefined})}>
          {tr('Auto')}
        </button>
      </div>
      <label className={styles.toggle}>
        <input type="checkbox" checked={showStripes} onChange={onToggleStripes} />
        {tr('show mowing plan')}
        {toolWidth ? ` (${tr('{n} cm apart', {n: Math.round(toolWidth * 100)})})` : ''}
        {' · '}
        {planFromMower ? tr('from the mower') : tr('estimate')}
        <InfoTip>
          {planFromMower
            ? tr('The plan as the mower itself works it out for the saved map.')
            : tr('Estimate of where the mower drives: edge rounds first, then stripes one mower width apart. Can differ from the real plan on unusual shapes.')}
        </InfoTip>
      </label>
      {mismatch && (
        <div className={styles.warning}>
          <p>
            {tr("The last mow here ({date}) ran at about {measured}°, but with the saved settings it should be {planned}° ({diff}°).", {
              date: mismatch.date,
              measured: Math.round(mismatch.measured),
              planned: Math.round(mismatch.planned),
              diff: (mismatch.diff > 0 ? '+' : '') + Math.round(mismatch.diff),
            })}
          </p>
          <p>
            {tr("If you changed the angle since then, ignore this. Otherwise the mower most likely still has an angle increment summed up in checkpoint.bag from a time when mow_angle_increment was set. It adds that on top and never shows it anywhere. To get rid of it, while the mower is docked and idle: delete")}{' '}
            <code>{PATHS.checkpoint}</code> {tr("on the mower and run")} <code>{PATHS.restart}</code>.
          </p>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={previewCorrection !== 0}
              onChange={() => onPreviewCorrection(previewCorrection ? 0 : Math.round(mismatch.diff))}
            />
            {tr('turn the preview by {n}° to match', {n: Math.round(mismatch.diff)})}
          </label>
        </div>
      )}
      {(angle.offset !== 0 || angle.offsetIsAbsolute || angle.increment !== 0) && (
        <p className={styles.dim}>
          {angle.offsetIsAbsolute
            ? tr('mow_angle_offset_is_absolute is set on the mower, it always mows at {n}° and ignores this angle.', {n: angle.offset})
            : angle.offset !== 0
              ? tr('The mower adds its mow_angle_offset of {n}°, the preview includes it.', {n: angle.offset})
              : ''}
          {angle.increment !== 0 &&
            ' ' + tr('It also turns by {n}° after every full mow, the preview shows the first one.', {n: angle.increment})}
        </p>
      )}
    </div>
  );
}

// 0 and 180 degrees give the same stripes, so the slider only needs half a turn and is twice as fine
const halfTurn = (deg: number) => ((((deg + 90) % 180) + 180) % 180) - 90;
export const shownAngle = (area: Area, autoAngle: number) => Math.round(halfTurn((area.properties.angle ?? autoAngle) / DEG));

export function AngleSlider({
  area,
  autoAngle,
  remember,
  update,
  onEdit,
}: {
  area: Area;
  autoAngle: number;
  remember: () => void;
  update: UpdateArea;
  // while the angle is being changed, e.g. to show the stripes for a moment
  onEdit?: () => void;
}) {
  return (
    <input
      type="range"
      min={-90}
      max={90}
      step={1}
      value={shownAngle(area, autoAngle)}
      onPointerDown={() => {
        remember();
        onEdit?.();
      }}
      // arrow keys and co. change it without a pointer, one undo step per press then
      onKeyDown={(e) => /^(Arrow|Page|Home|End)/.test(e.key) && remember()}
      onChange={(e) => {
        update({angle: Number(e.target.value) * DEG}, false);
        onEdit?.();
      }}
      aria-label={tr('Mow angle (°)')}
    />
  );
}

// one degree at a time, the slider is hard to hit exactly on a phone
function AngleStep({area, autoAngle, remember, update, onEdit, by}: Parameters<typeof AngleSlider>[0] & {by: number}) {
  return (
    <button
      className={styles.angleStep}
      onClick={() => {
        remember();
        update({angle: halfTurn(shownAngle(area, autoAngle) + by) * DEG}, false);
        onEdit?.();
      }}
      aria-label={by > 0 ? '+1°' : '-1°'}
    >
      {by > 0 ? '+' : '−'}
    </button>
  );
}

// on phones the settings are far below the map, so the angle can be turned right on it while watching the stripes
export function AngleOnMap(props: {area: Area; autoAngle: number; remember: () => void; update: UpdateArea; onEdit?: () => void}) {
  return (
    <div className={styles.angleOnMap}>
      <span>{tr('Mow angle')}</span>
      <AngleStep {...props} by={-1} />
      <AngleSlider {...props} />
      <AngleStep {...props} by={1} />
      <strong>{shownAngle(props.area, props.autoAngle)}°</strong>
    </div>
  );
}
