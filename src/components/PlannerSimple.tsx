'use client';

import type {MowerMap, Point} from '@/hooks/useMowerMap';
import {tr} from '@/lib/i18n';
import {resetPlannerAngle, savePlannerSettings, slic3rPlans, usePlannerSettings, type PlannerSetting} from '@/lib/mowerBody';
import {ANGLE_FOR_ALL, FIELDS} from '@/lib/plannerFields';
import {areasWith, areasWithDirection, ownMargins, ownSettings, shown, type AreaValue, type OpenMowerOwn} from '@/lib/plannerOwn';
import {RpcError} from '@/lib/rpc';
import {useEffect, useState} from 'react';
import InfoTip from './InfoTip';
import {NoSizesWarning} from './MowerBodySettings';
import local from './PlannerSimple.module.css';

// The planner's settings that matter for a garden, in the same sections for all areas and for one area: pattern,
// direction, edge, obstacles, turns and the drives between the parts. For all areas (saved on the planner right away)
// or for one area (its planner property, saved with the map, nothing set: like all areas). Under a setting stays
// which value counts where: for all areas the areas with one of their own, for an area its own one or OpenMower's, at
// the distance to obstacles the obstacles with their own. A setting shows only when the planner on the mower has it.
// The rest is in the lists for experts below (SIMPLE: the ones that are here).

type Area = {
  own: Record<string, unknown>;
  set: (key: string, value: unknown) => void;
  // OpenMower's own values of the area (outline_count and co.), they count while the planner has none of its own
  openmower?: OpenMowerOwn;
  // one of them taken away
  dropOpenMower?: (key: keyof OpenMowerOwn) => void;
  // everything of its own back to like all areas
  clear?: () => void;
  // the outline passes in its plan (automatic: what the planner worked out for it)
  planned?: number;
  // its outline, for the obstacles in it
  outline?: Point[];
};

const DEG = Math.PI / 180;
// degrees to a tenth, for a step
const degrees = (rad: number) => Math.round((rad / DEG) * 10) / 10;
const cm = (m: unknown) => (typeof m === 'number' ? String(Math.round(m * 1000) / 10) : '');
const meters = (m: unknown) => (typeof m === 'number' ? String(Math.round(m * 100) / 100) : '');

const PATTERNS = ['lanes', 'concentric', 'crosshatch'];
const PATTERN_LABELS: Record<string, string> = {lanes: 'Lanes', concentric: 'Rings', crosshatch: 'Crosshatch'};
const PATTERN_NOTES: Record<string, string> = {
  lanes: 'Straight lanes there and back: the quickest, even stripes.',
  concentric: 'Rounds from the outside in: few turns, tight ones in the corners.',
  crosshatch: 'Lanes and the same across them: twice as long, very thorough.',
};
const STRATEGIES = ['longest_edge', 'min_width', 'optimal'];
const STRATEGY_NOTES: Record<string, string> = {
  openmower: "From the outline's first point, for a recorded area the way you set off.",
  longest_edge: 'Along the longest edge of the area.',
  min_width: 'Across the narrowest width: the fewest lanes, the longest ones.',
  optimal: 'Directions are tried and the one with the fewest lanes and turns taken.',
};

function Choice({
  options,
  value,
  onChange,
  like,
  disabled,
}: {
  options: [string, string][];
  value: unknown;
  onChange: (v: string | undefined) => void;
  // for an area: the choice "as all areas"
  like?: string;
  disabled?: boolean;
}) {
  return (
    <div className={local.segment}>
      {like !== undefined && (
        <button className={value === undefined ? local.on : undefined} disabled={disabled} onClick={() => onChange(undefined)}>
          {like}
        </button>
      )}
      {options.map(([k, label]) => (
        <button key={k} className={value === k ? local.on : undefined} disabled={disabled} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// a setting: its name with what it's for behind the i, the control, a line on what the choice taken does, and which
// value counts where
function Row({
  label,
  help,
  note,
  source,
  children,
}: {
  label: string;
  help?: string;
  note?: string | null;
  source?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={local.row}>
      <span className={local.label}>
        {label}
        {help && <InfoTip>{help}</InfoTip>}
      </span>
      {children}
      {note && <p className={local.note}>{note}</p>}
      {source}
    </div>
  );
}

function Section({title, note, children}: {title: string; note?: string | null; children: React.ReactNode}) {
  return (
    <section className={local.section}>
      <h4 className={local.heading}>{title}</h4>
      {note && <p className={local.note}>{note}</p>}
      {children}
    </section>
  );
}

// omIncrement: OpenMower's own mow_angle_increment (degrees), it adds up with the planner's turning further.
// map: the map as edited, for the areas and obstacles with values of their own, onSelectArea selects one of them.
// For an area: direction, its angle, range and turning further (MowSettings), plan, its plan at the top, openmower,
// OpenMower's own values of the area, for OpenMower's slic3r planner. With that one switched on (planner) the MowBite
// Planner's settings are shown greyed out, they only count with it
export function PlannerSimple({
  area,
  map,
  onSelectArea,
  toolWidth,
  omIncrement,
  direction,
  plan,
  openmower,
}: {
  area?: Area;
  map?: MowerMap | null;
  onSelectArea?: (id: string) => void;
  toolWidth?: number;
  omIncrement?: number;
  direction?: React.ReactNode;
  plan?: React.ReactNode;
  openmower?: React.ReactNode;
}) {
  const planner = usePlannerSettings();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [state, setState] = useState<{busy?: boolean; error?: string; saved?: number}>({});
  // "saved" shows for a moment
  useEffect(() => {
    if (!state.saved) return;
    const t = setTimeout(() => setState((s) => (s.saved === state.saved ? {} : s)), 2500);
    return () => clearTimeout(t);
  }, [state.saved]);
  if (!planner) return null;
  const all: Record<string, PlannerSetting> = planner.settings;
  const has = (k: string) => !!all[k]?.settable;
  const global = (k: string) => all[k]?.value;
  // what's set: the area's own (undefined: like all areas), or the one for all areas
  const value = (k: string) => (area ? area.own[k] : global(k));
  const effective = (k: string) => (area && area.own[k] !== undefined ? area.own[k] : global(k));
  const num = (k: string) => (typeof effective(k) === 'number' ? (effective(k) as number) : undefined);
  const store = async (values: Record<string, unknown>) => {
    setState({busy: true});
    try {
      await savePlannerSettings(values);
      setState((s) => ({saved: (s.saved ?? 0) + 1}));
    } catch (e) {
      setState({error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };
  const save = async (k: string, v: unknown) => {
    if (area) return area.set(k, v);
    await store({[k]: v === undefined ? null : v});
  };
  const like = (text: string) => (area ? tr('as all ({value})', {value: text}) : undefined);
  const parse = (text: string) => {
    const v = Number(text.trim().replace(',', '.'));
    return text.trim() && Number.isFinite(v) ? v : null;
  };
  // a number typed in, saved when the field is left, with its unit after it
  const numberField = (key: string, shownText: string, placeholder: string, unit: string, apply: (text: string) => void) => (
    <label className={local.field}>
      <input
        inputMode="decimal"
        value={drafts[key] ?? shownText}
        placeholder={placeholder}
        disabled={state.busy}
        onChange={(e) => setDrafts({...drafts, [key]: e.target.value})}
        onBlur={() => {
          if (drafts[key] === undefined) return;
          apply(drafts[key]);
          const rest = {...drafts};
          delete rest[key];
          setDrafts(rest);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {unit}
    </label>
  );
  // a distance in cm for a setting in m, for an area empty is "as all areas"
  const cmField = (key: string, max = 100) =>
    numberField(key, area && area.own[key] === undefined ? '' : cm(value(key)), cm(global(key)), 'cm', (text) => {
      const v = parse(text);
      void save(key, v === null ? undefined : Math.min(max, Math.max(0, v)) / 100);
    });
  // a length in m, for an area empty is "as all areas"
  const mField = (key: string, max: number) =>
    numberField(key, area && area.own[key] === undefined ? '' : meters(value(key)), meters(global(key)), 'm', (text) => {
      const v = parse(text);
      void save(key, v === null ? undefined : Math.min(max, Math.max(0, v)));
    });
  // one of two ways, off first: for an area also "as all areas"
  const either = (key: string, off: string, on: string) => (
    <Choice
      options={[
        ['off', off],
        ['on', on],
      ]}
      value={value(key) === undefined ? undefined : value(key) ? 'on' : 'off'}
      like={like(global(key) ? on : off)}
      disabled={state.busy}
      onChange={(v) => void save(key, v === undefined ? undefined : v === 'on')}
    />
  );
  // on or off: a switch for all areas
  const toggle = (key: string) =>
    area ? (
      either(key, tr('off'), tr('on'))
    ) : (
      <label className={local.switch}>
        <input type="checkbox" checked={!!value(key)} disabled={state.busy} onChange={(e) => void save(key, e.target.checked)} />
        <span>{value(key) ? tr('on') : tr('off')}</span>
      </label>
    );
  // one of a setting's choices, for an area also "as all areas"
  const choice = (key: string, names: Record<string, string>) => (
    <Choice
      options={(all[key].choices ?? Object.keys(names)).filter((c) => names[c]).map((c) => [c, tr(names[c])])}
      value={value(key)}
      like={like(tr(names[String(global(key))] ?? String(global(key) ?? '')))}
      disabled={state.busy}
      onChange={(v) => void save(key, v)}
    />
  );

  // which value counts where. For all areas: the areas with one of their own, tapped the map selects them
  const areaList = (text: string, list: AreaValue[]) =>
    list.length > 0 && (
      <p className={local.source}>
        {text}{' '}
        {list.map((a, i) => (
          <span key={a.id}>
            {i > 0 && ', '}
            {onSelectArea ? (
              <button className={local.link} onClick={() => onSelectArea(a.id)}>
                {a.name}
              </button>
            ) : (
              a.name
            )}{' '}
            ({a.value})
          </span>
        ))}
      </p>
    );
  const others = (key: string) => (area ? null : areaList(tr('Own value in:'), areasWith(map, key, all)));
  // for an area: its own value with the way back to the one for all areas, where the field alone doesn't show it
  const ownLine = (key: string, allText?: string) =>
    area &&
    area.own[key] !== undefined && (
      <p className={local.source}>
        {tr('Own value for this area, all areas: {value}.', {value: allText ?? shown(key, global(key), all[key])})}{' '}
        <button className={local.link} onClick={() => area.set(key, undefined)}>
          {tr('like all areas')}
        </button>
      </p>
    );
  // OpenMower's own count of the area, saved in the map: it counts while the area has none for the planner
  const omCount = (k: 'outline_count' | 'outline_overlap_count') => {
    const v = area?.openmower?.[k];
    return typeof v === 'number' && v >= 0 ? v : undefined;
  };
  const omLine = (key: string, prop: 'outline_count' | 'outline_overlap_count') =>
    area && area.own[key] === undefined && omCount(prop) !== undefined ? (
      <p className={local.source}>
        {tr('From OpenMower, saved in the map: {n}. It counts here in place of the value for all areas.', {n: omCount(prop)!})}{' '}
        {area.dropOpenMower && (
          <button className={local.link} onClick={() => area.dropOpenMower!(prop)}>
            {tr('remove')}
          </button>
        )}
      </p>
    ) : (
      ownLine(key)
    );

  const blade = typeof global('mower_width') === 'number' ? (global('mower_width') as number) : 0.18;
  // the lane spacing: worked out by the planner, or fixed (from the overlap with the blade, else OpenMower's)
  const auto = effective('lane_spacing_mode') === 'auto';
  const overlap = area?.own.overlap ?? (all.overlap?.stored ? all.overlap.value : undefined);
  const spacingCm = typeof overlap === 'number' ? blade * (1 - overlap) * 100 : toolWidth !== undefined ? toolWidth * 100 : null;
  // the fixed spacing for all areas, for an area with its own
  const allOverlap = all.overlap?.stored ? all.overlap.value : undefined;
  const allSpacingCm = typeof allOverlap === 'number' ? blade * (1 - allOverlap) * 100 : toolWidth !== undefined ? toolWidth * 100 : null;
  const passes = effective('perimeter_passes');
  const autoPasses = all.perimeter_passes?.auto_value;
  // what counts: the area's own, then OpenMower's of the area (it beats the one for all areas), then that one
  const passesShown = area && area.own.perimeter_passes === undefined ? (omCount('outline_count') ?? global('perimeter_passes')) : passes;
  const passesAuto = autoPasses !== undefined && passesShown === autoPasses;
  // the passes round the obstacles: automatic is as many as along the outline
  const autoObstacle = all.obstacle_passes?.auto_value;
  const obstacleAuto = autoObstacle !== undefined && effective('obstacle_passes') === autoObstacle;
  // the outline passes the lanes reach into: the area's own, OpenMower's of the area, the one for all areas
  const overlapOwn = area ? area.own.lane_overlap_passes : global('lane_overlap_passes');
  const overlapElse = area ? (omCount('outline_overlap_count') ?? global('lane_overlap_passes')) : all.lane_overlap_passes?.default;
  const reach = typeof overlapOwn === 'number' ? overlapOwn : typeof overlapElse === 'number' ? overlapElse : 0;
  // the angle turned further after finished mows: by this step every nth mow (an area's own step: its direction)
  const step = typeof global('angle_increment') === 'number' ? (global('angle_increment') as number) : 0;
  const every = typeof global('angle_increment_every') === 'number' ? (global('angle_increment_every') as number) : 1;
  const steps = planner.angle_steps ?? 0;
  const mows = planner.angle_mows ?? 0;
  const resetAngle = async () => {
    setState({busy: true});
    try {
      await resetPlannerAngle();
      setState({});
    } catch (e) {
      setState({error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };
  // a direction still stored for all areas, the menu doesn't offer it any more
  const angleForAll = ANGLE_FOR_ALL.filter((k) => all[k]?.stored && all[k].value !== null && all[k].value !== undefined);
  // with the mower's sizes the planner checks its body, the lines are where its middle drove (collision mode): what the
  // lines stand for doesn't matter any more then
  const sized = ['robot_width', 'robot_front', 'robot_rear'].every((k) => (num(k) ?? -1) > 0);
  const collision = has('edge_margin') && sized;
  // how far in from the lines the blade's edge stays on the first outline pass, for the note on the lines
  const first = num('perimeter_offset') ?? 0.5 * blade;
  const width = num('robot_width');
  const strip =
    effective('edges') !== 'hard'
      ? first - 0.5 * blade
      : width === undefined
        ? undefined
        : Math.max(first, 0.5 * width - Math.abs(num('blade_offset') ?? 0)) - 0.5 * blade;
  const spot = effective('turn_on_spot') === true;
  // with OpenMower's slic3r planner the area's OpenMower values count and show above, only its MowBite settings here
  const own = area ? ownSettings(area.own, slic3rPlans(planner) ? {} : (area.openmower ?? {}), all, collision) : [];
  const margins = ownMargins(map, area?.outline);
  const gap = num('bend_max_gap') ?? 0;

  // OpenMower's slic3r planner plans instead of the MowBite Planner
  const slic3r = slic3rPlans(planner);

  // for all areas, at a glance
  const summary = area
    ? null
    : slic3r
      ? [tr("OpenMower's slic3r planner, with OpenMower's settings")]
      : [
        tr(PATTERN_LABELS[String(global('fill_pattern'))] ?? String(global('fill_pattern') ?? '')),
        auto ? tr('spacing automatic') : spacingCm !== null ? tr('{cm} cm apart', {cm: Math.round(spacingCm * 10) / 10}) : null,
        typeof passes === 'number' ? (passesAuto ? tr('outline passes automatic') : tr('{n} outline passes', {n: passes})) : null,
        has('edge_margin') ? tr('{cm} cm off the edge', {cm: cm(global('edge_margin'))}) : null,
        has('body_fit')
          ? global('body_fit')
            ? sized || !has('robot_front')
              ? tr('collision check on')
              : tr('collision check without effect, no mower sizes')
            : tr('collision check off')
          : null,
        ].filter(Boolean);

  // the blade the planner spaces the lanes by, never set: its default fits a YardForce, not every mower
  const bladeDefault = !slic3r && !!all.mower_width && !all.mower_width.stored;

  return (
    <div className={local.simple}>
      {!slic3r && <NoSizesWarning inArea={!!area} />}
      {bladeDefault && !area && (
        <p className={local.note}>
          {tr("The blade is not set in the planner, it plans with {a} cm. Lanes are spaced by it: set your mower's blade under Mower sizes.", {
            a: Math.round(blade * 1000) / 10,
          })}
        </p>
      )}
      {area ? (
        <div className={local.summary}>
          <p className={local.line}>{tr('Only for this area. Saved with the map ("Save map"), the preview shows it right away.')}</p>
          {slic3r && (
            <p className={local.line}>
              {tr("OpenMower's slic3r planner plans (Planner for all areas): OpenMower's own values of the area count, its MowBite settings only with the MowBite Planner.")}
            </p>
          )}
          {own.length ? (
            <>
              <p className={[local.line, slic3r ? local.idle : ''].filter(Boolean).join(' ')}>
                {tr('This area sets itself:')}{' '}
                {own.map((o, i) => (
                  <span key={o.key} className={o.idle ? local.idle : undefined}>
                    {i > 0 && ' · '}
                    {o.label}: {o.value}
                    {o.idle && ` (${o.idle})`}
                  </span>
                ))}
              </p>
              {area.clear && (
                <div className={local.inline}>
                  <button onClick={area.clear}>{tr('All like all areas')}</button>
                </div>
              )}
            </>
          ) : (
            <p className={local.line}>{tr('Everything like all areas.')}</p>
          )}
        </div>
      ) : (
        <div className={local.summary}>
          {summary && summary.length > 0 && <p className={local.line}>{summary.join(' · ')}</p>}
          <p className={local.line}>
            {tr('For all areas, each change is saved on the mower right away. An area can set its own values, that one counts there.')}
            {state.saved && <strong className={local.saved}> ✓ {tr('saved')}</strong>}
          </p>
        </div>
      )}

      {!area && has('planner') && (
        <Section title={tr('Planner')}>
          <Row
            label={tr('Which planner')}
            help={tr(FIELDS.planner.help)}
            note={
              slic3r
                ? tr("OpenMower's slic3r planner, as without MowBite: OpenMower's outline passes, lane spacing and mow angles, no collision check.")
                : tr('The MowBite Planner, with the settings below.')
            }
          >
            <Choice
              options={[
                ['mowbite', tr('MowBite')],
                ['slic3r', tr('slic3r (OpenMower)')],
              ]}
              value={slic3r ? 'slic3r' : 'mowbite'}
              disabled={state.busy}
              onChange={(v) => void save('planner', v === 'slic3r' ? 'slic3r' : undefined)}
            />
          </Row>
        </Section>
      )}

      {plan}

      {/* with OpenMower's slic3r planner the area's angle and OpenMower's own values count, they come first */}
      {slic3r && area && direction && <Section title={tr('Direction')}>{direction}</Section>}
      {slic3r && area && openmower && (
        <Section title={tr('OpenMower')} note={tr("Empty: OpenMower's value for all areas (mower_params.yaml).")}>
          {openmower}
        </Section>
      )}
      {slic3r && <p className={local.note}>{tr('Only with the MowBite Planner:')}</p>}

      <div className={slic3r ? local.off : local.sections} inert={slic3r}>
        <Section title={tr('Pattern')}>
          {has('fill_pattern') && (
            <Row
              label={tr('Pattern')}
              help={tr('How the mower covers the inside of the area, after the outline passes.')}
              note={PATTERN_NOTES[String(effective('fill_pattern'))] ? tr(PATTERN_NOTES[String(effective('fill_pattern'))]) : null}
              source={others('fill_pattern')}
            >
              <Choice
                options={PATTERNS.filter((p) => all.fill_pattern.choices?.includes(p)).map((p) => [p, tr(PATTERN_LABELS[p])])}
                value={value('fill_pattern')}
                like={like(tr(PATTERN_LABELS[String(global('fill_pattern'))] ?? String(global('fill_pattern'))))}
                disabled={state.busy}
                onChange={(v) => void save('fill_pattern', v)}
              />
            </Row>
          )}
          {/* the angle of the second lanes, for all areas */}
          {!area && has('crosshatch_angle') && effective('fill_pattern') === 'crosshatch' && (
            <Row label={tr('Crosshatch angle')} help={tr(FIELDS.crosshatch_angle.help)} note={tr('The second lanes run this far turned to the first.')}>
              {numberField('crosshatch', degrees((global('crosshatch_angle') as number) ?? 0).toString(), '90', '°', (text) => {
                const d = parse(text);
                void save('crosshatch_angle', d === null ? undefined : Math.min(90, Math.max(10, d)) * DEG);
              })}
            </Row>
          )}
          {has('lane_spacing_mode') && (
            <Row
              label={tr('Lane spacing')}
              help={tr(
                'How far apart the lanes are. The blade mows a little wider, so neighbouring lanes overlap. Automatic: the widest spacing that still leaves nothing standing, fewer lanes and turns.',
              )}
              note={auto ? tr('As wide as nothing stays standing.') : tr('Smaller overlaps more and takes longer. Empty: the spacing set in OpenMower.')}
              source={
                others('lane_spacing_mode') ||
                (area && area.own.overlap !== undefined && allSpacingCm !== null
                  ? ownLine('overlap', tr('{cm} cm apart', {cm: Math.round(allSpacingCm * 10) / 10}))
                  : null)
              }
            >
              <div className={local.inline}>
                <Choice
                  options={[
                    ['auto', tr('automatic')],
                    ['fixed', tr('Fixed')],
                  ]}
                  value={value('lane_spacing_mode')}
                  like={like(global('lane_spacing_mode') === 'auto' ? tr('automatic') : tr('Fixed'))}
                  disabled={state.busy}
                  onChange={(v) => void save('lane_spacing_mode', v)}
                />
                {!auto &&
                  has('overlap') &&
                  numberField(
                    'spacing',
                    area && area.own.overlap === undefined ? '' : spacingCm !== null ? String(Math.round(spacingCm * 10) / 10) : '',
                    spacingCm !== null ? String(Math.round(spacingCm * 10) / 10) : '',
                    'cm',
                    (text) => {
                      const v = parse(text);
                      if (v === null) return void save('overlap', undefined);
                      void save('overlap', Math.min(0.95, Math.max(0, 1 - v / 100 / blade)));
                    },
                  )}
              </div>
            </Row>
          )}
          {has('headland_turns') && (
            <Row
              label={tr('Clean stripes')}
              help={tr(
                'In the field of lanes the mower only drives straight along the lanes, it turns and drives across along the outline passes. The stripes stay clean, it takes about a quarter longer.',
              )}
              note={
                effective('headland_turns')
                  ? tr('Turns only along the edge, about a quarter longer. With few outline passes the edge is too narrow for loops and it turns on the spot there, more passes mean less of that.')
                  : tr('Turns at the end of every lane.')
              }
              source={others('headland_turns')}
            >
              {toggle('headland_turns')}
            </Row>
          )}
          {/* only with clean stripes and the mower's sizes, the planner leaves it out otherwise */}
          {has('headland_corners') && effective('headland_turns') === true && sized && (
            <Row
              label={tr('Corners along the edge')}
              help={tr('How the drives along the outline passes take their corners: in a curve, gentle on the lawn, or sharp with a turn on the spot.')}
              note={effective('headland_corners') === 'sharp' ? tr('Sharp: it turns on the spot at the corners.') : tr('Rounded: the corners are driven in a curve.')}
              source={others('headland_corners')}
            >
              {choice('headland_corners', {rounded: 'Rounded', sharp: 'Sharp'})}
            </Row>
          )}
          {has('narrow_parts') && (
            <Row
              label={tr('Narrow parts')}
              help={tr(FIELDS.narrow_parts.help)}
              note={
                effective('narrow_parts') === 'loops'
                  ? tr('Where lanes have no room to turn, the outline passes go on further in until it is mowed.')
                  : tr('Lanes also where they have hardly room to turn.')
              }
              source={others('narrow_parts')}
            >
              {choice('narrow_parts', FIELDS.narrow_parts.choices!)}
            </Row>
          )}
          {has('split_zones') && (
            <Row
              label={tr('Parts with their own direction')}
              help={tr(FIELDS.split_zones.help)}
              note={
                effective('fill_pattern') !== 'lanes' || effective('headland_turns')
                  ? tr('No effect with crosshatch, rings or clean stripes.')
                  : effective('split_zones')
                    ? tr('A part better mowed another way gets lanes its own way, where that saves lanes.')
                    : tr('Off: one direction for the whole area.')
              }
              source={others('split_zones')}
            >
              {toggle('split_zones')}
            </Row>
          )}
          {/* only with the mower's sizes, the planner leaves it out otherwise */}
          {has('mop_up') && sized && (
            <Row
              label={tr('Mow the leftovers')}
              help={tr(FIELDS.mop_up.help)}
              note={
                effective('mop_up')
                  ? tr('At the end a short pass over the biggest pieces left unmowed, a little more driving.')
                  : tr('The plan ends after its lanes and outline passes.')
              }
              source={others('mop_up')}
            >
              {toggle('mop_up')}
            </Row>
          )}
        </Section>

        {area ? (
          !slic3r && direction && <Section title={tr('Direction')}>{direction}</Section>
        ) : (
          (has('angle_strategy') || has('angle_increment') || angleForAll.length > 0) && (
            <Section title={tr('Direction')}>
              {has('angle_strategy') && (
                <Row
                  label={tr('Automatic direction')}
                  help={tr(FIELDS.angle_strategy.help)}
                  note={`${tr('For areas without a mow angle of their own:')} ${tr(STRATEGY_NOTES[all.angle_strategy.stored ? String(global('angle_strategy')) : 'openmower'] ?? '')}`}
                  source={areaList(tr('Own direction:'), areasWithDirection(map, all))}
                >
                  <Choice
                    options={[
                      ['openmower', tr('OpenMower')],
                      ...STRATEGIES.filter((c) => all.angle_strategy.choices?.includes(c)).map((c): [string, string] => [c, tr(FIELDS.angle_strategy.choices![c])]),
                    ]}
                    value={all.angle_strategy.stored ? global('angle_strategy') : 'openmower'}
                    disabled={state.busy}
                    onChange={(v) => void save('angle_strategy', v === 'openmower' ? undefined : v)}
                  />
                </Row>
              )}
              {has('angle_increment') && (
                <Row
                  label={tr('Turn further')}
                  help={tr(
                    "So the wheels don't wear tracks into the lawn: after finished mowing runs the lanes run a little turned each time. Within an area's angle range they swing back and forth between its ends, without one they go round all 180°.",
                  )}
                  note={
                    !step
                      ? tr('Off: the lanes run the same way every time.')
                      : steps > 0
                        ? tr('So far {steps} times, {deg}° in all.', {steps, deg: degrees(steps * step)})
                        : tr('Not turned yet.')
                  }
                  source={others('angle_increment')}
                >
                  <div className={local.inline}>
                    {numberField('turn', String(degrees(step)), '0', '°', (text) => {
                      const d = parse(text);
                      void save('angle_increment', d === null ? 0 : Math.min(180, Math.max(0, d)) * DEG);
                    })}
                    {has('angle_increment_every') && (
                      <>
                        <span className={local.word}>{tr('each time after')}</span>
                        {numberField('every', String(every), '1', every === 1 ? tr('mowing run') : tr('mowing runs'), (text) => {
                          const n = parse(text);
                          void save('angle_increment_every', n === null ? undefined : Math.max(1, Math.round(n)));
                        })}
                      </>
                    )}
                    {steps + mows > 0 && (
                      <button disabled={state.busy} onClick={() => void resetAngle()}>
                        {tr('back to 0°')}
                      </button>
                    )}
                  </div>
                  {!!omIncrement && (
                    <span className={local.error}>
                      {tr('OpenMower turns the angle further as well (mow_angle_increment {deg}°), the two add up. Set it to 0 in mower_params.yaml.', {
                        deg: omIncrement,
                      })}
                    </span>
                  )}
                </Row>
              )}
              {angleForAll.length > 0 && (
                <div className={local.row}>
                  <p className={local.error}>
                    {tr('Still stored for all areas: {what}. It changes the direction of every area, this menu no longer offers it (each area has its own angle and range).', {
                      what: angleForAll.map((k) => `${tr(FIELDS[k]?.label ?? k)} ${shown(k, all[k].value, all[k])}`).join(', '),
                    })}
                  </p>
                  <div className={local.inline}>
                    <button disabled={state.busy} onClick={() => void store(Object.fromEntries(angleForAll.map((k) => [k, null])))}>
                      {tr('Remove')}
                    </button>
                  </div>
                </div>
              )}
            </Section>
          )
        )}

        <Section
          title={tr('Edge')}
          note={collision ? tr('The lines of the map are where the middle of the mower drove, the real edges are half its width further out.') : null}
        >
          {has('edges') && !collision && (
            <Row
              label={tr('Lines of the map')}
              help={tr('What the lines of your map stand for. Recorded by driving the mower around: "driven along the edge". Drawn on the screen right along a wall or a bed: "the wall itself".')}
              note={
                effective('edges') === 'hard'
                  ? strip !== undefined && strip > 0.005
                    ? tr('Nothing of the mower goes past them, about {cm} cm stay standing along them.', {cm: Math.round(strip * 100)})
                    : tr('Nothing of the mower goes past them.')
                  : tr('The middle of the mower drove them, the blade mows up to them.')
              }
              source={others('edges')}
            >
              <Choice
                options={[
                  ['hard', tr('The wall itself')],
                  ['recorded', tr('Driven along the edge')],
                ]}
                value={value('edges')}
                like={like(global('edges') === 'hard' ? tr('The wall itself') : tr('Driven along the edge'))}
                disabled={state.busy}
                onChange={(v) => void save('edges', v)}
              />
            </Row>
          )}
          {has('perimeter_passes') && (
            <Row
              label={tr('Outline passes')}
              help={tr('How many rounds the mower drives along the edge first, before it mows the inside. They leave it room to turn at the ends of the lanes. Automatic: as many as the turns need.')}
              note={
                passesAuto
                  ? area?.planned !== undefined
                    ? tr('As many as the turns need room for, here {n}.', {n: area.planned})
                    : tr('As many as the turns need room for.')
                  : autoPasses !== undefined
                    ? tr('Always this many.')
                    : null
              }
              source={area ? omLine('perimeter_passes', 'outline_count') : others('perimeter_passes')}
            >
              <div className={local.inline}>
                {autoPasses !== undefined && (
                  <button
                    className={passesAuto ? local.on : undefined}
                    disabled={state.busy || passesAuto}
                    onClick={() =>
                      void save(
                        'perimeter_passes',
                        area && global('perimeter_passes') === autoPasses && omCount('outline_count') === undefined ? undefined : autoPasses,
                      )
                    }
                  >
                    {tr('automatic')}
                  </button>
                )}
                {numberField(
                  'passes',
                  passesAuto || (area && area.own.perimeter_passes === undefined) ? '' : typeof passes === 'number' ? String(passes) : '',
                  typeof passesShown === 'number' && passesShown !== autoPasses ? String(passesShown) : '',
                  tr('rounds'),
                  (text) => {
                    const n = parse(text);
                    void save('perimeter_passes', n === null ? undefined : Math.max(0, Math.round(n)));
                  },
                )}
              </div>
            </Row>
          )}
          {has('obstacle_passes') && (
            <Row
              label={tr('Passes around obstacles')}
              help={tr('How many rounds the mower drives round each obstacle, on their own from the outline passes. Automatic: as many as along the outline. 0: none, the lanes go round the obstacle.')}
              note={
                obstacleAuto
                  ? tr('As many as along the outline.')
                  : num('obstacle_passes') === 0
                    ? tr('None, the lanes go round the obstacles.')
                    : tr('Always this many.')
              }
              source={others('obstacle_passes') || ownLine('obstacle_passes')}
            >
              <div className={local.inline}>
                {autoObstacle !== undefined && (
                  <button
                    className={obstacleAuto ? local.on : undefined}
                    disabled={state.busy || obstacleAuto}
                    onClick={() => void save('obstacle_passes', area && global('obstacle_passes') === autoObstacle ? undefined : autoObstacle)}
                  >
                    {tr('automatic')}
                  </button>
                )}
                {numberField(
                  'obstaclePasses',
                  obstacleAuto || (area && area.own.obstacle_passes === undefined) ? '' : typeof num('obstacle_passes') === 'number' ? String(num('obstacle_passes')) : '',
                  typeof global('obstacle_passes') === 'number' && global('obstacle_passes') !== autoObstacle ? String(global('obstacle_passes')) : '',
                  tr('rounds'),
                  (text) => {
                    const n = parse(text);
                    void save('obstacle_passes', n === null ? undefined : Math.max(0, Math.round(n)));
                  },
                )}
              </div>
            </Row>
          )}
          {has('lane_overlap_passes') && effective('fill_pattern') !== 'concentric' && (
            <Row
              label={tr('Overlapping passes')}
              help={tr(
                'How many outline passes the lanes reach into: they start that many passes further out, so nothing stays standing between the passes and the lanes. Not with rings.',
              )}
              note={
                reach === 0
                  ? tr('The lanes start after the last outline pass.')
                  : reach === 1
                    ? tr('The lanes reach 1 pass further out.')
                    : tr('The lanes reach {n} passes further out.', {n: reach})
              }
              source={area ? omLine('lane_overlap_passes', 'outline_overlap_count') : others('lane_overlap_passes')}
            >
              {numberField(
                'overlapPasses',
                typeof overlapOwn === 'number' ? String(overlapOwn) : '',
                typeof overlapElse === 'number' ? String(overlapElse) : '0',
                tr('rounds'),
                (text) => {
                  const n = parse(text);
                  void save('lane_overlap_passes', n === null ? undefined : Math.max(0, Math.round(n)));
                },
              )}
            </Row>
          )}
          {has('lane_overlap_limit') && effective('fill_pattern') !== 'concentric' && (
            <Row
              label={tr('Turns stay within the overlap')}
              help={tr(FIELDS.lane_overlap_limit.help)}
              note={
                effective('lane_overlap_limit')
                  ? tr('Lanes and turns go no further out than the overlapping passes, more turning on the spot.')
                  : tr('Off: the turns take the room they need in the outline passes.')
              }
              source={others('lane_overlap_limit') || ownLine('lane_overlap_limit')}
            >
              {toggle('lane_overlap_limit')}
            </Row>
          )}
          {has('perimeter_order') && (
            <Row
              label={tr('Outline passes first or last')}
              help={tr(FIELDS.perimeter_order.help)}
              note={
                effective('perimeter_order') === 'last'
                  ? tr('Last: they mow over the marks the turns leave at the edge.')
                  : tr('First: the lanes come after them.')
              }
              source={others('perimeter_order')}
            >
              {choice('perimeter_order', FIELDS.perimeter_order.choices!)}
            </Row>
          )}
          {has('edge_margin') && (
            <Row
              label={tr('Distance to the edge')}
              help={tr('How far the mower keeps its whole body off the real edge, everywhere. More is safer along walls and beds, less mows closer.')}
              note={sized || !has('robot_front') ? tr('The body keeps this far off the real edge.') : tr('For the body only once the planner has the mower sizes.')}
              source={others('edge_margin') || ownLine('edge_margin')}
            >
              {cmField('edge_margin')}
            </Row>
          )}
        </Section>

        {(has('obstacle_margin') || has('bend_max_gap') || (!area && has('nested_areas'))) && (
          <Section title={tr('Obstacles')}>
            {has('obstacle_margin') && (
              <Row
                label={tr('Distance to obstacles')}
                help={tr('How far the mower keeps its body off obstacles, areas not mowed and inactive ones. An obstacle can have its own distance, in the editor under the obstacle, that one counts there.')}
                note={margins.length ? null : tr('Each obstacle can have its own, in the editor.')}
                source={
                  <>
                    {others('obstacle_margin') || ownLine('obstacle_margin')}
                    {areaList(area ? tr('These obstacles here keep their own distance instead:') : tr('These keep their own distance instead:'), margins)}
                  </>
                }
              >
                {cmField('obstacle_margin')}
              </Row>
            )}
            {has('bend_max_gap') && (
              <Row
                label={tr('Lanes around obstacles')}
                help={tr(FIELDS.bend_max_gap.help)}
                note={
                  gap > 0
                    ? tr('A lane goes on around an obstacle up to {m} m long, the area isn’t split there.', {m: meters(gap)})
                    : tr('Off: an obstacle splits the lanes, the parts are mowed one after another.')
                }
                source={others('bend_max_gap') || ownLine('bend_max_gap')}
              >
                {mField('bend_max_gap', 20)}
              </Row>
            )}
            {!area && has('nested_areas') && (
              <Row
                label={tr('Areas inside areas')}
                help={tr(FIELDS.nested_areas.help)}
                note={
                  global('nested_areas')
                    ? tr('A mowing area lying in another is mowed round and planned on its own.')
                    : tr('Off: the bigger area mows across one lying in it.')
                }
              >
                {toggle('nested_areas')}
              </Row>
            )}
          </Section>
        )}

        {(has('turn_on_spot') || has('turn_radius') || has('turn_radius_auto') || has('body_fit') || has('spin_margin')) && (
          <Section title={tr('Turns')}>
            {has('turn_on_spot') && (
              <Row
                label={tr('Turning')}
                help={tr(
                  'Where a plain curve doesn’t fit (at the end of a lane, on the way into one), the mower drives a loop, gentle on the lawn, or turns on the spot, about 14 % quicker but the wheels may scuff the lawn. Curves that fit stay curves.',
                )}
                note={spot ? tr('On the spot: quicker, harder on the lawn.') : tr('In a loop: gentle on the lawn.')}
                source={others('turn_on_spot')}
              >
                {either('turn_on_spot', tr('In a loop'), tr('On the spot'))}
              </Row>
            )}
            {has('spin_margin') && (
              <Row
                label={tr('Extra distance when turning')}
                help={tr(
                  'When turning, on the spot and all along the turns between the lanes, the mower keeps its body this much further off the edge and obstacles: it often wanders a little there. Loops along the edge, lanes and drives keep the plain distances.',
                )}
                note={tr('On top of the distances to the edge and to obstacles.')}
                source={others('spin_margin') || ownLine('spin_margin')}
              >
                {cmField('spin_margin')}
              </Row>
            )}
            {has('turn_radius') && (
              <Row
                label={tr('Turn radius')}
                help={tr(
                  "Radius of the turns at the ends of the lanes, and no curve anywhere is tighter: turns, loops and drives. Where none this wide fits, it turns on the spot. The tighter a curve, the slower the inner wheel turns, at the tightest it stands still or turns backwards and tears the lawn. At half the distance between the drive wheels the inner wheel just stands still: take a little more.",
                )}
                note={tr('Larger is gentler on the lawn, needs more room at the edge.')}
                source={others('turn_radius') || ownLine('turn_radius')}
              >
                {cmField('turn_radius', 300)}
              </Row>
            )}
            {has('turn_radius_auto') && (
              <Row
                label={tr('Turn radius automatic')}
                help={tr(FIELDS.turn_radius_auto.help)}
                note={
                  effective('turn_radius_auto')
                    ? tr('The planner picks the radius of each turn, at least the turn radius above.')
                    : tr('Off: every turn with the turn radius.')
                }
                source={others('turn_radius_auto') || ownLine('turn_radius_auto')}
              >
                {toggle('turn_radius_auto')}
              </Row>
            )}
            {has('body_fit') && (
              <Row
                label={tr('Collision check')}
                help={tr(
                  'Every plan is checked against the mower’s body. Where it would stick out past a real edge or into an obstacle (a turn, a loop in a tight spot), the mower drives there another way and leaves a little out where nothing fits. The places show on the map with the plan. Off: the plan as it comes, the distances still count.',
                )}
                note={
                  effective('body_fit') === false
                    ? tr('Off: the plan stays as it comes.')
                    : sized || !has('robot_front')
                      ? tr('Where the body would stick out, it drives another way.')
                      : tr('No effect yet: the planner has no mower sizes.')
                }
                source={others('body_fit')}
              >
                {toggle('body_fit')}
              </Row>
            )}
          </Section>
        )}

        {(has('route_order') || (!area && has('transit_edge_distance'))) && (
          <Section title={tr('Drives between the parts')}>
            {has('route_order') && (
              <Row
                label={tr('Order of the parts')}
                help={tr(FIELDS.route_order.help)}
                note={
                  effective('route_order') === 'optimized'
                    ? tr('The order with the shortest drives between the parts, takes a little longer to plan.')
                    : tr('The closest part not mowed yet comes next.')
                }
                source={others('route_order')}
              >
                {choice('route_order', FIELDS.route_order.choices!)}
              </Row>
            )}
            {!area && has('transit_edge_distance') && (
              <Row
                label={tr('Drives away from edges')}
                help={tr(FIELDS.transit_edge_distance.help)}
                note={
                  (num('transit_edge_distance') ?? 0) > 0
                    ? tr('Drives keep this far from walls and beds where that costs little more.')
                    : tr('Off: drives take the shortest way.')
                }
              >
                {mField('transit_edge_distance', 5)}
              </Row>
            )}
          </Section>
        )}

      </div>

      {state.error && <span className={local.error}>{state.error}</span>}
    </div>
  );
}
