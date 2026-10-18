'use client';

import type {MapArea, MowerMap, Point} from '@/hooks/useMowerMap';
import {useComputedSpeed} from '@/hooks/useComputedSpeed';
import {createEaser, type Easer, type Pose} from '@/lib/poseEaser';
import {liveGlide} from '@/hooks/useMowerPosition';
import {containsPoint, polygonArea} from '@/lib/geometry';
import {settingsStore, type Settings} from '@/lib/settings';
import {bladeSeconds, bodyShape, realEdges, roundBends, swathEnd, swathGroups, swathAfter, swathTail, useMowerBody, usePlannerSettings, type MowerBody, type SwathState} from '@/lib/mowerBody';
import type {FitPose, PlanPiece} from '@/lib/mowPlan';
import {useSensorValue} from '@/hooks/useMowerSensors';
import {dockIcon, drawMower, mowerIcon} from './mapIcons';
import {availableSources, imageryTiles, type Datum} from '@/lib/imagery';
import {handleRadius, meterGrid} from '@/lib/mapGrid';
import MapControls, {layerOn, type Layer} from './MapControls';
import {useMapPrefs} from './useMapPrefs';
import {Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import styles from './MapView.module.css';
import {fmt, tr, useLang} from '@/lib/i18n';
import {tick} from '@/lib/haptics';
import {TrashIcon} from './icons';
import {MapGhost} from './Halloween';
import {MapCostume} from './Costumes';
import {stillPreferred, useHalloween} from '@/lib/eggs';
import {useTrailingPose} from '@/hooks/useTrailingPose';
import {CELL_M, MIN_SECONDS, gpsGrade, loadCoverage, wifiGrade, type CoverageCell} from '@/lib/coverage';
import {useUpdates} from '@/lib/updates';
import {CoverInfo} from './CoverInfo';
import {areaLook, drawThing, GardenDefs, groundOf, isThing, type Box, type Look} from './gardenLook';
import {autoMowAngle} from '@/lib/mowStripes';

interface MapViewProps {
  map: MowerMap;
  mower?: {x: number; y: number; heading: number};
  // the emergency stop is active, some mower icons show it
  emergency?: boolean;
  selectedAreaId?: string | null;
  onSelectArea?: (id: string) => void;
  onMoveVertex?: (areaId: string, vertexIndex: number, x: number, y: number) => void;
  onDragStart?: () => void;
  // true while a point of an area is being dragged
  onDragging?: (on: boolean) => void;
  // a point drag that turned into a pinch: undo what the drag changed
  onDragCancel?: () => void;
  onInsertVertex?: (areaId: string, vertexIndex: number, x: number, y: number) => void;
  onDeleteVertex?: (areaId: string, vertexIndex: number) => void;
  // takes the last change back, offered for a moment after a point was deleted
  onUndo?: () => void;
  // clicks report map coords instead of selecting (split line, new area)
  pickingPoints?: boolean;
  pendingPoints?: Point[];
  onCanvasClick?: (x: number, y: number) => void;
  onMovePending?: (index: number, x: number, y: number) => void;
  onInsertPending?: (index: number, x: number, y: number) => void;
  // fixed window around the mower instead of fitting the whole map, a button lets the map move freely
  follow?: boolean;
  // a button that keeps the map at the top of the page on a phone (MapControls)
  pin?: {on: boolean; onToggle: () => void};
  followSpanMeters?: number;
  // oldest first
  // the live trail in pieces (see useMowerTrack), finished pieces keep their identity
  track?: readonly (Point & {b?: boolean})[][];
  // a recorded job instead of the live trail, mowed parts solid, driving without blades dashed
  pastTrack?: {points: Point[]; blades: boolean}[];
  // while it drives the leftovers of the mow before: that mow's track, faded under the trail. Its cut counts in the
  // cut width too, so what's still left shows as gaps there until the passes fill them
  beforeTrack?: {points: Point[]; blades: boolean}[];
  // wheel / pinch zoom, drag to pan
  zoomable?: boolean;
  // mowing direction preview
  stripes?: Point[][];
  // the plan in pieces by what they are (the MowBite Planner tells): drawn in place of the stripes and loops, the
  // turns and the drives between the parts left out when switched off in the layer menu
  pieces?: PlanPiece[];
  // the outline passes of the mowing plan, drawn with the stripes
  loops?: Point[][];
  // the loops are paths as driven (the mower's plan), drawn without closing them: closed, the line back to the start
  // would cut across the area, even outside a bent one
  openLoops?: boolean;
  // how far the current run got in the mower's plan: what's left is drawn, the planned part it has done only if
  // switched on in the layer menu (the track shows what it really drove)
  progress?: {todo: Point[][]};
  // the mower's icon dressed up: a towel at 42 % of a mow, an umbrella while it sits out the rain (a witch's hat on
  // halloween comes by itself)
  costume?: {towel?: boolean; umbrella?: boolean};
  // shapes an edit would give (split pieces, merge result), drawn in two alternating colors
  preview?: Point[][];
  // click on the map where there's no area
  onClickEmpty?: () => void;
  // gps datum of the map, enables the aerial imagery option
  datum?: Datum;
  // numbers drawn in areas, e.g. mowing order
  orderLabels?: Record<string, number>;
  // the mower's body to draw with instead of its own (the editor guide shows the real edges of an example mower)
  bodyOverride?: MowerBody;
  // every layer shown, whatever the layer menu hides (the editor guide)
  allLayers?: boolean;
  // spots to point out, e.g. where an error happened (red, pulsing)
  markers?: Point[];
  // a marker tapped: its index, null to close
  onMarkerPick?: (index: number) => void;
  // poses where the planner found the mower's body sticking out, drawn as the body there
  bodySpots?: {x: number; y: number; yaw: number}[];
  // the planner's collision mode: where the body may go, the places it drove another way (m: left out there) and
  // where clean stripes still turned in the field
  bodySpace?: Point[][];
  fitPlaces?: {x: number; y: number; m: number; pose?: FitPose}[];
  // the place picked: the body drawn where it would have stuck out. A place with a pose can be picked, again: none
  fitPicked?: number | null;
  onFitPick?: (index: number | null) => void;
  turnPlaces?: Point[];
  // where the path jumps, a cross each
  jumpPlaces?: Point[];
  // after a run: where the body got into the safety distances, m how far
  marginPlaces?: {x: number; y: number; m: number}[];
  // start zoomed in around this point instead of showing the whole map
  focus?: Point;
  // how many m around the focus point, 12 if not given
  focusSpan?: number;
  // zoom and position are kept under this key while the app runs, e.g. across a visit to the settings
  viewKey?: string;
  // what the mower draws itself, e.g. the lines of an area recording
  overlay?: {points: Point[]; color: string; closed: boolean}[];
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// square viewBox window, in svg units
interface View {
  x: number;
  y: number;
  size: number;
}

const MAX_ZOOM = 40;
// center and width in meters, so a changed map doesn't move what was looked at
const savedViews = new Map<string, {x: number; y: number; span: number}>();
// dragging.areaId while a point of the line being drawn is dragged
const PENDING = '__pending';
const NO_LAYERS_HIDDEN = new Set<Layer>();

type Run = {points: string; blades: boolean};
// drawn runs of each piece of the live trail per map geometry, pieces that are done are never worked out again
const runCache = new WeakMap<object, Map<string, Run[]>>();
// a piece's runs with their bends rounded, the same at any view: following the mower moves the view all the time
const bentCache = new WeakMap<object, {points: Point[]; blades: boolean}[]>();
// the same for the strip the blade cut along them, in meters per blade. With the strip's state at the end of the piece
// before and of this one, a stretch with the blades on goes on across pieces
const swathCache = new WeakMap<object, Map<string, {pieces: Point[][]; ends: Point[][]; before: SwathState | null; after: SwathState | null}>>();
// a piece of the strip as an svg path, per map geometry
const pieceDs = new WeakMap<object, {key: string; d: string}>();

const AREA_CLASS: Record<string, string> = {
  mow: styles.mowArea,
  nav: styles.navArea,
  obstacle: styles.obstacleArea,
  draft: styles.draftArea,
};
const OVERLAY_CLASS: Record<string, string> = {
  green: styles.overlayOutline,
  red: styles.overlayObstacle,
  blue: styles.overlayLive,
};
const LOUPE_PX = 120;
const LOUPE_ZOOM = 2.5;
// a finger on a point picks it up after resting this long, moving at once it pans the map: fingers are big and points
// close together, panning shouldn't drag one along by accident. A mouse picks it up right away
const HOLD_MS = 300;
// px a finger may wobble before it pans, a mouse 4
const TOUCH_SLOP = 8;
// "hold to move" when a finger slid off a point and panned instead (only fingers wait, a mouse picks it up at once),
// not more than every 20 s so panning across a few points doesn't keep bringing it up
let holdHintAt = 0;
function wantHoldHint() {
  if (Date.now() - holdHintAt < 20000) return false;
  holdHintAt = Date.now();
  return true;
}

const PADDING = 20;
const MOWER_SIZE = 0.4; // m
const WIDTH = 400;
// the svg while it glides along the mower: twice the frame, slid along by a transform
const GLIDING: React.CSSProperties = {position: 'absolute', left: 0, top: 0, width: '200%', height: '200%', transformOrigin: '0 0'};
const HEIGHT = 400;


type Fit = {scale: number; padX: number; padY: number; minX: number; minY: number};

// lines in meters as an svg path in the units of the fit
const pathOf = (lines: readonly (readonly Point[])[], f: Fit, close = false) =>
  lines
    .map((o) => o.map((p, i) => `${i ? 'L' : 'M'}${(p.x - f.minX) * f.scale + f.padX} ${HEIGHT - ((p.y - f.minY) * f.scale + f.padY)}`).join('') + (close ? 'Z' : ''))
    .join('');
// a point of an outline or of a line being drawn, or the middle of an edge (a new point there)
type Handle = {mid: boolean; index: number; x: number; y: number};
type Press = {pointerId: number; clientX: number; clientY: number; pointerType: string};
type Meters = {x: number; y: number; span: number};

// a view (center and width in meters) in svg units and back, for the map fitted as given
function viewFromMeters(m: Meters, f: Fit): View {
  const size = m.span * f.scale;
  return {x: (m.x - f.minX) * f.scale + f.padX - size / 2, y: HEIGHT - ((m.y - f.minY) * f.scale + f.padY) - size / 2, size};
}

function viewToMeters(v: View, f: Fit): Meters {
  return {x: (v.x + v.size / 2 - f.padX) / f.scale + f.minX, y: (HEIGHT - v.y - v.size / 2 - f.padY) / f.scale + f.minY, span: v.size / f.scale};
}

// the mower. It glides between the poses that come in and moves itself every frame for that without drawing again:
// its parts are drawn once around its position and the frame loop only moves and turns the groups they sit in. The rest
// of the map stays as it is meanwhile
function MowerMarker({
  mower,
  poses,
  fit,
  k,
  icons,
  body,
  outline,
  showIcon,
  emergency,
  blades,
  ghost,
  costume,
}: {
  mower: Pose;
  // the live poses as they came (useMowerPosition), else it eases along mower on its own
  poses: Easer | null;
  fit: Fit;
  k: number;
  icons: Settings['icons'];
  // the mower's sizes when set, its outline and blade drawn with outline
  body: MowerBody | null;
  outline: boolean;
  showIcon: boolean;
  emergency?: boolean;
  blades: boolean;
  // halloween night: a little ghost follows a moment behind while it drives
  ghost?: boolean;
  costume?: {hat?: boolean; towel?: boolean; umbrella?: boolean};
}) {
  const [own] = useState(createEaser);
  useEffect(() => {
    own.push(poses ? null : mower);
  }, [own, poses, mower]);
  // the blade turning the way the mow motor does, drawn only with the outline
  const rpm = useSensorValue('om_mow_motor_rpm', (v) => (outline && body?.blade ? Math.round(parseFloat(v ?? '') || 0) : 0));
  const speed = useComputedSpeed(mower);
  // which way a side view faces. it only turns once the mower clearly heads the other way, so it doesn't flicker while
  // the mower drives up or down the map
  const [facing, setFacing] = useState(1);
  const across = Math.cos(mower.heading);
  if (across > 0.3 && facing !== 1) setFacing(1);
  if (across < -0.3 && facing !== -1) setFacing(-1);
  const {scale} = fit;
  // the parts around the mower's position with it heading along x, in svg units (svg's y points down)
  const shape = body ? bodyShape(body, 0, 0, 0) : null;
  const local = (p: {x: number; y: number}): [number, number] => [p.x * scale, -p.y * scale];
  // at its real size with the sizes set the icon sits in the middle of the body, as long as it
  const real = icons?.mowerRealSize ? shape : null;
  // same size on screen like the dock, or its real size (never smaller than a few pixels)
  const realSize = body && real ? ((body.front + body.rear) / 2) * scale : MOWER_SIZE * scale;
  const base = icons?.mowerRealSize ? Math.max(realSize, 7 * k) : 8 * k;
  const size = base * (real ? 1 : (icons?.mowerSize ?? 1));
  const icon = mowerIcon(icons?.mower);
  // a real mower on its body, exactly as long and wide as set
  const fitted = showIcon && icon.fit && !!body && !!shape;
  // where the icon sits: the body's middle at real size or fitted to the body, else the mower's position
  const [mx, my] = shape && (fitted || real) ? local(shape.middle) : [0, 0];
  // a side view heading left would stand on its head, mirrored it keeps its feet on the ground. a figure
  // isn't turned with the heading at all, it only looks left or right. css, so it turns around instead of
  // flipping over at once
  const turn = !icon.side ? undefined : icon.upright ? `scaleX(${facing})` : `scaleY(${facing})`;
  const points = (list: {x: number; y: number}[]) => list.map((c) => local(c).join(',')).join(' ');
  const [bx, by] = shape ? local(shape.blade) : [0, 0];
  const r = body ? (body.blade / 2) * scale : 0;
  // OpenMower's rpm is negative when the motor turns the other way round (randomize_mow_motor_direction), forwards is
  // drawn clockwise
  const spin = Math.sign(rpm);
  const still = stillPreferred();

  // moved to the eased pose: all of it, the parts that turn with the heading (under the icon and over it), and the
  // ones that stay upright at the turned middle
  const moveRef = useRef<SVGGElement | null>(null);
  const turnRefs = useRef<(SVGGElement | null)[]>([]);
  const uprightRefs = useRef<(SVGGElement | null)[]>([]);
  const placed = useRef({sx: NaN, sy: NaN, deg: NaN});
  const latest = useRef({fit, k, mx, my, mower});
  // the time of the frame being shown: placed again after a render at that time, a later one would put it a bit ahead
  // until the next frame and it would twitch with every render
  const shownAt = useRef<number | null>(null);
  const place = useCallback(
    (now: number = shownAt.current ?? performance.now()) => {
      const {fit: f, k: unit, mx: ox, my: oy, mower: m} = latest.current;
      const p = (poses ?? own).at(now) ?? m;
      const sx = (p.x - f.minX) * f.scale + f.padX;
      const sy = HEIGHT - ((p.y - f.minY) * f.scale + f.padY);
      // svg y points down, so the map's ccw heading becomes a cw rotation
      const deg = (-p.heading * 180) / Math.PI;
      const last = placed.current;
      // (a fiftieth of a pixel, a twentieth of a degree: nothing is set again while it stands)
      if (Math.abs(sx - last.sx) < 0.02 * unit && Math.abs(sy - last.sy) < 0.02 * unit && Math.abs(deg - last.deg) < 0.05) return;
      placed.current = {sx, sy, deg};
      moveRef.current?.setAttribute('transform', `translate(${sx} ${sy})`);
      for (const g of turnRefs.current) g?.setAttribute('transform', `rotate(${deg})`);
      const a = (deg * Math.PI) / 180;
      const up = `translate(${ox * Math.cos(a) - oy * Math.sin(a)} ${ox * Math.sin(a) + oy * Math.cos(a)})`;
      for (const g of uprightRefs.current) g?.setAttribute('transform', up);
    },
    [poses, own],
  );
  // after every render: what's drawn may be new, it's placed before it shows
  useLayoutEffect(() => {
    latest.current = {fit, k, mx, my, mower};
    placed.current = {sx: NaN, sy: NaN, deg: NaN};
    place();
  });
  useEffect(() => {
    let frame = 0;
    const tick = (now: number) => {
      shownAt.current = now;
      place(now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [place]);

  const drawIcon = (
    <g className={styles.turn} style={turn ? {transform: turn} : undefined}>
      {drawMower(icon, {speed, emergency, blades})}
    </g>
  );
  return (
    <>
      <g ref={moveRef}>
        <g ref={(el) => void (turnRefs.current[0] = el)}>
          {outline && shape && <polygon className={styles.mowerBody} points={points(shape.corners)} />}
          {fitted ? (
            <g
              className={styles.mower}
              transform={`translate(${mx} ${my}) scale(${((body.front + body.rear) / 2) * scale} ${(body.width / 2) * scale})`}
            >
              {icon.draw({speed, emergency, blades})}
            </g>
          ) : (
            showIcon &&
            !icon.upright && (
              <g className={styles.mower} transform={`translate(${mx} ${my}) scale(${size})`}>
                {drawIcon}
              </g>
            )
          )}
        </g>
        {showIcon && !fitted && icon.upright && (
          <g ref={(el) => void (uprightRefs.current[0] = el)}>
            <g className={styles.mower} transform={`scale(${size})`}>
              {drawIcon}
            </g>
          </g>
        )}
        <g ref={(el) => void (turnRefs.current[1] = el)}>
          {/* the blade over the icon, where it sits under the mower */}
          {outline && shape && r > 0 && (
            <g transform={`translate(${bx} ${by})`}>
              <circle className={blades ? styles.mowerBladeOn : styles.mowerBlade} r={r} />
              {/* the blade itself, turning like the mow motor: svg's y points down, so a positive angle turns clockwise */}
              <g className={styles.mowerBladeBar}>
                <rect x={-r * 0.92} y={-r * 0.09} width={r * 1.84} height={r * 0.18} rx={r * 0.05} />
                <rect x={-r * 0.92} y={-r * 0.09} width={r * 0.3} height={r * 0.18} transform={`rotate(-20 ${-r * 0.77} 0)`} />
                <rect x={r * 0.62} y={-r * 0.09} width={r * 0.3} height={r * 0.18} transform={`rotate(-20 ${r * 0.77} 0)`} />
                {spin !== 0 && !still && (
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from="0 0 0"
                    to={`${spin * 360} 0 0`}
                    dur={`${bladeSeconds(rpm)}s`}
                    repeatCount="indefinite"
                  />
                )}
              </g>
            </g>
          )}
          {outline && shape && (
            <>
              {!showIcon && <polyline className={styles.mowerArrow} points={points(shape.arrow)} />}
              <circle className={styles.mowerAxle} cx={0} cy={0} r={1.5 * k} />
            </>
          )}
        </g>
        {showIcon && (costume?.hat || costume?.towel || costume?.umbrella) && (
          // upright over any icon, also one seen from above, at the size it's drawn
          <g ref={(el) => void (uprightRefs.current[1] = el)}>
            <g transform={`scale(${fitted ? ((body.front + body.rear) / 2) * scale : size})`} className={styles.costume}>
              <MapCostume hat={costume.hat} towel={costume.towel} umbrella={costume.umbrella} high={!!icon.side} />
            </g>
          </g>
        )}
      </g>
      {ghost && <MarkerGhost mower={mower} on={speed > 0.05} fit={fit} size={size} />}
    </>
  );
}

// halloween night: a little ghost follows a moment behind while it drives, drawn again every frame on its own
function MarkerGhost({mower, on, fit, size}: {mower: Pose; on: boolean; fit: Fit; size: number}) {
  const haunt = useTrailingPose(mower, on);
  if (!haunt) return null;
  const sx = (haunt.x - fit.minX) * fit.scale + fit.padX;
  const sy = HEIGHT - ((haunt.y - fit.minY) * fit.scale + fit.padY);
  return (
    <g transform={`translate(${sx} ${sy}) scale(${(size * 2.2) / 30})`} className={styles.ghost}>
      <g className={styles.ghostBob}>
        <MapGhost />
      </g>
    </g>
  );
}

function MapView({
  map,
  mower,
  emergency,
  selectedAreaId,
  onSelectArea,
  onMoveVertex,
  onDragStart,
  onDragging,
  onDragCancel,
  onInsertVertex,
  onDeleteVertex,
  onUndo,
  pickingPoints,
  pendingPoints,
  onCanvasClick,
  onMovePending,
  onInsertPending,
  follow = false,
  pin,
  followSpanMeters = 6,
  track,
  pastTrack,
  beforeTrack,
  progress,
  costume,
  zoomable = false,
  stripes,
  loops,
  openLoops,
  pieces,
  preview,
  overlay,
  markers,
  onMarkerPick,
  bodySpots,
  bodySpace,
  fitPlaces,
  fitPicked,
  onFitPick,
  turnPlaces,
  jumpPlaces,
  marginPlaces,
  focus,
  focusSpan,
  viewKey,
  onClickEmpty,
  datum,
  orderLabels,
  bodyOverride,
  allLayers,
}: MapViewProps) {
  useLang();
  const svgRef = useRef<SVGSVGElement | null>(null);
  // the svg isn't there on the first render while the map is still loading, so effects that need it
  // depend on this instead of running once on mount
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const attachSvg = useCallback((el: SVGSVGElement | null) => {
    svgRef.current = el;
    setSvgEl(el);
  }, []);
  // bounds frozen while dragging so the map doesn't rescale under the cursor
  const [dragging, setDragging] = useState<{areaId: string; index: number; bounds: Bounds} | null>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    touch: boolean;
    // an edge midpoint was grabbed, the new point only gets added once the finger moves (or on a tap)
    insert: {x: number; y: number} | null;
    // where the point was before, for putting a drawn point back
    orig: {x: number; y: number} | null;
  }>({pointerId: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false, touch: false, insert: null, orig: null});
  // finger position while dragging on touch, drives the loupe
  const [finger, setFinger] = useState<{x: number; y: number; width: number} | null>(null);
  // tapped point, gets a delete button
  const [active, setActive] = useState<{areaId: string; index: number} | null>(null);
  // the user's zoom and pan, center and width in meters: a map that changes size (a point dragged past the edge,
  // a new area drawn outside) rescales the drawing, but what's looked at stays put
  const [viewMeters, setViewMeters] = useState<Meters | null>(null);
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  // the view from the last visit, until zoomed, panned or reset. a spot to show wins over it
  const [restore, setRestore] = useState(() => (viewKey && !focus ? (savedViews.get(viewKey) ?? null) : null));
  // in follow mode zooming changes how many meters around the mower are shown
  const [followZoom, setFollowZoom] = useState(1);
  // follow mode switched off by hand, back on with the next drive
  const [free, setFree] = useState(false);
  if (free && !follow) setFree(false);
  const following = follow && !free;
  const prefs = useMapPrefs();
  const {imagery, setImagery, showGrid, toggleGrid, toggleLayer, planStyle, setPlanStyle, coverage: coverMode, setCoverage: setCoverMode} = prefs;
  const hidden = allLayers ? NO_LAYERS_HIDDEN : prefs.hidden;
  const [svgPx, setSvgPx] = useState(0);
  const [layersOpen, setLayersOpen] = useState(false);
  // MowBite's container on the mower: it keeps the gps log the coverage comes from
  const updates = useUpdates();
  // gps or wifi where the mower drove, asked for once the coverage is switched on. the square tapped shows its numbers
  const [coverage, setCoverage] = useState<CoverageCell[] | null>(null);
  const [coverCell, setCoverCell] = useState<CoverageCell | null>(null);
  const wantCoverage = coverMode !== 'off';
  // with the coverage shown the map is for looking: a tap shows a square's numbers, nothing is picked or moved
  const editing = coverMode === 'off';
  useEffect(() => {
    if (wantCoverage) void loadCoverage().then(setCoverage);
  }, [wantCoverage]);
  const pointers = useRef(new Map<number, {x: number; y: number}>());
  const gesture = useRef<{moved: boolean; pinchDist: number | null}>({moved: false, pinchDist: null});
  // while the map moves the grass and the leaves wait (Grass.module.css): behind the frosted cards each of their frames
  // blurs the cards again, and the map stutters
  const stillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moving = () => {
    const root = document.documentElement;
    if (!root.hasAttribute('data-map-moving')) root.setAttribute('data-map-moving', '');
    if (stillTimer.current) clearTimeout(stillTimer.current);
    stillTimer.current = setTimeout(() => {
      root.removeAttribute('data-map-moving');
      stillTimer.current = null;
    }, 400);
  };
  useEffect(
    () => () => {
      if (stillTimer.current) clearTimeout(stillTimer.current);
      document.documentElement.removeAttribute('data-map-moving');
    },
    [],
  );
  // a finger resting on a point, until it picks it up (HOLD_MS) or turns out to pan
  const hold = useRef<{press: Press; areaId: string; hit: Handle; timer: ReturnType<typeof setTimeout>} | null>(null);
  const dropHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  useEffect(() => () => dropHold(), []);
  // the mower glides on its own (MowerMarker), the view only goes along with it in follow mode: every frame by moving
  // the viewBox itself (below), a render of the whole map for every frame stuttered on phones. Both along the live poses
  // as they came when the mower is the live one, at the same frame time: the mower stays right in the middle
  const livePoses = liveGlide(mower);
  const followed = following && mower ? mower : null;
  const [followEaser] = useState(createEaser);
  useEffect(() => {
    followEaser.push(livePoses ? null : followed);
  }, [followEaser, followed, livePoses]);
  const ownBody = useMowerBody();
  const body = bodyOverride ?? ownBody;
  const plannerSettings = usePlannerSettings();

  // fitted to the map only, so the geometry doesn't change while the mower moves. follow mode
  // moves the view instead
  const fit = useMemo(() => {
    const points = [...map.areas.flatMap((a) => a.outline), ...(pendingPoints ?? [])];
    if (!points.length) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return {minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys)};
  }, [map, pendingPoints]);

  const center = followed ?? mower ?? {x: 0, y: 0};
  const {minX, maxX, minY, maxY}: Bounds = dragging?.bounds ??
    fit ?? {
      minX: center.x - followSpanMeters / 2,
      maxX: center.x + followSpanMeters / 2,
      minY: center.y - followSpanMeters / 2,
      maxY: center.y + followSpanMeters / 2,
    };

  const scaleX = (WIDTH - 2 * PADDING) / (maxX - minX || 1);
  const scaleY = (HEIGHT - 2 * PADDING) / (maxY - minY || 1);
  const scale = Math.min(scaleX, scaleY);
  // center whatever doesn't fill the square
  const padX = PADDING + (WIDTH - 2 * PADDING - (maxX - minX) * scale) / 2;
  const padY = PADDING + (HEIGHT - 2 * PADDING - (maxY - minY) * scale) / 2;

  // the view between meters and svg units. setView may run from the wheel handler set up earlier, so it takes
  // the fit from a ref the last render left
  const drawn: Fit = {scale, padX, padY, minX, minY};
  const fitRef = useRef(drawn);
  useEffect(() => {
    fitRef.current = {scale, padX, padY, minX, minY};
  }, [scale, padX, padY, minX, minY]);
  const view = viewMeters ? viewFromMeters(viewMeters, drawn) : null;
  const setView = (next: View | null | ((prev: View | null) => View)) =>
    setViewMeters((prev) => {
      const f = fitRef.current;
      const v = typeof next === 'function' ? next(prev ? viewFromMeters(prev, f) : null) : next;
      return v ? viewToMeters(v, f) : null;
    });

  // map y points north, svg y points down
  const toScreen = (x: number, y: number): [number, number] => [(x - minX) * scale + padX, HEIGHT - ((y - minY) * scale + padY)];
  const toLocal = (sx: number, sy: number): [number, number] => [(sx - padX) / scale + minX, (HEIGHT - sy - padY) / scale + minY];

  // about 12 m around the focus point (or what's asked for), until the user zooms or pans themselves
  const home: View | null = focus
    ? (() => {
        const [fx, fy] = toScreen(focus.x, focus.y);
        const size = Math.min(WIDTH, (focusSpan ?? 12) * scale);
        return {x: fx - size / 2, y: fy - size / 2, size};
      })()
    : null;

  const restored: View | null = restore
    ? (() => {
        const [cx, cy] = toScreen(restore.x, restore.y);
        const size = restore.span * scale;
        return {x: cx - size / 2, y: cy - size / 2, size};
      })()
    : null;

  // what's shown: the user's zoom, or in follow mode a window around the mower
  const base = view ?? restored ?? home;
  let shown = base;
  if (following && followed) {
    const [sx, sy] = toScreen(followed.x, followed.y);
    const size = followSpanMeters * followZoom * scale;
    shown = {x: sx - size / 2, y: sy - size / 2, size};
  }
  // following with the geometry fitted to the map: the map is drawn once for twice the window around an anchor and
  // only slid along under its frame every frame (a css transform, the phone's gpu moves it without drawing anything
  // again). Drawn again with a new anchor once the mower got too far from it. Each new viewBox drew the whole map again
  // and stuttered on phones
  const glides = zoomable && following && !!followed && !!fit;
  const glideSize = followSpanMeters * followZoom * scale;
  const [anchor, setAnchor] = useState<{x: number; y: number; size: number} | null>(null);
  const [gx, gy] =
    anchor && anchor.size === glideSize ? [anchor.x, anchor.y] : followed ? toScreen(followed.x, followed.y) : [0, 0];
  // what the svg shows while gliding, for the frame loop: the anchor in svg units and the window's size
  const glideRef = useRef<{x: number; y: number; size: number; fixed: boolean; asked: boolean} | null>(null);
  const anchored = !!anchor && anchor.size === glideSize;
  const frameRef = useRef<HTMLDivElement | null>(null);
  const lastSlide = useRef<[number, number] | null>(null);
  // the time of the frame being shown, slid again at that time after a render (see MowerMarker)
  const slidAt = useRef<number | null>(null);
  // slides the map so the eased mower is in the middle of the frame, asks for a new anchor when it gets near the edge
  // of what's drawn
  const slide = useCallback(
    (now: number = slidAt.current ?? performance.now()) => {
      const g = glideRef.current;
      const svg = svgRef.current;
      const frame = frameRef.current;
      const p = (livePoses ?? followEaser).at(now);
      if (!g || !svg || !frame || !p) return;
      const f = fitRef.current;
      const sx = (p.x - f.minX) * f.scale + f.padX;
      const sy = HEIGHT - ((p.y - f.minY) * f.scale + f.padY);
      const width = frame.clientWidth || 1;
      const unit = width / g.size;
      const tx = width / 2 - (sx - (g.x - g.size)) * unit;
      const ty = width / 2 - (sy - (g.y - g.size)) * unit;
      const last = lastSlide.current;
      if (!last || Math.abs(tx - last[0]) > 0.02 || Math.abs(ty - last[1]) > 0.02) {
        svg.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
        lastSlide.current = [tx, ty];
      }
      // (no anchor of its own yet it goes with the mower's position: kept where it is now)
      if (!g.asked && !g.fixed) {
        g.asked = true;
        setAnchor({x: g.x, y: g.y, size: g.size});
      } else if (!g.asked && (Math.abs(sx - g.x) > 0.35 * g.size || Math.abs(sy - g.y) > 0.35 * g.size)) {
        g.asked = true;
        setAnchor({x: sx, y: sy, size: g.size});
      }
    },
    [followEaser, livePoses],
  );
  // the anchor drawn and the slide that goes with it in the same frame, the map doesn't jump when it's drawn again
  useLayoutEffect(() => {
    glideRef.current = glides ? {x: gx, y: gy, size: glideSize, fixed: anchored, asked: false} : null;
    lastSlide.current = null;
    if (glides) slide();
    else if (svgRef.current) svgRef.current.style.transform = '';
  }, [glides, gx, gy, glideSize, anchored, slide]);
  useEffect(() => {
    if (!glides) return;
    let frame = 0;
    const tick = (now: number) => {
      slidAt.current = now;
      slide(now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [glides, slide]);

  // outlines as svg point strings, rebuilt only when the map or the fit changes, not every frame
  const outlinePoints = useMemo(() => {
    const out = new Map<string, string>();
    for (const a of map.areas) {
      out.set(a.id, a.outline.map((p) => `${(p.x - minX) * scale + padX},${HEIGHT - ((p.y - minY) * scale + padY)}`).join(' '));
    }
    return out;
  }, [map, minX, minY, scale, padX, padY]);
  // the garden style: each mowing area's lawn in stripes along its mowing direction, ways and obstacles as their
  // pictures, a thing (tree, pond ...) fitted into the box around the area and cut to its outline
  const garden = settings.mapStyle === 'garden';
  const uid = 'g' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const gardenLook = useMemo(() => {
    if (!garden) return null;
    const lawns = new Map<string, number>();
    const looks = new Map<string, Look>();
    const things = new Map<string, {i: number; look: Look; box: Box}>();
    const angles: number[] = [];
    const clips: string[] = [];
    for (const a of map.areas) {
      const type = a.properties.type;
      if (type === 'mow') {
        lawns.set(a.id, angles.length);
        angles.push(a.properties.angle ?? autoMowAngle(a.outline));
      } else if ((type === 'obstacle' || type === 'nav') && a.outline.length > 2) {
        const look = areaLook(a, settings.looks);
        looks.set(a.id, look);
        if (!isThing(look)) continue;
        const xs = a.outline.map((p) => (p.x - minX) * scale + padX);
        const ys = a.outline.map((p) => HEIGHT - ((p.y - minY) * scale + padY));
        const [x, y] = [Math.min(...xs), Math.min(...ys)];
        things.set(a.id, {i: clips.length, look, box: {x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y}});
        clips.push(outlinePoints.get(a.id) ?? '');
      }
    }
    return {lawns, looks, things, defs: <GardenDefs uid={uid} m={scale} lawns={angles} clips={clips} />};
  }, [garden, map, settings.looks, uid, scale, minX, minY, padX, padY, outlinePoints]);
  const gardenFill = (a: MapArea): React.CSSProperties | undefined => {
    if (!gardenLook) return undefined;
    const lawn = gardenLook.lawns.get(a.id);
    const look = gardenLook.looks.get(a.id);
    const fill =
      a.properties.type === 'mow' ? (a.properties.mowable === false ? 'meadow' : lawn !== undefined ? `lawn${lawn}` : null) : look ? groundOf(look) : null;
    return fill ? {fill: `url(#${uid}${fill})`, fillOpacity: 1} : undefined;
  };
  // the live trail cut where the blades go on or off, driving without them is drawn dashed. worked out per
  // piece and kept for pieces that didn't change, so a long trail costs the same as a short one while driving
  const trackRuns = useMemo(() => {
    const runs: Run[] = [];
    if (!track) return runs;
    const key = `${minX},${minY},${scale},${padX},${padY}`;
    const at = (p: Point) => `${(p.x - minX) * scale + padX},${HEIGHT - ((p.y - minY) * scale + padY)}`;
    for (const piece of track) {
      let byView = runCache.get(piece);
      if (!byView) runCache.set(piece, (byView = new Map()));
      let cached = byView.get(key);
      if (!cached) {
        let bent = bentCache.get(piece);
        if (!bent) {
          bent = [];
          let start = 0;
          for (let i = 1; i <= piece.length; i++) {
            if (i < piece.length && (piece[i].b ?? true) === (piece[start].b ?? true)) continue;
            // include the next point so the runs connect
            const pts = piece.slice(start, Math.min(i + 1, piece.length));
            if (pts.length >= 2) bent.push({points: roundBends(pts), blades: piece[start].b ?? true});
            start = i;
          }
          bentCache.set(piece, bent);
        }
        cached = bent.map((r) => ({points: r.points.map(at).join(' '), blades: r.blades}));
        // one entry per map size it's drawn at, the dashboard and the map page differ
        if (byView.size > 3) byView.clear();
        byView.set(key, cached);
      }
      runs.push(...cached);
    }
    return runs;
  }, [track, minX, minY, scale, padX, padY]);

  // the strip the blade cut along the live trail and a recorded job, with the mower's sizes set
  const swathOn = !!body?.blade && layerOn(hidden, 'swath');
  const swath = useMemo(() => {
    const out: {groups: string[]; ends: string} = {groups: [], ends: ''};
    if (!swathOn || !body) return out;
    const fitKey = `${minX},${minY},${scale},${padX},${padY}`;
    const at = (p: Point) => `${((p.x - minX) * scale + padX).toFixed(1)} ${(HEIGHT - ((p.y - minY) * scale + padY)).toFixed(1)}`;
    // a piece as a line of its own, or carrying on the line of the piece before (its first point is that one's last)
    const path = (pts: Point[], carryOn = false) => {
      const key = carryOn ? fitKey + '+' : fitKey;
      const known = pieceDs.get(pts);
      if (known?.key === key) return known.d;
      const d = carryOn ? pts.slice(1).map((p) => `L${at(p)}`).join('') : pts.map((p, i) => `${i ? 'L' : 'M'}${at(p)}`).join('');
      pieceDs.set(pts, {key, d});
      return d;
    };
    // one stretch with the blades on: its pieces, and the blade's round ends where it began and stopped. A stretch going
    // on from the piece of the trail before has no beginning here, one going on into the next piece no end: its state
    // at the end goes on there instead
    // the track as it was recorded: rounding its bends would bow the long straight steps of a lane to the side
    const strip = (pts: Point[], into: {pieces: Point[][]; ends: Point[][]}, before: SwathState | null = null, goesOn = false) => {
      const {pieces, state} = swathAfter(pts, body, before);
      into.pieces.push(...pieces);
      const first = pieces[0];
      if (!before?.end && first) into.ends.push(swathEnd(first[1], first[0], body.blade / 2));
      if (goesOn) return state;
      finish(state, into);
      return null;
    };
    // the end of a stretch, with the points that still wait for a heading
    const finish = (state: SwathState | null, into: {pieces: Point[][]; ends: Point[][]}) => {
      if (!state) return;
      const tail = swathTail(state, body);
      if (tail.length > 1) {
        into.pieces.push(tail);
        if (!state.end) into.ends.push(swathEnd(tail[1], tail[0], body.blade / 2));
        into.ends.push(swathEnd(tail[tail.length - 2], tail[tail.length - 1], body.blade / 2));
      } else if (state.end) into.ends.push(swathEnd(state.end[0], state.end[1], body.blade / 2));
    };
    const all: {pieces: Point[][]; ends: Point[][]} = {pieces: [], ends: []};
    const key = `${body.blade},${body.bladeAhead},${body.bladeOffset}`;
    let carried: SwathState | null = null;
    for (const piece of track ?? []) {
      let byBlade = swathCache.get(piece);
      if (!byBlade) swathCache.set(piece, (byBlade = new Map()));
      let cached = byBlade.get(key);
      if (!cached || cached.before !== carried) {
        cached = {pieces: [], ends: [], before: carried, after: null};
        // the stretches with the blades on, the first one going on from the piece before (it starts with that one's
        // last point)
        let start = -1;
        for (let i = 0; i <= piece.length; i++) {
          const on = i < piece.length && (piece[i].b ?? true);
          if (on && start < 0) start = i;
          if (!on && start >= 0) {
            cached.after = strip(piece.slice(start, i), cached, start === 0 ? carried : null, i === piece.length);
            start = -1;
          }
        }
        if (byBlade.size > 3) byBlade.clear();
        byBlade.set(key, cached);
      }
      carried = cached.after;
      all.pieces.push(...cached.pieces);
      all.ends.push(...cached.ends);
    }
    // the round end where the trail stops now with the blades on
    finish(carried, all);
    // a recorded track's strips are worked out once per segment, the live trail next to it changes all the time
    for (const seg of [...(pastTrack ?? []), ...(beforeTrack ?? [])]) {
      if (!seg.blades) continue;
      let byBlade = swathCache.get(seg);
      if (!byBlade) swathCache.set(seg, (byBlade = new Map()));
      let cached = byBlade.get(key);
      if (!cached) {
        cached = {pieces: [], ends: [], before: null, after: null};
        strip(seg.points, cached);
        byBlade.set(key, cached);
      }
      all.pieces.push(...cached.pieces);
      all.ends.push(...cached.ends);
    }
    // a few paths instead of one per piece, pieces that overlap in different ones
    const groups = swathGroups(all.pieces, body.blade);
    const ds: string[] = [];
    all.pieces.forEach((piece, i) => {
      const before = all.pieces[i - 1];
      const carryOn = !!before && groups[i - 1] === groups[i] && piece[0] === before[before.length - 1];
      ds[groups[i]] = (ds[groups[i]] ?? '') + path(piece, carryOn);
    });
    out.groups = ds.filter(Boolean);
    out.ends = all.ends.map((e) => path(e) + 'Z').join('');
    return out;
  }, [swathOn, body, track, pastTrack, beforeTrack, minX, minY, scale, padX, padY]);

  // the edges where the mower's body reached while the outlines were recorded with its middle
  const edgesOn = !!body && layerOn(hidden, 'edges');
  // what the collision check found and fixed in the plan shown
  const checksOn = layerOn(hidden, 'checks');
  // the room the body has, built again only when it or the view changes, not on every pan frame or position
  const bodySpacePath = useMemo(
    () => (bodySpace?.length ? pathOf(bodySpace, {scale, padX, padY, minX, minY}, true) : null),
    [bodySpace, scale, padX, padY, minX, minY],
  );
  // the places where the body came too close get their cm once the map shows less than about 12 m across
  const marginLabels = (shown?.size ?? WIDTH) / scale <= 12;
  const edges = useMemo(() => {
    if (!edgesOn || !body) return null;
    const at = (p: Point) => `${((p.x - minX) * scale + padX).toFixed(1)} ${(HEIGHT - ((p.y - minY) * scale + padY)).toFixed(1)}`;
    const ring = (o: Point[]) => o.map((p, i) => `${i ? 'L' : 'M'}${at(p)}`).join('') + 'Z';
    const {lawn, obstacles, grass} = realEdges(map.areas, body);
    const inObstacles = !hidden.has('obstacle');
    return {
      line: [...lawn, ...(inObstacles ? obstacles : [])].map(ring).join(''),
      // the lawn between the lines and the real edges: outside the mowing areas under them, in the obstacles over them
      grassOutside: grass.outside.map(ring).join(''),
      grassObstacles: inObstacles ? grass.obstacles.map(ring).join('') : '',
    };
  }, [edgesOn, body, map, hidden, minX, minY, scale, padX, padY]);

  // the plan and the tracks only change with their data, panning and zooming just move the viewBox: kept as they are,
  // a frame of a gesture doesn't build hundreds of paths again
  // with the plan in pieces the outline passes and lanes are one path, the turns and the drives between the parts
  // their own, each switched off on its own
  const turnsOn = layerOn(hidden, 'planTurns');
  const transitOn = layerOn(hidden, 'planTransit');
  const piecePaths = useMemo(() => {
    if (!pieces?.length) return null;
    const of = (types: PlanPiece['type'][]) => {
      const list = pieces.filter((q) => types.includes(q.type)).map((q) => q.points);
      return list.length ? pathOf(list, {minX, minY, scale, padX, padY}) : '';
    };
    return {mowed: of(['perimeter', 'lane']), turns: of(['turn']), transit: of(['transit'])};
  }, [pieces, minX, minY, scale, padX, padY]);
  const stripesPath = useMemo(
    () => (!piecePaths && stripes?.length ? pathOf(stripes, {minX, minY, scale, padX, padY}) : ''),
    [piecePaths, stripes, minX, minY, scale, padX, padY],
  );
  const loopsPath = useMemo(
    () => (!piecePaths && loops?.length ? pathOf(loops, {minX, minY, scale, padX, padY}, !openLoops) : ''),
    [piecePaths, loops, openLoops, minX, minY, scale, padX, padY],
  );
  const todoPath = useMemo(
    () => (progress ? pathOf(progress.todo, {minX, minY, scale, padX, padY}) : null),
    [progress, minX, minY, scale, padX, padY],
  );
  const swathLayer = useMemo(
    () =>
      swath.groups.length > 0 && body ? (
        <g className={styles.swath} strokeWidth={body.blade * scale}>
          {swath.groups.map((d, i) => (
            <path key={'swath' + i} d={d} />
          ))}
          <path className={styles.swathEnd} d={swath.ends} />
        </g>
      ) : null,
    [swath, body, scale],
  );
  const coverLayer = useMemo(() => {
    if (!coverage || coverMode === 'off') return null;
    const size = CELL_M * scale;
    return (
      // taps go through to the map, areas stay selectable: the square under a tap is found there (onClick of the svg)
      // faded while an area is being edited, its points and lines stay clear on top
      <g className={[styles.cover, styles.coverQuiet, selectedAreaId || pickingPoints ? styles.coverFaded : ''].join(' ')}>
        {coverage
          .filter((c) => c.seconds >= MIN_SECONDS)
          .map((c) => {
            const grade = coverMode === 'gps' ? gpsGrade(c) : wifiGrade(c);
            if (!grade) return null;
            const [x, y] = toScreen(c.x, c.y + CELL_M);
            return (
              <rect
                key={`${c.x} ${c.y}`}
                className={[styles[grade], coverCell === c ? styles.coverPicked : ''].join(' ')}
                // paler where there's little to go by, full from two minutes on
                opacity={0.2 + 0.45 * Math.min(1, c.seconds / 120)}
                x={x}
                y={y}
                width={size}
                height={size}
              />
            );
          })}
      </g>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverage, coverMode, coverCell, pickingPoints, selectedAreaId, minX, minY, scale, padX, padY]);
  const halloween = useHalloween();
  // the mow before, only drawn again when it or the fit changes, not with every point of the trail
  const beforeLines = useMemo(
    () =>
      (beforeTrack ?? [])
        .filter((seg) => seg.blades && seg.points.length >= 2)
        .map((seg) =>
          roundBends(seg.points)
            .map((p) => `${(p.x - minX) * scale + padX},${HEIGHT - ((p.y - minY) * scale + padY)}`)
            .join(' '),
        ),
    [beforeTrack, minX, minY, scale, padX, padY],
  );
  const trackLayer = useMemo(
    () =>
      hidden.has('track') ? null : (
        // halloween night the track glows like ectoplasm
        <g className={halloween.night ? styles.spooky : undefined}>
          {beforeLines.map((points, i) => (
            <polyline key={'before' + i} points={points} className={styles.trackBefore} />
          ))}
          {trackRuns
            .filter((run) => run.blades || !hidden.has('transit'))
            .map((run, i) => (
              <polyline key={'run' + i} points={run.points} className={run.blades ? styles.track : styles.transit} />
            ))}
          {pastTrack?.map((seg, i) =>
            seg.points.length >= 2 && (seg.blades || !hidden.has('transit')) ? (
              <polyline
                key={'past' + i}
                points={roundBends(seg.points)
                  .map((p) => `${(p.x - minX) * scale + padX},${HEIGHT - ((p.y - minY) * scale + padY)}`)
                  .join(' ')}
                className={seg.blades ? styles.track : styles.transit}
              />
            ) : null,
          )}
        </g>
      ),
    [hidden, trackRuns, pastTrack, beforeLines, minX, minY, scale, padX, padY, halloween.night],
  );

  const selectedArea = map.areas.find((a) => a.id === selectedAreaId);
  const activeIndex =
    active && selectedArea && active.areaId === selectedArea.id && active.index < selectedArea.outline.length
      ? active.index
      : null;

  // deleting the tapped point: its button next to it, the Delete key (Backspace on keyboards without one), and for a
  // moment a way back
  const [deletedAt, setDeletedAt] = useState<number | null>(null);
  const deletable = !!selectedArea && activeIndex !== null && !!onDeleteVertex && selectedArea.outline.length > 3;
  const deletePoint = () => {
    if (!deletable) return;
    onDeleteVertex!(selectedArea!.id, activeIndex!);
    setActive(null);
    if (onUndo) setDeletedAt(Date.now());
  };
  useEffect(() => {
    if (!deletable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
      e.preventDefault();
      deletePoint();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    if (deletedAt === null) return;
    const t = setTimeout(() => setDeletedAt(null), 5000);
    return () => clearTimeout(t);
  }, [deletedAt]);
  const [holdHint, setHoldHint] = useState(false);
  useEffect(() => {
    if (!holdHint) return;
    const t = setTimeout(() => setHoldHint(false), 2500);
    return () => clearTimeout(t);
  }, [holdHint]);

  // keeps handles the same size at any zoom
  const k = shown ? shown.size / WIDTH : 1;
  const pxPerMeter = scale / k;

  const clientToSvg = (clientX: number, clientY: number): [number, number] | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return [local.x, local.y];
  };

  const clientToLocal = (clientX: number, clientY: number): [number, number] | null => {
    const p = clientToSvg(clientX, clientY);
    return p ? toLocal(p[0], p[1]) : null;
  };

  // big areas first so small ones on top stay clickable
  const areasBySize = useMemo(
    () => [...map.areas].sort((a, b) => polygonArea(b.outline) - polygonArea(a.outline)),
    [map],
  );

  // clicking the selected area again goes to the next one underneath
  const selectAt = (clickedId: string, clientX: number, clientY: number) => {
    const local = clientToLocal(clientX, clientY);
    if (clickedId !== selectedAreaId || !local) {
      onSelectArea?.(clickedId);
      return;
    }
    const stack = areasBySize.filter((a) => containsPoint(a.outline, local[0], local[1])).reverse();
    const i = stack.findIndex((a) => a.id === selectedAreaId);
    if (stack.length > 1) onSelectArea?.(stack[(i + 1) % stack.length].id);
  };

  // midpoints are only offered where there's room for them
  const showMidpoint = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y) * pxPerMeter >= 30;

  // nearest vertex or edge midpoint within finger/mouse reach, handles themselves are too small to hit
  const pickHandle = (clientX: number, clientY: number, touch: boolean) => {
    const svg = svgRef.current;
    const local = clientToLocal(clientX, clientY);
    if (!svg || !local || !selectedArea || !onMoveVertex || pickingPoints) return null;

    const reach = (touch ? 22 : 12) / ((pxPerMeter * svg.getBoundingClientRect().width) / WIDTH);
    const o = selectedArea.outline;
    let best: Handle | null = null;
    let bestDist = reach;

    o.forEach((p, i) => {
      const d = Math.hypot(p.x - local[0], p.y - local[1]);
      if (d < bestDist) {
        bestDist = d;
        best = {mid: false, index: i, x: p.x, y: p.y};
      }
      const next = o[(i + 1) % o.length];
      if (!onInsertVertex || !showMidpoint(p, next)) return;
      const mx = (p.x + next.x) / 2;
      const my = (p.y + next.y) / 2;
      const dm = Math.hypot(mx - local[0], my - local[1]);
      if (dm < bestDist) {
        bestDist = dm;
        best = {mid: true, index: i, x: mx, y: my};
      }
    });
    return best as Handle | null;
  };

  // same for the points of a line that's being drawn (split, new area)
  const pickPending = (clientX: number, clientY: number, touch: boolean) => {
    const svg = svgRef.current;
    const local = clientToLocal(clientX, clientY);
    if (!svg || !local || !pickingPoints || !pendingPoints?.length || !onMovePending) return null;

    const reach = (touch ? 22 : 12) / ((pxPerMeter * svg.getBoundingClientRect().width) / WIDTH);
    let best: Handle | null = null;
    let bestDist = reach;
    pendingPoints.forEach((p, i) => {
      const d = Math.hypot(p.x - local[0], p.y - local[1]);
      if (d < bestDist) {
        bestDist = d;
        best = {mid: false, index: i, x: p.x, y: p.y};
      }
      const next = pendingPoints[i + 1];
      if (!next || !onInsertPending || !showMidpoint(p, next)) return;
      const mx = (p.x + next.x) / 2;
      const my = (p.y + next.y) / 2;
      const dm = Math.hypot(mx - local[0], my - local[1]);
      if (dm < bestDist) {
        bestDist = dm;
        best = {mid: true, index: i, x: mx, y: my};
      }
    });
    return best as Handle | null;
  };
  // a press on a marker near a point of the area being edited moves the point: the marker only takes it otherwise
  const grabbable = (e: React.PointerEvent) =>
    editing &&
    !!(pickPending(e.clientX, e.clientY, e.pointerType !== 'mouse') || (selectedArea && pickHandle(e.clientX, e.clientY, e.pointerType !== 'mouse')));


  // zoom by factor (<1 = in) keeping the svg point (px, py) where it is on screen
  const zoomAt = (factor: number, px: number, py: number) => {
    moving();
    if (following) {
      setFollowZoom((z) => Math.min(8, Math.max(0.25, z * factor)));
      return;
    }
    setView((prev) => {
      const v = prev ?? base ?? {x: 0, y: 0, size: WIDTH};
      const size = Math.min(WIDTH * 4, Math.max(WIDTH / MAX_ZOOM, v.size * factor));
      const f = size / v.size;
      return {x: px - (px - v.x) * f, y: py - (py - v.y) * f, size};
    });
  };

  const zoomCenter = (factor: number) => {
    const v = base ?? {x: 0, y: 0, size: WIDTH};
    zoomAt(factor, v.x + v.size / 2, v.y + v.size / 2);
  };

  // the width the map takes on screen: the frame's, the svg is twice as big while it glides
  useEffect(() => {
    const el = frameRef.current ?? svgEl;
    if (!el) return;
    const ro = new ResizeObserver(() => setSvgPx(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [svgEl]);

  useEffect(() => {
    const svg = svgEl;
    if (!zoomable || !svg) return;

    // react's onWheel is passive, can't preventDefault the page scroll there
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = clientToSvg(e.clientX, e.clientY);
      if (p) zoomAt(Math.exp(e.deltaY * 0.0015), p[0], p[1]);
    };
    svg.addEventListener('wheel', onWheel, {passive: false});
    return () => svg.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoomAt only uses setters and following
  }, [zoomable, following, svgEl]);

  useEffect(() => {
    if (viewKey && viewMeters) savedViews.set(viewKey, viewMeters);
  }, [viewKey, viewMeters]);

  const startDrag = (e: Press, areaId: string, hit: Handle) => {
    const at = {x: hit.x, y: hit.y};
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      touch: e.pointerType !== 'mouse',
      insert: hit.mid ? at : null,
      orig: hit.mid ? null : at,
    };
    gesture.current.moved = true; // eat the click that follows
    if (e.pointerType === 'touch') tick();
    setDragging({areaId, index: hit.mid ? hit.index + 1 : hit.index, bounds: {minX, maxX, minY, maxY}});
  };

  // a second finger while a point is held means the first one was the start of a pinch
  const cancelDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    const d = drag.current;
    if (d.moved) {
      if (dragging.areaId !== PENDING) onDragCancel?.();
      else if (d.orig) onMovePending?.(dragging.index, d.orig.x, d.orig.y);
    }
    setDragging(null);
    setFinger(null);
    setActive(null);
    const first = d.pointerId;
    d.pointerId = -1;
    if (!zoomable) return;
    pointers.current.clear();
    pointers.current.set(first, {x: d.lastX, y: d.lastY});
    pointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
    gesture.current = {moved: true, pinchDist: null};
  };

  // a tap on a point (a finger let go before it picked it up): like a click on it, the point gets its delete button,
  // the middle of an edge a new point
  const tapHandle = (areaId: string, hit: Handle) => {
    gesture.current.moved = true; // not a click on the map as well
    if (hit.mid) {
      if (areaId === PENDING) onInsertPending?.(hit.index + 1, hit.x, hit.y);
      else onInsertVertex?.(areaId, hit.index + 1, hit.x, hit.y);
      setActive(null);
    } else if (areaId !== PENDING) {
      const same = active?.areaId === areaId && active.index === hit.index;
      setActive(same ? null : {areaId, index: hit.index});
    }
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const touch = e.pointerType !== 'mouse';
    if (dragging) {
      if (touch && drag.current.touch && e.pointerId !== drag.current.pointerId) cancelDrag(e);
      return;
    }
    // a second finger while one rests on a point: a pinch
    if (hold.current && e.pointerId !== hold.current.press.pointerId) dropHold();

    const pendingHit = editing && pointers.current.size === 0 ? pickPending(e.clientX, e.clientY, touch) : null;
    const hit = editing && !pendingHit && selectedArea && pointers.current.size === 0 ? pickHandle(e.clientX, e.clientY, touch) : null;
    const grab = pendingHit ? {areaId: PENDING, hit: pendingHit} : hit && selectedArea ? {areaId: selectedArea.id, hit} : null;
    if (grab && (e.pointerType !== 'touch' || !zoomable)) {
      startDrag(e, grab.areaId, grab.hit);
      return;
    }
    if (grab) {
      const press = {pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType};
      hold.current = {
        press,
        ...grab,
        timer: setTimeout(() => {
          const h = hold.current;
          hold.current = null;
          if (!h) return;
          // the finger stays on the point: from now on it moves the point, not the map
          pointers.current.delete(h.press.pointerId);
          startDrag(h.press, h.areaId, h.hit);
        }, HOLD_MS),
      };
    }

    if (!zoomable) return;
    pointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (pointers.current.size === 1) gesture.current = {moved: false, pinchDist: null};
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!zoomable || !prev || dragging) return;
    const svg = svgRef.current;
    if (!svg) return;

    pointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
    const pts = [...pointers.current.values()];

    if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = clientToSvg((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      if (gesture.current.pinchDist && mid) zoomAt(gesture.current.pinchDist / dist, mid[0], mid[1]);
      gesture.current = {moved: true, pinchDist: dist};
      return;
    }

    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (!gesture.current.moved && Math.hypot(dx, dy) < (e.pointerType === 'touch' ? TOUCH_SLOP : 4)) {
      // not a pan yet, don't eat the click
      pointers.current.set(e.pointerId, prev);
      return;
    }
    gesture.current.moved = true;
    // a finger that rested on a point and moves away pans, it doesn't pick the point up any more
    if (hold.current && wantHoldHint()) setHoldHint(true);
    dropHold();
    if (following) return; // the view is pinned to the mower
    const v = base ?? {x: 0, y: 0, size: WIDTH};
    const unitsPerPx = v.size / svg.getBoundingClientRect().width;
    moving();
    setView({...v, x: v.x - dx * unitsPerPx, y: v.y - dy * unitsPerPx});
  };

  const onPointerEnd = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current.pinchDist = null;
    const h = hold.current;
    if (h && h.press.pointerId === e.pointerId) {
      dropHold();
      if (e.type === 'pointerup' && !gesture.current.moved) tapHandle(h.areaId, h.hit);
    }
  };

  useEffect(() => {
    if (!dragging) return;

    const addPoint = (x: number, y: number) => {
      if (dragging.areaId === PENDING) onInsertPending?.(dragging.index, x, y);
      else onInsertVertex?.(dragging.areaId, dragging.index, x, y);
    };

    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (e.pointerId !== d.pointerId) return;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      if (!d.moved) {
        // a finger needs a bit more way, so the second finger of a pinch comes in before anything changes
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < (d.touch ? 10 : 4)) return;
        d.moved = true;
        // adding a point takes its own undo snapshot, drawn points aren't in the map history at all
        if (d.insert) addPoint(d.insert.x, d.insert.y);
        else if (dragging.areaId !== PENDING) onDragStart?.();
        if (dragging.areaId !== PENDING) onDragging?.(true);
      }
      const local = clientToLocal(e.clientX, e.clientY);
      if (local && dragging.areaId === PENDING) onMovePending?.(dragging.index, local[0], local[1]);
      else if (local) onMoveVertex?.(dragging.areaId, dragging.index, local[0], local[1]);
      const rect = svgRef.current?.getBoundingClientRect();
      if (d.touch && rect) setFinger({x: e.clientX - rect.left, y: e.clientY - rect.top, width: rect.width});
    };
    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      if (e.pointerId !== d.pointerId) return;
      // handled, a repeated up for the same finger does nothing
      d.pointerId = -1;
      if (!d.moved && d.insert) {
        // a tap on an edge midpoint adds the point there
        addPoint(d.insert.x, d.insert.y);
        setActive(null);
      } else if (!d.moved && dragging.areaId !== PENDING) {
        const same = active?.areaId === dragging.areaId && active.index === dragging.index;
        setActive(same ? null : {areaId: dragging.areaId, index: dragging.index});
      } else {
        setActive(null);
      }
      setDragging(null);
      setFinger(null);
      onDragging?.(false);
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== drag.current.pointerId) return;
      drag.current.pointerId = -1;
      setDragging(null);
      setFinger(null);
      onDragging?.(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, scale, minX, minY]);

  if (map.areas.length === 0 && !mower && !pendingPoints?.length) return null;


  const sources = datum ? availableSources(datum, settings.imagery) : [];
  const source = imagery && sources.length ? (sources.includes(imagery) ? imagery : sources[0]) : null;
  let tiles: ReturnType<typeof imageryTiles> = [];
  if (zoomable && datum && source && svgPx > 0) {
    const v = shown ?? {x: 0, y: 0, size: WIDTH};
    const [left, bottom] = toLocal(v.x, v.y + v.size);
    const [right, top] = toLocal(v.x + v.size, v.y);
    const metersPerPixel = 1 / ((pxPerMeter * svgPx) / WIDTH);
    tiles = imageryTiles(source, datum, {left, right, bottom, top, metersPerPixel}, settings.imagery);
  }

  let grid: ReturnType<typeof meterGrid> | null = null;
  if (zoomable && showGrid) {
    const v = shown ?? {x: 0, y: 0, size: WIDTH};
    const [left, bottom] = toLocal(v.x, v.y + v.size);
    const [right, top] = toLocal(v.x + v.size, v.y);
    grid = meterGrid({left, right, bottom, top}, pxPerMeter);
  }

  const vertexR = selectedArea ? handleRadius(selectedArea.outline, pxPerMeter) : 2.5;

  // k = svg units per screen unit, the loupe passes its own so handles don't get magnified
  const renderContent = (k: number) => (
    <>
      {tiles.length > 0 && (
        <g className={styles.imagery}>
          {tiles.map((t) => {
            const [p0, p1, p2] = t.corners.map((c) => toScreen(c.x, c.y));
            const m = [p1[0] - p0[0], p1[1] - p0[1], p2[0] - p0[0], p2[1] - p0[1], p0[0], p0[1]].join(' ');
            return (
              <image key={t.href} href={t.href} width={1} height={1} preserveAspectRatio="none" transform={`matrix(${m})`} />
            );
          })}
        </g>
      )}
        {edges?.grassOutside && <path className={styles.realGrass} d={edges.grassOutside} />}
        {areasBySize.filter((area) => !hidden.has(area.properties.type as Layer)).map((area) => {
          const thing = gardenLook?.things.get(area.id);
          return (
            <Fragment key={area.id}>
              <polygon
                points={outlinePoints.get(area.id)}
                className={[
                  AREA_CLASS[area.properties.type ?? 'draft'] ?? styles.draftArea,
                  area.properties.active === false ? styles.inactive : '',
                  area.properties.mowable === false ? styles.skipMowing : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={gardenFill(area)}
                data-area
                onClick={(e) => {
                  if (!pickingPoints && editing) selectAt(area.id, e.clientX, e.clientY);
                }}
              />
              {thing && isThing(thing.look) && (
                <g
                  className={[styles.gardenThing, area.properties.active === false ? styles.gardenOff : ''].filter(Boolean).join(' ')}
                  clipPath={`url(#${uid}clip${thing.i})`}
                >
                  {drawThing(thing.look, thing.box)}
                </g>
              )}
            </Fragment>
          );
        })}
        {edges?.grassObstacles && <path className={styles.realGrass} d={edges.grassObstacles} />}

        {coverLayer}

        {loopsPath && !hidden.has('stripes') && <path className={styles.stripes} d={loopsPath} />}
        {stripesPath && !hidden.has('stripes') && <path className={styles.stripes} d={stripesPath} />}
        {piecePaths && !hidden.has('stripes') && (
          <>
            {piecePaths.mowed && <path className={styles.stripes} d={piecePaths.mowed} />}
            {turnsOn && piecePaths.turns && <path className={styles.stripes} d={piecePaths.turns} />}
            {transitOn && piecePaths.transit && <path className={styles.planTransit} d={piecePaths.transit} />}
          </>
        )}

        {selectedArea && (
          <polygon
            points={selectedArea.outline.map((p) => toScreen(p.x, p.y).join(',')).join(' ')}
            className={styles.selected}
          />
        )}

        {orderLabels &&
          !hidden.has('order') &&
          map.areas.map((area) => {
            const n = orderLabels[area.id];
            if (!n || !area.outline.length) return null;
            const cx = area.outline.reduce((s, p) => s + p.x, 0) / area.outline.length;
            const cy = area.outline.reduce((s, p) => s + p.y, 0) / area.outline.length;
            const [sx, sy] = toScreen(cx, cy);
            return (
              <g key={'n' + area.id} className={styles.orderLabel}>
                <circle cx={sx} cy={sy} r={8 * k} />
                <text x={sx} y={sy} fontSize={10 * k} dy="0.35em">
                  {n}
                </text>
              </g>
            );
          })}

        {grid && (
          <g className={styles.grid}>
            {grid.xs.map((x) => {
              const sx = toScreen(x, 0)[0];
              return <line key={'x' + x} x1={sx} x2={sx} y1={-10 * HEIGHT} y2={11 * HEIGHT} />;
            })}
            {grid.ys.map((y) => {
              const sy = toScreen(0, y)[1];
              return <line key={'y' + y} x1={-10 * WIDTH} x2={11 * WIDTH} y1={sy} y2={sy} />;
            })}
          </g>
        )}

        {map.docking_stations.map((station) => {
          const [sx, sy] = toScreen(station.position.x, station.position.y);
          const icon = dockIcon(settings.icons?.dock);
          if (icon.real) {
            // a real station at its real size under the docked mower, its pins at the mower's front (as big as the
            // other icons at least)
            const {length, pins} = icon.real;
            const ahead = (body?.front ?? 0.43) + pins - length / 2;
            const c = toScreen(station.position.x + Math.cos(station.heading) * ahead, station.position.y + Math.sin(station.heading) * ahead);
            const half = Math.max((length / 2) * scale, 8 * k * (settings.icons?.dockSize ?? 1));
            return (
              <g
                key={station.id}
                className={styles.dock}
                transform={`translate(${c.join(' ')}) rotate(${(-station.heading * 180) / Math.PI}) scale(${half})`}
              >
                {icon.draw()}
              </g>
            );
          }
          return (
            <g key={station.id} className={styles.dock} transform={`translate(${sx} ${sy}) scale(${8 * k * (settings.icons?.dockSize ?? 1)})`}>
              {icon.draw()}
            </g>
          );
        })}

        {edges?.line && <path className={styles.realEdge} d={edges.line} />}

        {todoPath && !hidden.has('stripes') && <path className={[styles.planTodo, styles[planStyle]].join(' ')} d={todoPath} />}

        {swathLayer}

        {trackLayer}

        {mower && (
          <MowerMarker
            mower={mower}
            poses={livePoses}
            fit={drawn}
            k={k}
            icons={settings.icons}
            body={body}
            // without the icon the outline shows where the mower is
            outline={!!body && (layerOn(hidden, 'body') || !layerOn(hidden, 'mowerIcon'))}
            showIcon={!body || layerOn(hidden, 'mowerIcon')}
            emergency={emergency}
            blades={track?.at(-1)?.at(-1)?.b === true}
            ghost={halloween.night}
            costume={{hat: halloween.day, towel: costume?.towel, umbrella: costume?.umbrella}}
          />
        )}

        {selectedArea && !pickingPoints && (
          <>
            {onInsertVertex &&
              selectedArea.outline.map((p, i) => {
                const next = selectedArea.outline[(i + 1) % selectedArea.outline.length];
                if (!showMidpoint(p, next)) return null;
                const [sx, sy] = toScreen((p.x + next.x) / 2, (p.y + next.y) / 2);
                return <circle key={i} cx={sx} cy={sy} r={2 * k} className={styles.midpoint} />;
              })}

            {selectedArea.outline.map((p, i) => {
              const [sx, sy] = toScreen(p.x, p.y);
              return (
                <circle
                  key={i}
                  cx={sx}
                  cy={sy}
                  r={(i === activeIndex ? 4 : vertexR) * k}
                  className={i === activeIndex ? styles.activeVertex : styles.vertex}
                />
              );
            })}
          </>
        )}

        {overlay?.map((line, i) => {
          if (line.points.length < 2) return null;
          const pts = line.points.map((p) => toScreen(p.x, p.y).join(',')).join(' ');
          const cls = OVERLAY_CLASS[line.color] ?? styles.overlayLive;
          return line.closed ? (
            <polygon key={'ov' + i} points={pts} className={cls} />
          ) : (
            <polyline key={'ov' + i} points={pts} className={cls} />
          );
        })}

        {preview?.map((piece, i) => (
          <polygon
            key={'piece' + i}
            points={piece.map((p) => toScreen(p.x, p.y).join(',')).join(' ')}
            className={[styles.pieceA, styles.pieceB, styles.pieceC][i] ?? styles.pieceB}
          />
        ))}

        {pendingPoints && pendingPoints.length >= 2 && (
          <polyline
            points={pendingPoints.map((p) => toScreen(p.x, p.y).join(',')).join(' ')}
            className={styles.splitLine}
          />
        )}
        {onInsertPending &&
          pendingPoints?.slice(1).map((next, i) => {
            const p = pendingPoints[i];
            if (!showMidpoint(p, next)) return null;
            const [sx, sy] = toScreen((p.x + next.x) / 2, (p.y + next.y) / 2);
            return <circle key={'m' + i} cx={sx} cy={sy} r={2.5 * k} className={styles.midpoint} />;
          })}
        {pendingPoints?.map((p, i) => {
          const [sx, sy] = toScreen(p.x, p.y);
          return <circle key={i} cx={sx} cy={sy} r={5 * k} className={styles.splitPoint} />;
        })}
    </>
  );

  const svg = (
    <svg
      ref={attachSvg}
      className={[styles.svg, zoomable ? styles.zoomable : '', garden ? styles.garden : ''].filter(Boolean).join(' ')}
      // (gliding along the mower: twice the window around the anchor, slid along under the frame above)
      viewBox={
        glides
          ? `${gx - glideSize} ${gy - glideSize} ${2 * glideSize} ${2 * glideSize}`
          : shown
            ? `${shown.x} ${shown.y} ${shown.size} ${shown.size}`
            : `0 0 ${WIDTH} ${HEIGHT}`
      }
      style={glides ? GLIDING : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={(e) => {
        // swallow the click at the end of a pan/pinch
        if (gesture.current.moved) {
          e.stopPropagation();
          gesture.current.moved = false;
        }
      }}
      onDoubleClick={(e) => {
        if (!editing) return;
        const hit = pickHandle(e.clientX, e.clientY, false);
        if (hit && !hit.mid && selectedArea && selectedArea.outline.length > 3) {
          onDeleteVertex?.(selectedArea.id, hit.index);
          setActive(null);
        }
      }}
      onClick={(e) => {
        setActive(null);
        // with the coverage on, a tap also shows the numbers of the square under it (or closes them off the squares)
        if (!pickingPoints && coverMode !== 'off' && coverage) {
          const local = clientToLocal(e.clientX, e.clientY);
          const c = local
            ? coverage.find((q) => q.seconds >= MIN_SECONDS && local[0] >= q.x && local[0] < q.x + CELL_M && local[1] >= q.y && local[1] < q.y + CELL_M)
            : undefined;
          setCoverCell(c && c !== coverCell ? c : null);
        }
        if (!pickingPoints && !(e.target as Element).closest('[data-area]')) onClickEmpty?.();
        if (!pickingPoints || !onCanvasClick || !editing) return;
        const local = clientToLocal(e.clientX, e.clientY);
        if (local) onCanvasClick(local[0], local[1]);
      }}
    >
      {gardenLook?.defs}
      {renderContent(k)}
      {checksOn && bodySpacePath && <path className={styles.bodySpace} d={bodySpacePath} />}
      {/* small and the same size at any zoom, the plan stays readable under them */}
      {checksOn &&
        turnPlaces?.map((p, i) => {
          const [x, y] = toScreen(p.x, p.y);
          return <circle key={'turn' + i} className={styles.turnPlace} cx={x} cy={y} r={4 * k} />;
        })}
      {checksOn &&
        body &&
        fitPlaces?.[fitPicked ?? -1]?.pose &&
        (() => {
          const pose = fitPlaces[fitPicked!].pose!;
          const shape = bodyShape(body, pose.x, pose.y, pose.yaw);
          // turning on the spot the body sweeps round the rear axle: how far its farthest point reaches then
          const reach = Math.max(...shape.corners.map((c) => Math.hypot(c.x - pose.x, c.y - pose.y)));
          const [cx, cy] = toScreen(pose.x, pose.y);
          return (
            <>
              {pose.spin && <circle className={styles.fitSweep} cx={cx} cy={cy} r={reach * scale} />}
              <polygon className={styles.fitBody} points={shape.corners.map((c) => toScreen(c.x, c.y).join(',')).join(' ')} />
            </>
          );
        })()}
      {checksOn && fitPlaces?.map((p, i) => {
        // where the body would have stuck out, once the planner tells
        const [x, y] = toScreen(p.pose?.x ?? p.x, p.pose?.y ?? p.y);
        const dot = <circle className={[p.m > 0 ? styles.fitSkip : styles.fitPlace, i === fitPicked ? styles.fitPicked : ''].join(' ')} cx={x} cy={y} r={4 * k} />;
        if (!p.pose || !onFitPick) return <g key={'fit' + i}>{dot}</g>;
        return (
          <g
            key={'fit' + i}
            className={styles.fitPick}
            // a dot is small for a finger: a bigger round to hit, the map doesn't pan or deselect from it
            onPointerDown={(e) => !grabbable(e) && e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onFitPick(i === fitPicked ? null : i);
            }}
          >
            <circle cx={x} cy={y} r={16 * k} fill="transparent" stroke="none" />
            {dot}
          </g>
        );
      })}
      {checksOn && jumpPlaces?.map((p, i) => {
        const [x, y] = toScreen(p.x, p.y);
        const r = 6 * k;
        return <path key={'jump' + i} className={styles.jumpPlace} d={`M ${x - r} ${y - r} L ${x + r} ${y + r} M ${x - r} ${y + r} L ${x + r} ${y - r}`} />;
      })}
      {!hidden.has('margins') &&
        marginPlaces?.map((p, i) => {
          const [x, y] = toScreen(p.x, p.y);
          return (
            <g key={'margin' + i} className={styles.marginPlace}>
              <circle cx={x} cy={y} r={2.5 * k} />
              {/* the numbers only zoomed in, over the whole garden they lie on top of each other */}
              {marginLabels && (
                <text x={x + 4 * k} y={y} dy="0.35em" fontSize={9 * k} strokeWidth={2.5 * k}>
                  {Math.round(p.m * 100)} cm
                </text>
              )}
            </g>
          );
        })}
      {body &&
        bodySpots?.map((s, i) => {
          const shape = bodyShape(body, s.x, s.y, s.yaw);
          return (
            <polygon
              key={'body' + i}
              className={styles.bodyOut}
              points={shape.corners.map((c) => toScreen(c.x, c.y).join(',')).join(' ')}
            />
          );
        })}
      {/* last, so a spot at the dock isn't hidden under the mower */}
      {markers?.map((m, i) => {
        const [mx, my] = toScreen(m.x, m.y);
        return (
          <g
            key={'mk' + i}
            className={[styles.marker, onMarkerPick ? styles.markerPick : ''].join(' ')}
            // like a dot of the collision check: the map doesn't pan or deselect from it
            onPointerDown={onMarkerPick ? (e) => !grabbable(e) && e.stopPropagation() : undefined}
            onClick={
              onMarkerPick
                ? (e) => {
                    e.stopPropagation();
                    onMarkerPick(i);
                  }
                : undefined
            }
          >
            <circle cx={mx} cy={my} r={20 * k} className={styles.markerPulse} />
            <circle cx={mx} cy={my} r={6 * k} />
          </g>
        );
      })}
    </svg>
  );

  if (!zoomable) return svg;

  // magnified copy of the map above the finger, the finger hides the point otherwise
  let loupe = null;
  const dragged =
    dragging && (dragging.areaId === PENDING ? pendingPoints?.[dragging.index] : selectedArea?.outline[dragging.index]);
  if (finger && dragged) {
    const [cx, cy] = toScreen(dragged.x, dragged.y);
    const size = (LOUPE_PX * (shown?.size ?? WIDTH)) / finger.width / LOUPE_ZOOM;
    const left = Math.min(finger.width - LOUPE_PX, Math.max(0, finger.x - LOUPE_PX / 2));
    // above the finger, or below it when there's no room at the top
    const above = finger.y - LOUPE_PX - 60;
    const top = above >= 0 ? above : Math.min(finger.width - LOUPE_PX, finger.y + 60);
    loupe = (
      <div className={styles.loupe} style={{left, top, width: LOUPE_PX, height: LOUPE_PX}}>
        <svg className={[styles.svg, garden ? styles.garden : ''].filter(Boolean).join(' ')} viewBox={`${cx - size / 2} ${cy - size / 2} ${size} ${size}`}>
          {renderContent(k / LOUPE_ZOOM)}
        </svg>
        <span className={styles.crosshair} />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div ref={frameRef} className={[styles.frame, glides ? styles.frameGliding : ''].filter(Boolean).join(' ')}>
        {svg}
      </div>
      {loupe}
      {coverCell && coverMode !== 'off' && (
        <CoverInfo
          cell={coverCell}
          mode={coverMode}
          raised={!!selectedAreaId}
          at={(() => {
            // where the square is in the map, its numbers go next to it
            if (svgPx <= 0) return null;
            const v = shown ?? {x: 0, y: 0, size: WIDTH};
            const [sx, sy] = toScreen(coverCell.x + CELL_M / 2, coverCell.y + CELL_M / 2);
            const x = ((sx - v.x) / v.size) * svgPx;
            const y = ((sy - v.y) / v.size) * svgPx;
            return x >= 0 && y >= 0 && x <= svgPx && y <= svgPx ? {x, y, size: svgPx} : null;
          })()}
          onClose={() => setCoverCell(null)}
        />
      )}
      <MapControls
        onZoom={zoomCenter}
        showGrid={showGrid}
        onToggleGrid={toggleGrid}
        sources={sources}
        source={source}
        imagerySettings={settings.imagery}
        onSource={setImagery}
        hidden={hidden}
        onToggleLayer={toggleLayer}
        layersOpen={layersOpen}
        onLayersOpen={setLayersOpen}
        body={body ? {blade: body.blade > 0} : undefined}
        planParts={!!pieces?.length}
        planner={!!plannerSettings}
        coverage={
          // on the maps to look around in, with MowBite's container (it keeps the gps log). wifi off once the log has none
          zoomable && updates.level !== null
            ? {
                wifi: !coverage || coverage.some((c) => c.wifi !== null),
                value: coverMode,
                // the editor's map: says that editing waits while the coverage is shown
                paused: !editing && !!onSelectArea,
                onChange: (c) => {
                  setCoverMode(c);
                  setCoverCell(null);
                  // shown, it's for looking: an area being edited is let go
                  if (c !== 'off' && selectedAreaId) onClickEmpty?.();
                },
              }
            : undefined
        }
        planStyle={
          progress
            ? {
                value: planStyle,
                onChange: setPlanStyle,
              }
            : undefined
        }
        reset={
          view || restore || (following && followZoom !== 1)
            ? {
                follow: following,
                onReset: () => {
                  setView(null);
                  setRestore(null);
                  setFollowZoom(1);
                  if (viewKey) savedViews.delete(viewKey);
                },
              }
            : null
        }
        pin={pin}
        follow={
          follow
            ? {
                on: following,
                onToggle: () => {
                  // carries on from what's on screen instead of jumping to the whole map
                  if (following && shown) setView(shown);
                  setFree(following);
                },
              }
            : undefined
        }
      />
      {grid && <span className={styles.gridLabel}>{tr('grid {n} m', {n: fmt(grid.step, grid.step < 1 ? 1 : 0)})}</span>}
      {deletable &&
        (() => {
          // up and to the right of the point, or the next corner around it that keeps clear of the map buttons on the
          // right and the angle bar at the bottom (map page); at the top of the map while the point is out of sight
          const v = shown ?? {x: 0, y: 0, size: WIDTH};
          const p = selectedArea!.outline[activeIndex!];
          const [sx, sy] = toScreen(p.x, p.y);
          const px = ((sx - v.x) / v.size) * svgPx;
          const py = ((sy - v.y) / v.size) * svgPx;
          const size = 40;
          const seen = svgPx > 0 && px >= 0 && py >= 0 && px <= svgPx && py <= svgPx;
          const clear = ([left, top]: number[]) =>
            left >= 0 && top >= 0 && left + size <= svgPx - 52 && top + size <= svgPx - 72;
          const spot = seen
            ? [
                [px + 14, py - 14 - size],
                [px - 14 - size, py - 14 - size],
                [px + 14, py + 14],
                [px - 14 - size, py + 14],
              ].find(clear)
            : undefined;
          const at = spot ? {left: spot[0], top: spot[1]} : null;
          return (
            <button
              className={[styles.deletePoint, at ? '' : styles.deletePointTop].join(' ')}
              style={at ?? undefined}
              onClick={deletePoint}
              aria-label={tr('Delete point')}
              title={tr('Delete point (Del)')}
            >
              <TrashIcon size={18} />
            </button>
          );
        })()}
      {holdHint && deletedAt === null && <div className={styles.hintToast}>{tr('Hold to move')}</div>}
      {deletedAt !== null && onUndo && (
        <div className={styles.undoToast}>
          {tr('Point deleted')}
          <button
            onClick={() => {
              onUndo();
              setDeletedAt(null);
            }}
          >
            {tr('Undo')}
          </button>
        </div>
      )}
    </div>
  );
}

// the dashboard draws again for every sensor value, the map only when something it shows changes
export default memo(MapView);
