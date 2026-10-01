import InfoTip from '@/components/InfoTip';
import {useAreaProperties} from '@/lib/areaProps';
import {tr} from '@/lib/i18n';
import {useState} from 'react';
import {duration} from '@/lib/dates';
import {savedRate} from '@/lib/planProgress';
import {DEG, normDeg, overrideError, type Area, type Override, type UpdateArea} from './editing';
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

// a per area override, empty = the mower's global value. a value that isn't valid stays in the field with the
// reason below it and isn't taken, leaving the field puts the last valid one back
function OverrideField({
  name,
  value,
  placeholder,
  step,
  min,
  onFocus,
  onChange,
}: {
  name: Override;
  value: number | undefined;
  placeholder: string;
  step: number;
  min?: number;
  onFocus: () => void;
  onChange: (v: number | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (value === undefined ? '' : String(value));
  const error = overrideError(name, text);
  return (
    <>
      <input
        type="number"
        min={min}
        step={step}
        value={text}
        placeholder={placeholder}
        aria-invalid={!!error}
        className={error ? styles.invalid : undefined}
        onFocus={onFocus}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value);
          // half typed, e.g. just a minus: the browser reports it as empty
          if (e.target.validity.badInput || overrideError(name, e.target.value)) return;
          onChange(e.target.value.trim() === '' ? undefined : Number(e.target.value));
        }}
      />
      {error && <span className={styles.fieldError}>{error}</span>}
    </>
  );
}

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
  planAngle,
  planLength,
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
  // rad, the angle the mower said it would mow at
  planAngle?: number;
  // m, the passes and stripes of the plan shown
  planLength: number;
}) {
  const supported = useAreaProperties();
  const rate = savedRate();
  const p = area.properties;
  const number = (key: Override, label: string, tip: string, step: number, min?: number) => (
    <label>
      <span>
        {tr(label)}
        <InfoTip>{tr(tip)}</InfoTip>
      </span>
      <OverrideField
        key={area.id}
        name={key}
        value={p[key]}
        placeholder={globalValue(key)}
        step={step}
        min={min}
        onFocus={remember}
        onChange={(v) => update({[key]: v}, false)}
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
            {tr('Direction of the stripes, counter-clockwise: 0° runs east to west, 90° north to south, 0° and 180° give the same stripes. Empty = automatic: along the outline from its first point, for a recorded area the way you set off. The mower adds its mow_angle_offset.')}
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
      {supported.has('angle_min') &&
        (['angle_min', 'angle_max'] as const).map((key) => (
        <label key={key}>
          <span>
            {tr(key === 'angle_min' ? 'Min. angle (°)' : 'Max. angle (°)')}
            <InfoTip>
              {tr('Keeps the stripes between these two directions, 0° and 180° give the same stripes. When the mower turns the angle further after every full mow (mow_angle_increment), it turns back at the ends. Handy for narrow areas. Same value twice = fixed angle, min above max = range across 180°.')}
            </InfoTip>
          </span>
          <input
            type="number"
            step={1}
            min={-180}
            max={180}
            value={p[key] !== undefined ? Math.round(p[key] / DEG) : ''}
            placeholder={tr('none')}
            onFocus={remember}
            onChange={(e) =>
              update({[key]: e.target.value.trim() === '' ? undefined : normDeg(Number(e.target.value)) * DEG}, false)
            }
          />
        </label>
      ))}
      {area.properties.mowable === false ? (
        <p className={styles.dim}>{tr("No mowing plan, this area is set to don't mow.")}</p>
      ) : (
        <label className={styles.toggle}>
          <input type="checkbox" checked={showStripes} onChange={onToggleStripes} />
          {tr('show mowing plan')}
          {toolWidth ? ` (${tr('{n} cm apart', {n: Math.round(toolWidth * 100)})})` : ''}
          {' · '}
          {planFromMower ? tr('from the mower') : tr('estimate')}
          {planFromMower && planAngle !== undefined && `, ${Math.round((((planAngle * 180) / Math.PI) % 180 + 180) % 180)}°`}
          <InfoTip>
            {planFromMower
              ? tr('The plan as the mower calculates it, unsaved changes included, at the angle it really mows.')
              : tr('Estimate of where the mower drives: edge rounds first, then stripes one mower width apart. Can differ from the real plan on unusual shapes.')}
          </InfoTip>
        </label>
      )}
      {showStripes && planLength > 0 && (
        <p className={styles.dim}>
          {tr('{m} m to mow', {m: Math.round(planLength)})}
          {rate && ` · ${tr('about {time}', {time: duration(planLength / rate)})}`}
          <InfoTip>
            {tr('Length of all passes and stripes. The time is based on the last run you watched on the dashboard.')}
          </InfoTip>
        </p>
      )}
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

// 0 and 180 degrees give the same stripes, so the slider only needs half a turn and is twice as fine.
// 0 and 180 are both kept as they are, otherwise the slider jumps to the other end at the right edge
const halfTurn = (deg: number) => (deg >= -0.5 && deg <= 180.5 ? deg : ((deg % 180) + 180) % 180);
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
      min={0}
      max={180}
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
