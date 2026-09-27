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
  showStripes,
  onToggleStripes,
  toolWidth,
  mismatch,
  previewCorrection,
  onPreviewCorrection,
  angle,
}: {
  area: Area;
  autoAngle: number;
  // placeholder for an empty field, e.g. "global 2"
  globalValue: (key: Override) => string;
  remember: () => void;
  update: UpdateArea;
  showStripes: boolean;
  onToggleStripes: () => void;
  toolWidth: number | undefined;
  mismatch: AngleMismatch | null;
  previewCorrection: number;
  onPreviewCorrection: (deg: number) => void;
  angle: AngleParams;
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
            {tr("Direction of the stripes, 0° is east, counter-clockwise. Empty means auto: the direction from the first outline point to the first one more than 2 m away. The mower adds its mow_angle_offset on top.")}
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
        <AngleSlider area={area} autoAngle={autoAngle} remember={remember} update={update} />
        <button className={styles.pillButton} disabled={p.angle === undefined} onClick={() => update({angle: undefined})}>
          {tr('Auto')}
        </button>
      </div>
      <label className={styles.toggle}>
        <input type="checkbox" checked={showStripes} onChange={onToggleStripes} />
        {tr('show mowing plan')}
        {toolWidth ? ` (${tr('{n} cm apart', {n: Math.round(toolWidth * 100)})})` : ''}
        <InfoTip>
          {tr("Where the mower will drive, worked out the way its planner does it: the rounds along the edge and around obstacles, then the stripes inside, one mower width apart. Close to the real plan, but not to the centimeter.")}
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

export function AngleSlider({
  area,
  autoAngle,
  remember,
  update,
}: {
  area: Area;
  autoAngle: number;
  remember: () => void;
  update: UpdateArea;
}) {
  return (
    <input
      type="range"
      min={-180}
      max={180}
      step={1}
      value={Math.round((area.properties.angle ?? autoAngle) / DEG)}
      onPointerDown={remember}
      onChange={(e) => update({angle: Number(e.target.value) * DEG}, false)}
      aria-label={tr('Mow angle (°)')}
    />
  );
}

// on phones the settings are far below the map, so the angle can be turned right on it while watching the stripes
export function AngleOnMap(props: {area: Area; autoAngle: number; remember: () => void; update: UpdateArea}) {
  return (
    <div className={styles.angleOnMap}>
      <span>{tr('Mow angle')}</span>
      <AngleSlider {...props} />
      <strong>{Math.round((props.area.properties.angle ?? props.autoAngle) / DEG)}°</strong>
    </div>
  );
}
