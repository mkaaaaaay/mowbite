import InfoTip from '@/components/InfoTip';
import {useCanSetParams} from '@/components/MowerParamSettings';
import Link from 'next/link';
import {useAreaProperties} from '@/lib/areaProps';
import {slic3rPlans, usePlannerSettings} from '@/lib/mowerBody';
import {FIELDS} from '@/lib/plannerFields';
import simple from '@/components/PlannerSimple.module.css';
import {tr} from '@/lib/i18n';
import {useState} from 'react';
import {duration} from '@/lib/dates';
import {savedRate} from '@/lib/planProgress';
import type {PlanChosen, PlanDuration} from '@/lib/mowPlan';
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

type Props = {
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
  // what the MowBite Planner plans the area with (the lane spacing it picked, the outline passes)
  planChosen?: PlanChosen;
  // how long it says the plan takes, and the parts it gave a direction of their own
  planDuration?: PlanDuration;
  planZones?: number;
  // the MowBite Planner is on the mower: the outline passes are set in its menu, not here
  byPlanner?: boolean;
  // the plan with what it was made from as a file
  onSaveCase?: () => Promise<void>;
};

// without the MowBite Planner: the per-area overrides of OpenMower's mowing settings, the angle and the plan
export default function MowSettings(props: Props) {
  const canSetParams = useCanSetParams();
  return (
    <div className={styles.mowSettings}>
      <p className={styles.dim}>
        {tr('Only for this area, saved with the map ("Save map").')}
        {canSetParams && (
          <Link className={styles.allAreas} href="/settings#openmower">
            {tr('For all areas')}
          </Link>
        )}
      </p>
      {!props.byPlanner && <OpenMowerArea {...props} />}
      <AreaDirection {...props} />
      <AreaPlanInfo {...props} />
    </div>
  );
}

// the per-area overrides of OpenMower's mowing settings: without the MowBite Planner, or with OpenMower's slic3r planner
// switched on in it
export function OpenMowerArea({area, globalValue, remember, update, inMenu}: Props & {inMenu?: boolean}) {
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
    <div className={inMenu ? styles.openMowerMenu : styles.openMowerArea}>
      {number(
        'outline_count',
        'Outline passes',
        "How many rounds the mower drives along the edge before it mows the inside in stripes. Empty: like all areas.",
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
    </div>
  );
}

// the direction of an area's lanes: its angle, with the MowBite Planner also the range, turning further and, while it
// has no angle, its own way of working the direction out. With the planner this is in its menu (Direction)
export function AreaDirection({area, autoAngle, remember, update, onAngleEdit, angle}: Props) {
  const supported = useAreaProperties();
  const p = area.properties;
  // with the MowBite Planner: the range (it keeps it, whatever the map service says) and turning further after mows,
  // the area's own step or the one for all areas
  // (not with OpenMower's slic3r planner switched on: the range then only where OpenMower keeps it itself)
  const plannerSettings = usePlannerSettings();
  const planner = slic3rPlans(plannerSettings) ? null : plannerSettings;
  const ranged = supported.has('angle_min') || !!planner;
  const turning = !!planner?.settings.angle_increment?.settable;
  const allStep = typeof planner?.settings.angle_increment?.value === 'number' ? (planner.settings.angle_increment.value as number) : 0;
  const ownStep = typeof p.planner?.angle_increment === 'number' ? (p.planner.angle_increment as number) : undefined;
  const setStep = (deg: number | undefined) => {
    const own = {...(p.planner ?? {})};
    if (deg === undefined) delete own.angle_increment;
    else own.angle_increment = Math.min(180, Math.max(0, deg)) * DEG;
    update({planner: Object.keys(own).length ? own : undefined}, false);
  };
  const tenth = (rad: number) => Math.round((rad / DEG) * 10) / 10;

  // the area's own way of working the direction out (the planner takes it before the angle), offered while it has none
  const strategies = planner?.settings.angle_strategy;
  const ownStrategy = typeof p.planner?.angle_strategy === 'string' ? (p.planner.angle_strategy as string) : undefined;
  const strategyName = (k: string) => tr(FIELDS.angle_strategy.choices?.[k] ?? k);
  const allStrategy = strategies?.stored && typeof strategies.value === 'string' ? strategyName(strategies.value) : tr('OpenMower');
  const setStrategy = (k: string | undefined) => {
    const own = {...(p.planner ?? {})};
    if (k === undefined) delete own.angle_strategy;
    else own.angle_strategy = k;
    update({planner: Object.keys(own).length ? own : undefined}, false);
  };

  return (
    <div className={styles.areaDirection}>
      <label className={styles.dirRow}>
        <span className={styles.dirLabel}>
          {tr('Mow angle (°)')}
          <InfoTip>
            {tr("Direction of the stripes, counted counter-clockwise like on a map: 0° = east, 90° = north, 180° = west, 270° (or -90°) = south. 0° and 180° give the same lanes, the mower only starts them from the other side. Empty = automatic: the direction from the outline's first point to the first one more than 2 m away, for a recorded area the way you set off.")}
          </InfoTip>
        </span>
        <AngleField key={area.id} angle={p.angle} autoAngle={autoAngle} onFocus={remember} update={update} />
      </label>
      <div className={styles.angleRow}>
        <AngleCompass rad={p.angle ?? autoAngle} />
        <AngleStep area={area} autoAngle={autoAngle} remember={remember} update={update} onEdit={onAngleEdit} by={-1} />
        <AngleSlider area={area} autoAngle={autoAngle} remember={remember} update={update} onEdit={onAngleEdit} />
        <AngleStep area={area} autoAngle={autoAngle} remember={remember} update={update} onEdit={onAngleEdit} by={1} />
        <button className={styles.pillButton} disabled={p.angle === undefined} onClick={() => update({angle: undefined})}>
          {tr('Auto')}
        </button>
      </div>
      {ranged && (
        <div className={styles.dirRow}>
          <span className={styles.dirLabel}>
            {tr('Direction range (°)')}
            <InfoTip>
              {tr('Keeps the stripes between these two directions, 0° and 180° give the same lanes (only started from the other side). When the angle turns further after mows, it turns back at the ends. Handy for narrow areas. Same value twice = fixed angle, min above max = range across 180°.')}
            </InfoTip>
          </span>
          <div className={styles.dirPair}>
            {(['angle_min', 'angle_max'] as const).map((key) => (
              <label key={key} className={styles.dirPairField}>
                {tr(key === 'angle_min' ? 'from' : 'to')}
                <input
                  type="number"
                  step={1}
                  min={-180}
                  max={180}
                  value={p[key] !== undefined ? Math.round(p[key] / DEG) : ''}
                  placeholder={tr('none')}
                  aria-label={tr(key === 'angle_min' ? 'Min. angle (°)' : 'Max. angle (°)')}
                  onFocus={remember}
                  onChange={(e) =>
                    update({[key]: e.target.value.trim() === '' ? undefined : normDeg(Number(e.target.value)) * DEG}, false)
                  }
                />
              </label>
            ))}
          </div>
          <p className={styles.dirNote}>
            {p.angle_min !== undefined && p.angle_max !== undefined
              ? tr('The stripes stay between these directions.')
              : tr('Empty: no range, turning further goes round all 180°.')}
          </p>
        </div>
      )}
      {turning && (
        <label className={styles.dirRow}>
          <span className={styles.dirLabel}>
            {tr('Turn further (°)')}
            <InfoTip>
              {tr(
                "After finished mows the stripes turn this much further, so the wheels don't wear tracks into the lawn. Within the range above they swing back and forth. Empty: like all areas, how often is set there (planner for all areas).",
              )}
            </InfoTip>
          </span>
          <input
            key={area.id}
            className={styles.dirWide}
            type="number"
            step={1}
            min={0}
            max={180}
            value={ownStep !== undefined ? tenth(ownStep) : ''}
            placeholder={allStep ? tr('like all areas: {deg}°', {deg: tenth(allStep)}) : tr('like all areas: off')}
            onFocus={remember}
            onChange={(e) => setStep(e.target.value.trim() === '' ? undefined : Number(e.target.value))}
          />
        </label>
      )}
      {strategies?.settable && (p.angle === undefined || ownStrategy !== undefined) && (
        <div className={styles.dirRow}>
          <span className={styles.dirLabel}>
            {tr('Automatic direction')}
            <InfoTip>{tr(FIELDS.angle_strategy.help)}</InfoTip>
          </span>
          <div className={simple.segment}>
            <button className={ownStrategy === undefined ? simple.on : undefined} onClick={() => setStrategy(undefined)}>
              {tr('as all ({value})', {value: allStrategy})}
            </button>
            {(strategies.choices ?? []).map((k) => (
              <button key={k} className={ownStrategy === k ? simple.on : undefined} onClick={() => setStrategy(k)}>
                {strategyName(k)}
              </button>
            ))}
          </div>
          {p.angle !== undefined && ownStrategy !== undefined ? (
            <p className={styles.dirNote}>
              {tr('This area has a mow angle and a way of working the direction out of its own, the planner takes the way of working it out.')}{' '}
              <button className={simple.link} onClick={() => setStrategy(undefined)}>
                {tr('take the mow angle')}
              </button>
            </p>
          ) : (
            <p className={styles.dirNote}>{tr('While the mow angle is on Auto.')}</p>
          )}
        </div>
      )}
      {(angle.offset !== 0 || angle.offsetIsAbsolute || angle.increment !== 0) && (
        <p className={styles.dim}>
          {angle.offsetIsAbsolute
            ? tr('mow_angle_offset_is_absolute is set on the mower, it always mows at {n}° and ignores this angle.', {n: angle.offset})
            : angle.offset !== 0
              ? tr("On top comes mow_angle_offset from the mower's settings (mower_logic), {n}° here. It's added to every area, the preview includes it.", {n: angle.offset})
              : ''}
          {angle.increment !== 0 &&
            ' ' + tr('It also turns by {n}° after every full mow, the preview shows the first one.', {n: angle.increment})}
        </p>
      )}
    </div>
  );
}

// an area's plan: shown on the map or not, how long, and a hint when the last mow there ran at another angle
export function AreaPlanInfo({
  area,
  showStripes,
  onToggleStripes,
  toolWidth,
  mismatch,
  previewCorrection,
  onPreviewCorrection,
  planFromMower,
  planAngle,
  planLength,
  planChosen,
  planDuration,
  planZones,
  onSaveCase,
}: Props) {
  const rate = savedRate();
  const plannerSettings = usePlannerSettings();
  const slic3r = slic3rPlans(plannerSettings);
  return (
    <div className={styles.areaPlan}>
      {area.properties.active === false ? (
        <p className={styles.dim}>{tr('No mowing plan, this area is inactive.')}</p>
      ) : area.properties.mowable === false ? (
        <p className={styles.dim}>{tr("No mowing plan, this area is set to don't mow.")}</p>
      ) : (
        <label className={[styles.toggle, styles.toggleLong].join(' ')}>
          <input type="checkbox" checked={showStripes} onChange={onToggleStripes} />
          <span>
            {tr('show mowing plan')}
            {planChosen
              ? ` (${tr('{n} cm apart', {n: Math.round(planChosen.lane_spacing * 1000) / 10})}${
                  planChosen.mode === 'auto' ? `, ${tr('picked by the planner')}` : ''
                }, ${tr('{n} outline passes', {n: planChosen.perimeter_passes})}${
                  planChosen.fill_pattern === 'concentric' ? `, ${tr('rings')}` : ''
                }${planZones ? `, ${tr('{n} parts with their own direction', {n: planZones})}` : ''})`
              : toolWidth
                ? ` (${tr('{n} cm apart', {n: Math.round(toolWidth * 100)})})`
                : ''}
            {' · '}
            {planFromMower ? (slic3r ? tr('from the mower, slic3r') : tr('from the mower')) : tr('estimate')}
            {planFromMower && planAngle !== undefined && `, ${Math.round((((planAngle * 180) / Math.PI) % 180 + 180) % 180)}°`}
            <InfoTip>
              {planFromMower
                ? tr('The plan as the mower calculates it, unsaved changes included, at the angle it really mows.')
                : tr('Estimate of where the mower drives: edge rounds first, then stripes one mower width apart. Can differ from the real plan on unusual shapes.')}
            </InfoTip>
          </span>
        </label>
      )}
      {showStripes && planLength > 0 && (
        <p className={styles.dim}>
          {tr('{m} m to mow', {m: Math.round(planLength)})}
          {planDuration
            ? ` · ${tr('about {time}', {time: duration(planDuration.min * 60)})}`
            : rate && ` · ${tr('about {time}', {time: duration(planLength / rate)})}`}
          <InfoTip>
            {planDuration
              ? planDuration.runs > 0
                ? tr("Length of all passes and stripes. The time is the planner's, corrected by the last {n} finished mows of this area.", {n: planDuration.runs})
                : tr("Length of all passes and stripes. The time is the planner's estimate, it gets corrected by the finished mows of this area.")
              : tr('Length of all passes and stripes. The time is based on the last run you watched on the dashboard.')}
          </InfoTip>
        </p>
      )}
      {showStripes && onSaveCase && <SaveCase save={onSaveCase} planner={!!plannerSettings} />}
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
          <label className={[styles.toggle, styles.toggleLong].join(' ')}>
            <input
              type="checkbox"
              checked={previewCorrection !== 0}
              onChange={() => onPreviewCorrection(previewCorrection ? 0 : Math.round(mismatch.diff))}
            />
            <span>{tr('turn the preview by {n}° to match', {n: Math.round(mismatch.diff)})}</span>
          </label>
        </div>
      )}
    </div>
  );
}

// for a plan that looks wrong: it and everything it was made from as a file, so it can be planned again the same way
function SaveCase({save, planner}: {save: () => Promise<void>; planner: boolean}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <p className={styles.dim}>
      <button
        type="button"
        className={simple.link}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          save()
            .catch((e: unknown) => setError(e instanceof Error ? e.message : tr('failed')))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? tr('Saving the plan…') : tr('Save the plan as a file')}
      </button>
      <InfoTip>
        {planner
          ? tr("The plan with what it was made from: the map, the planner's settings and OpenMower's mowing settings. For a plan that looks wrong, it can be planned again exactly the same way from it.")
          : tr("The plan with what it was made from: the map and OpenMower's mowing settings. For a plan that looks wrong, it can be planned again exactly the same way from it.")}
      </InfoTip>
      {error && <span className={styles.error}> {error}</span>}
    </p>
  );
}

// the whole turn, 0 to 359: 90° and 270° give the same lanes, but the mower starts them on the other side
const fullTurn = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;
export const shownAngle = (area: Area, autoAngle: number) => fullTurn((area.properties.angle ?? autoAngle) / DEG);

// the angle as a number, 0 to 359 (-90 is taken as 270). what's typed stays as it is while typing, it's shown
// turned into 0 to 359 once the field is left
function AngleField({
  angle,
  autoAngle,
  onFocus,
  update,
}: {
  angle: number | undefined;
  autoAngle: number;
  onFocus: () => void;
  update: UpdateArea;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      step={1}
      value={draft ?? (angle !== undefined ? fullTurn(angle / DEG) : '')}
      placeholder={tr('auto {n}', {n: fullTurn(autoAngle / DEG)})}
      onFocus={onFocus}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value);
        // half typed, e.g. just a minus: the browser reports it as empty
        if (e.target.validity.badInput) return;
        update({angle: e.target.value.trim() === '' ? undefined : fullTurn(Number(e.target.value)) * DEG}, false);
      }}
    />
  );
}

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
      max={359}
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

// the angle on a little compass, north up like the map: the line is the stripe direction, the arrow points where
// the angle points (0° east, 90° north). 90° and 270° give the same lanes, but the mower starts them on the other side
export function AngleCompass({rad}: {rad: number}) {
  const r = 15;
  const [ux, uy] = [Math.cos(rad), -Math.sin(rad)];
  const at = (along: number, across = 0) => `${ux * along + uy * across},${uy * along - ux * across}`;
  return (
    <svg className={styles.compass} viewBox="-24 -24 48 48" role="img" aria-label={tr('Mow angle')}>
      <circle r={r + 1} />
      <line x1={-ux * r} y1={-uy * r} x2={ux * (r - 6)} y2={uy * (r - 6)} />
      <polygon points={`${at(r)} ${at(r - 7, 4)} ${at(r - 7, -4)}`} />
      <text y={-20}>{tr('N')}</text>
      <text x={21} y={1}>{tr('E')}</text>
      <text y={21}>{tr('S')}</text>
      <text x={-21} y={1}>{tr('W')}</text>
    </svg>
  );
}

// one degree at a time, the slider is hard to hit exactly on a phone
export function AngleStep({area, autoAngle, remember, update, onEdit, by}: Parameters<typeof AngleSlider>[0] & {by: number}) {
  return (
    <button
      className={styles.angleStep}
      onClick={() => {
        remember();
        update({angle: fullTurn(shownAngle(area, autoAngle) + by) * DEG}, false);
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
      <AngleCompass rad={props.area.properties.angle ?? props.autoAngle} />
      <AngleStep {...props} by={-1} />
      <AngleSlider {...props} />
      <AngleStep {...props} by={1} />
      <strong>{shownAngle(props.area, props.autoAngle)}°</strong>
    </div>
  );
}
