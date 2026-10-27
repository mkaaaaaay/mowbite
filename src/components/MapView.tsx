'use client';

import type {MapArea, MowerMap, Point} from '@/hooks/useMowerMap';
import {createEaser} from '@/lib/poseEaser';
import {liveGlide} from '@/hooks/useMowerPosition';
import {containsPoint, polygonArea} from '@/lib/geometry';
import {nearestOnOutline, snapPoint} from '@/lib/snapAreas';
import {looksOf, saveSettings, settingsStore, withLooks, type KeptLooks} from '@/lib/settings';
import {bodyShape, isPin, pinAt, realEdges, realInsides, roundBends, useMowerBody, usePlannerSettings, type MowerBody} from '@/lib/mowerBody';
import type {FitPose, PlanPiece} from '@/lib/mowPlan';
import {dockIcon} from './mapIcons';
import {availableSources, imageryShift, imageryTiles, type Datum} from '@/lib/imagery';
import {handleRadius, meterGrid} from '@/lib/mapGrid';
import MapControls, {layerOn, type Layer} from './MapControls';
import {useMapPrefs} from './useMapPrefs';
import {Fragment, isValidElement, memo, startTransition, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import styles from './MapView.module.css';
import {fmt, tr, useLang} from '@/lib/i18n';
import {tick} from '@/lib/haptics';
import {TrashIcon} from './icons';
import {useHalloween} from '@/lib/eggs';
import {CELL_M, MIN_SECONDS, gpsGrade, loadCoverage, wifiGrade, type CoverageCell} from '@/lib/coverage';
import {useUpdates} from '@/lib/updates';
import {CoverInfo} from './CoverInfo';
import {fillOf, GardenDefs, gardenThings, pinTapped} from './gardenLook';
import {biggest, coversOf, edgePaths, GardenThing, lifeOf, lifeScene} from './gardenLife';
import {PICTURES} from './gardenPictures';
import {useMowHistory} from '@/hooks/useMowHistory';
import {useWeather} from '@/hooks/useWeather';
import {useMowerStateValue} from '@/hooks/useMowerState';
import type {SimClock, SimFrame} from '@/lib/simulate';
import {boundsOf, fitIn, HEIGHT, pathOf, viewFromMeters, viewToMeters, WIDTH, type Bounds, type Fit, type Meters, type View} from './mapFrame';
import {LiveDrag, LiveLoupe, LivePin, liveStore, Loupe, LOUPE_ZOOM} from './MapLive';
import {MowerMarker} from './MowerMarker';
import {SimTrail} from './SimTrail';
import {trailRuns, trailSwath, type Run, type Strips} from './mapTrail';

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
  // the map editor: points dragged or set snap onto the corners and edges of other areas nearby, a button switches it
  snap?: {on: boolean; onToggle: () => void};
  // the map editor: pictures standing by themselves (decorating), started from the map's settings in the garden style
  onDecorate?: () => void;
  // without the buttons on the map, the page has its own (recording on a phone held sideways)
  bare?: boolean;
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
  // decorating (the map page): a tap sets a picture (armed) or picks a picture standing by itself (a pin, ringed), held a
  // moment a pin goes along with the finger. areas take no taps meanwhile, outside of it pins take none
  decor?: {armed: boolean};
  // gps datum of the map, enables the aerial imagery option
  datum?: Datum;
  // numbers drawn in areas, e.g. mowing order
  orderLabels?: Record<string, number>;
  // the mower's body to draw with instead of its own (the editor guide shows the real edges of an example mower)
  bodyOverride?: MowerBody;
  // every layer shown, whatever the layer menu hides (the editor guide)
  allLayers?: boolean;
  // a made-up map (the editor guide): the garden's life stays off, it's the real garden's (its time, weather and runs)
  sample?: boolean;
  // drawn in this style instead of the one set (the editor guide shows both)
  mapStyle?: 'plain' | 'garden';
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
  // a drive of the plan the planner simulated (lib/simulate): the mower and its trail where its clock is, played back
  // without drawing the map again. in place of the live mower
  sim?: {frames: readonly SimFrame[]; clock: SimClock};
  // what that drive left unmowed, and where the controller would have given up (a cross each)
  leftPieces?: Point[][];
  navErrors?: Point[];
}

const MAX_ZOOM = 40;
// center and width in meters, so a changed map doesn't move what was looked at
const savedViews = new Map<string, {x: number; y: number; span: number}>();
// dragging.areaId while a point of the line being drawn is dragged
const PENDING = '__pending';
// dragging.areaId while a handle of the picture of the area being edited is dragged (index 0 turns it, 1 sizes it)
const THING = '__thing';
const NO_LAYERS_HIDDEN = new Set<Layer>();

const AREA_CLASS: Record<string, string> = {
  mow: styles.mowArea,
  nav: styles.navArea,
  obstacle: styles.obstacleArea,
  decor: styles.decorArea,
  draft: styles.draftArea,
};
const OVERLAY_CLASS: Record<string, string> = {
  green: styles.overlayOutline,
  red: styles.overlayObstacle,
  blue: styles.overlayLive,
};
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

// the svg while it glides along the mower: twice the frame, slid along by a transform
const GLIDING: React.CSSProperties = {position: 'absolute', left: 0, top: 0, width: '200%', height: '200%', transformOrigin: '0 0'};
// the svg of a map that can be moved: twice the frame with the view in its middle, a pan or pinch slides it under the
// frame and finds the map already drawn round the edges
const SPAN = 3;
const OVERSCAN: React.CSSProperties = {
  position: 'absolute',
  left: `${(-(SPAN - 1) / 2) * 100}%`,
  top: `${(-(SPAN - 1) / 2) * 100}%`,
  width: `${SPAN * 100}%`,
  height: `${SPAN * 100}%`,
  transformOrigin: `${((SPAN - 1) / 2 / SPAN) * 100}% ${((SPAN - 1) / 2 / SPAN) * 100}%`,
};
// the two layers on it (ground and over, see renderContent), each one the phone's gpu keeps drawn on its own
const LAYER: React.CSSProperties = {position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', willChange: 'transform'};
const OVER: React.CSSProperties = {...LAYER, pointerEvents: 'none', background: 'none', boxShadow: 'none'};
// the ground of the map (draw), kept as it was while a point is held and the view stays: nothing on it changes
// meanwhile, it isn't gone through again for every move
const Ground = memo(
  function Ground({draw}: {draw: () => ReactNode; held: object | null; view: string}) {
    return draw();
  },
  (a, b) => !!b.held && a.held === b.held && a.view === b.view,
);
// the pictures of a list without the one under this key (the garden's life lists them keyed by their area)
const withoutKey = (nodes: ReactNode, key: string) => (Array.isArray(nodes) ? nodes.filter((n) => !(isValidElement(n) && n.key === key)) : nodes);

// what's drawn of the map in one svg (see renderContent)
type Part = 'all' | 'ground' | 'settled' | 'live' | 'over' | 'loupe';
const drawsPart = (part: Part, p: Part) => part === 'all' || part === 'loupe' || part === p;

// a point of an outline or of a line being drawn, or the middle of an edge (a new point there)
type Handle = {mid: boolean; index: number; x: number; y: number};
type Press = {pointerId: number; clientX: number; clientY: number; pointerType: string};

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
  onDecorate,
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
  snap,
  bare = false,
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
  sim,
  leftPieces,
  navErrors,
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
  decor,
  datum,
  orderLabels,
  bodyOverride,
  allLayers,
  sample,
  mapStyle,
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
  // a point of an area dragged: the map and its bounds as they were when it was picked up (see shapeMap), until the
  // garden of the map it was let go on is worked out
  const [held, setHeld] = useState<{map: MowerMap; bounds: Bounds} | null>(null);
  // where the point being dragged snapped to
  const [snapMark, setSnapMark] = useState<{x: number; y: number; corner: boolean} | null>(null);
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
    // a pin being moved: how far its middle is from the finger, it doesn't jump to it
    off: {x: number; y: number} | null;
    // a point of an area: where it was moved to last, it's put there once it's let go (see live)
    at?: {x: number; y: number};
  }>({pointerId: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false, touch: false, insert: null, orig: null, off: null});
  // a point of an area being dragged: where it is now, drawn by what reads it (LiveDrag, LiveLoupe), not the whole map
  const [live] = useState(liveStore);
  // finger position while dragging on touch, drives the loupe
  const [finger, setFinger] = useState<{x: number; y: number; width: number} | null>(null);
  // tapped point, gets a delete button
  const [active, setActive] = useState<{areaId: string; index: number} | null>(null);
  // the user's zoom and pan, center and width in meters: a map that changes size (a point dragged past the edge,
  // a new area drawn outside) rescales the drawing, but what's looked at stays put
  const [viewMeters, setViewMeters] = useState<Meters | null>(null);
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  // the aerial imagery moved by hand until it lines up: the shift while it's being set
  const [aligning, setAligning] = useState<[number, number] | null>(null);
  // the view from the last visit, until zoomed, panned or reset. a spot to show wins over it
  const [restore, setRestore] = useState(() => (viewKey && !focus ? (savedViews.get(viewKey) ?? null) : null));
  // in follow mode zooming changes how many meters around the mower are shown
  const [followZoom, setFollowZoom] = useState(1);
  // follow mode switched off by hand, back on with the next drive
  const [free, setFree] = useState(false);
  if (free && !follow) setFree(false);
  const following = follow && !free;
  const prefs = useMapPrefs();
  const {imagery, lastImagery, setImagery, showGrid, toggleGrid, toggleLayer, planStyle, setPlanStyle, coverage: coverPref, setCoverage: setCoverMode} =
    prefs;
  // decorating the map is for that, the coverage waits (its switch is gone meanwhile)
  const coverMode = decor ? 'off' : coverPref;
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
  // a pinch: how far apart the fingers were and their middle (client px) at the last move
  const gesture = useRef<{moved: boolean; pinchDist: number | null; pinchMid?: [number, number]}>({moved: false, pinchDist: null});
  // while the map moves the grass and the leaves wait (Grass.module.css): behind the frosted cards each of their frames
  // blurs the cards again, and the map stutters. only they are told (data-waits): a mark on the page's root styles every
  // element of the page again at the start and the end of each move
  const stillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiting = (on: boolean) =>
    document.querySelectorAll('[data-waits]').forEach((el) => (on ? el.setAttribute('data-map-moving', '') : el.removeAttribute('data-map-moving')));
  const moving = () => {
    if (!stillTimer.current) waiting(true);
    else clearTimeout(stillTimer.current);
    stillTimer.current = setTimeout(() => {
      waiting(false);
      stillTimer.current = null;
    }, 400);
  };
  useEffect(
    () => () => {
      if (stillTimer.current) clearTimeout(stillTimer.current);
      document.querySelectorAll('[data-waits]').forEach((el) => el.removeAttribute('data-map-moving'));
    },
    [],
  );
  // a finger resting on a point or on a pin (decorating), until it picks it up (HOLD_MS) or turns out to pan
  const hold = useRef<{press: Press; areaId: string; hit: Handle; pin?: boolean; timer: ReturnType<typeof setTimeout>} | null>(null);
  // what a picture's handle started from: its middle (svg), its size (m), how far from the middle the finger was and what
  // was kept for the picture (put back when it turns out to be a pinch)
  const thingDrag = useRef<{kind: 'turn' | 'size'; areaId: string; cx: number; cy: number; size: number; dist: number; reaches: boolean; was: KeptLooks} | null>(
    null,
  );
  const dropHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  useEffect(() => () => dropHold(), []);
  // the mower glides on its own (MowerMarker), the view only goes along with it in follow mode: every frame by moving
  // the viewBox itself (below), a render of the whole map for every frame stuttered on phones. Both along the live poses
  // as they came when the mower is the live one, at the same frame time: the mower stays right in the middle
  const livePoses = liveGlide(mower);
  // a simulated drive played back: its mower in place of the live one, from where the drive starts
  const simStart = useMemo(() => {
    const f = sim?.frames[0];
    return f ? {x: f[1], y: f[2], heading: f[3]} : null;
  }, [sim]);
  const markerMower = sim ? (simStart ?? undefined) : mower;
  const followed = following && mower ? mower : null;
  const [followEaser] = useState(createEaser);
  useEffect(() => {
    followEaser.push(livePoses ? null : followed);
  }, [followEaser, followed, livePoses]);
  const ownBody = useMowerBody();
  const body = bodyOverride ?? ownBody;
  const plannerSettings = usePlannerSettings();

  // fitted to the map only, so the geometry doesn't change while the mower moves. follow mode
  // moves the view instead. not to the points being set: the view would jump and zoom with every one
  const fit = useMemo(() => boundsOf(map), [map]);
  // what's drawn of the map (the areas, the garden, the real edges): while a point of an area is dragged the map as it
  // was when it was picked up, the area being dragged goes along as its outline and points over it. worked out again
  // once it's let go, not for every move
  const shapeMap = held?.map ?? map;

  const center = followed ?? mower ?? {x: 0, y: 0};
  const {minX, maxX, minY, maxY}: Bounds = dragging?.bounds ?? held?.bounds ??
    fit ?? {
      minX: center.x - followSpanMeters / 2,
      maxX: center.x + followSpanMeters / 2,
      minY: center.y - followSpanMeters / 2,
      maxY: center.y + followSpanMeters / 2,
    };

  const {scale, padX, padY} = fitIn({minX, maxX, minY, maxY});

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
  // and stuttered on phones. also without zoom, the record page's remote follows the mower like that
  const glides = following && !!followed && !!fit;
  const glideSize = followSpanMeters * followZoom * scale;
  const [anchor, setAnchor] = useState<{x: number; y: number; size: number} | null>(null);
  const [gx, gy] =
    anchor && anchor.size === glideSize ? [anchor.x, anchor.y] : followed ? toScreen(followed.x, followed.y) : [0, 0];
  // what the svg shows while gliding, for the frame loop: the anchor in svg units and the window's size
  const glideRef = useRef<{x: number; y: number; size: number; fixed: boolean; asked: boolean} | null>(null);
  const anchored = !!anchor && anchor.size === glideSize;
  // what the frame shows, and what the svg draws: that, twice as big round its middle when the map can be moved (OVERSCAN)
  const framed = shown ?? {x: 0, y: 0, size: WIDTH};
  const svgBox = zoomable && !glides ? {x: framed.x - (framed.size * (SPAN - 1)) / 2, y: framed.y - (framed.size * (SPAN - 1)) / 2, size: SPAN * framed.size} : framed;
  const frameRef = useRef<HTMLDivElement | null>(null);
  // what moves under the frame: both layers of the map
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const lastSlide = useRef<[number, number] | null>(null);
  // the time of the frame being shown, slid again at that time after a render (see MowerMarker)
  const slidAt = useRef<number | null>(null);
  // slides the map so the eased mower is in the middle of the frame, asks for a new anchor when it gets near the edge
  // of what's drawn
  const slide = useCallback(
    (now: number = slidAt.current ?? performance.now()) => {
      const g = glideRef.current;
      const svg = sheetRef.current;
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
    else if (sheetRef.current) sheetRef.current.style.transform = '';
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
    for (const a of shapeMap.areas) {
      out.set(a.id, a.outline.map((p) => `${(p.x - minX) * scale + padX},${HEIGHT - ((p.y - minY) * scale + padY)}`).join(' '));
    }
    return out;
  }, [shapeMap, minX, minY, scale, padX, padY]);
  // the garden style: each mowing area's lawn in stripes along its mowing direction, ways and obstacles as their
  // pictures, a thing (tree, pond ...) placed inside the area's real edge (with the mower's sizes known, else inside
  // its outline) and cut to it should it still stick out
  const garden = mapStyle ? mapStyle === 'garden' : settings.mapStyle === 'garden';
  const uid = 'g' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const gardenLook = useMemo(() => {
    if (!garden) return null;
    const g = gardenThings(shapeMap.areas, settings.looks, body ?? null, {minX, minY, m: scale, padX, padY}, {
      variants: settings.lookVariants,
      sizes: settings.lookSizes,
      turns: settings.lookTurns,
      closed: settings.lookClosed,
      grounds: settings.lookGrounds,
    });
    return {...g, defs: <GardenDefs uid={uid} m={scale} lawns={g.angles} clips={g.clips} />};
  }, [garden, shapeMap, settings.looks, settings.lookVariants, settings.lookSizes, settings.lookTurns, settings.lookClosed, settings.lookGrounds, uid, scale, minX, minY, padX, padY, body]);
  // the garden's life (gardenLife): light after the sun, the season and the weather on the lawn, a mowing edge and
  // the lawn growing back since it was last cut. the time moves on every five minutes, the layers are worked out below
  const life = garden && !sample ? lifeOf(settings.garden) : null;
  const [lifeNow, setLifeNow] = useState(() => Date.now());
  useEffect(() => {
    if (!garden) return;
    const t = setInterval(() => setLifeNow(Date.now()), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [garden]);
  const weather = useWeather(datum, !!life?.season && !!settings.weather);
  const rainSensor = useMowerStateValue((l) => !!l.state?.rain_detected);
  const history = useMowHistory(!!life?.growth);
  const trackRuns = useMemo(() => trailRuns(track, {minX, minY, scale, padX, padY}), [track, minX, minY, scale, padX, padY]);

  // the strip the blade cut along the live trail and a recorded job, with the mower's sizes set
  const swathOn = !!body?.blade && layerOn(hidden, 'swath');
  const swath = useMemo(
    () => trailSwath(swathOn, body, track, pastTrack, beforeTrack, {minX, minY, scale, padX, padY}),
    [swathOn, body, track, pastTrack, beforeTrack, minX, minY, scale, padX, padY],
  );

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
  // the lines along them, and the lawn between the lines and the real edges: outside the mowing areas under them, in the
  // obstacles over them. the garden style's stones go along the lawn's, the obstacles keep the dashed line
  const edges = useMemo(
    () => (edgesOn && body ? edgePaths(shapeMap.areas, body, {minX, minY, m: scale, padX, padY}, !hidden.has('obstacle')) : null),
    [edgesOn, body, shapeMap, hidden, minX, minY, scale, padX, padY],
  );
  // a point let go: the real edges of the map as it is now worked out one after the other, the lines along them (with
  // the obstacles shrunk together) and the areas' own, then it's drawn with them. no frame takes all of it at once
  useEffect(() => {
    if (!held || dragging) return;
    const steps = [() => edgesOn && body && realEdges(map.areas, body), () => garden && body && realInsides(map.areas, body), () => setHeld(null)];
    let timer = setTimeout(function next() {
      steps.shift()?.();
      if (steps.length) timer = setTimeout(next);
    });
    return () => clearTimeout(timer);
  }, [held, dragging, map, body, garden, edgesOn]);
  // the garden's life in its layers (gardenLife), the stones along the real edges when they're shown, else the outlines.
  // the mower only for the light round it at night, the trail only for the cuts: a position that came doesn't work the
  // life out again otherwise
  const nightMower = life?.sun ? mower : undefined;
  const cutTrack = life?.growth ? track : undefined;
  const scene = useMemo(
    () =>
      garden && !sample
        ? lifeScene({
            areas: shapeMap.areas,
            garden: settings.garden,
            looks: settings.looks,
            lookVariants: settings.lookVariants,
            lookSizes: settings.lookSizes,
            lookTurns: settings.lookTurns,
            lookClosed: settings.lookClosed,
            lookGrounds: settings.lookGrounds,
            body: body ?? null,
            fit: {minX, minY, m: scale, padX, padY},
            uid,
            now: lifeNow,
            datum,
            weather,
            rain: rainSensor,
            mower: nightMower,
            jobs: history,
            track: cutTrack,
            edgeLine: edges?.lawnLine ?? null,
            hidden,
          })
        : null,
    [garden, sample, shapeMap, settings.garden, settings.looks, settings.lookVariants, settings.lookSizes, settings.lookTurns, settings.lookClosed, settings.lookGrounds, body, minX, minY, scale, padX, padY, uid, lifeNow, datum, weather, rainSensor, nightMower, history, cutTrack, edges, hidden],
  );
  const gardenFill = (a: MapArea): React.CSSProperties | undefined => {
    if (!gardenLook) return undefined;
    // a lawn grown long with the garden's life, else as the garden style fills it
    const long = a.properties.type === 'mow' && a.properties.mowable !== false && scene?.long && a.properties.active !== false;
    const fill = long ? 'long' : fillOf(a, gardenLook);
    return fill ? {fill: `url(#${uid}${fill})`, fillOpacity: 1} : undefined;
  };

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
  const strips = (st: Strips) =>
    st.groups.length > 0 && body ? (
      <g className={styles.swath} strokeWidth={body.blade * scale}>
        {st.groups.map((d, i) => (
          <path key={'swath' + i} d={d} />
        ))}
        <path className={styles.swathEnd} d={st.ends} />
      </g>
    ) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- strips only uses body and scale
  const swathSettled = useMemo(() => strips(swath.settled), [swath.settled, body, scale]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- strips only uses body and scale
  const swathLive = useMemo(() => strips(swath.live), [swath.live, body, scale]);
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
  const runLines = (runs: Run[]) =>
    runs
      .filter((run) => run.blades || !hidden.has('transit'))
      .map((run, i) => <polyline key={'run' + i} points={run.points} className={run.blades ? styles.track : styles.transit} />);
  // the trail's pieces that are done and the recorded tracks, and the piece that grows
  const trackSettled = useMemo(
    () =>
      hidden.has('track') ? null : (
        // halloween night the track glows like ectoplasm
        <g className={halloween.night ? styles.spooky : undefined}>
          {beforeLines.map((points, i) => (
            <polyline key={'before' + i} points={points} className={styles.trackBefore} />
          ))}
          {runLines(trackRuns.settled)}
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runLines only uses hidden
    [hidden, trackRuns.settled, pastTrack, beforeLines, minX, minY, scale, padX, padY, halloween.night],
  );
  const trackLive = useMemo(
    () => (hidden.has('track') ? null : <g className={halloween.night ? styles.spooky : undefined}>{runLines(trackRuns.live)}</g>),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runLines only uses hidden
    [hidden, trackRuns.live, halloween.night],
  );

  // the area being edited with its points. a pin picked while decorating has none, it moves as a whole by its middle
  const selectedArea = map.areas.find((a) => a.id === selectedAreaId && !isPin(a));
  const activeIndex =
    active && selectedArea && active.areaId === selectedArea.id && active.index < selectedArea.outline.length
      ? active.index
      : null;
  // one of its points being dragged: the area and the point drawn from where it is now (live), the rest stays as it is
  const gliding = !!dragging && !!selectedArea && dragging.areaId === selectedArea.id && !!onMoveVertex;
  // a pin being moved (decorating): drawn where the finger has it (LivePin), on the map it stays where it was until it's
  // let go
  const glidingPin = dragging && onMoveVertex ? map.areas.find((a) => a.id === dragging.areaId && isPin(a)) : undefined;

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
  // decorating: an area's picture tapped, where it's changed instead (n: shown again for the next tap)
  const [areaHint, setAreaHint] = useState<{text: string; n: number} | null>(null);
  useEffect(() => {
    if (!areaHint) return;
    const t = setTimeout(() => setAreaHint(null), 4000);
    return () => clearTimeout(t);
  }, [areaHint]);
  // the esri key its tiles didn't load with (a wrong or expired one): the imagery stays empty, a hint says why for a
  // moment, once each time it's switched on
  const [rejectedKey, setRejectedKey] = useState<string | null>(null);
  // the key a tile has loaded with, and the tiles that failed with one none has loaded with yet: a tile failing now and
  // then (the wifi gone for a moment) isn't a rejected key
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const failedTiles = useRef<{key: string | null; hrefs: Set<string>}>({key: null, hrefs: new Set()});
  // counted again each time the imagery is switched on or to another source
  useEffect(() => {
    failedTiles.current = {key: null, hrefs: new Set()};
  }, [imagery]);
  const [imageryHint, setImageryHint] = useState(false);
  useEffect(() => {
    if (!imageryHint) return;
    const t = setTimeout(() => setImageryHint(false), 2500);
    return () => clearTimeout(t);
  }, [imageryHint]);

  // keeps handles the same size at any zoom
  const k = shown ? shown.size / WIDTH : 1;
  // the picture of the area being edited in the garden style, with a handle to turn it (above it, a cantilever parasol's
  // out past its canopy) and one to make it bigger or smaller (at its corner), a dashed frame round it
  const pickedThing = editing && !pickingPoints && selectedAreaId && gardenLook ? gardenLook.things.get(selectedAreaId) : undefined;
  const pickedPic = pickedThing ? PICTURES[pickedThing.look] : undefined;
  const handles = (() => {
    if (glidingPin || !pickedThing || !pickedPic || pickedPic.fill || !pickedThing.places.length) return null;
    const pl = biggest(pickedThing.places);
    const a = (pl.deg * Math.PI) / 180;
    const at = (u: number, v: number): [number, number] => [pl.cx + u * Math.cos(a) - v * Math.sin(a), pl.cy + u * Math.sin(a) + v * Math.cos(a)];
    // a parasol reaches over its area: no frame, its handles out by its canopy
    const reaches = !!pickedPic.turn && !!pickedPic.over;
    return {
      pl,
      reaches,
      frame: reaches ? null : [at(-pl.w / 2, -pl.h / 2), at(pl.w / 2, -pl.h / 2), at(pl.w / 2, pl.h / 2), at(-pl.w / 2, pl.h / 2)],
      turn: pickedPic.round ? null : reaches ? at(pl.w * 1.18, 0) : at(0, -pl.h / 2 - 16 * k),
      size: reaches ? at(pl.w * 1.1, pl.w * 0.55) : at(pl.w / 2 + 7 * k, pl.h / 2 + 7 * k),
    };
  })();
  const pxPerMeter = scale / k;
  // the width the map takes on screen (px): the frame's, the svg is twice as big
  const framePx = () => (frameRef.current ?? svgRef.current)?.getBoundingClientRect().width || 1;

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
    () => [...shapeMap.areas].sort((a, b) => polygonArea(b.outline) - polygonArea(a.outline)),
    [shapeMap],
  );

  // clicking the selected area again goes to the next one underneath
  const selectAt = (clickedId: string, clientX: number, clientY: number) => {
    const local = clientToLocal(clientX, clientY);
    if (clickedId !== selectedAreaId || !local) {
      onSelectArea?.(clickedId);
      return;
    }
    const stack = areasBySize.filter((a) => !isPin(a) && containsPoint(a.outline, local[0], local[1])).reverse();
    const i = stack.findIndex((a) => a.id === selectedAreaId);
    if (stack.length > 1) onSelectArea?.(stack[(i + 1) % stack.length].id);
  };

  // a point being dragged or set put onto the nearest corner or edge of another area within reach (snap on, without alt
  // held), with the place it went to marked. A line being drawn to split an area or cut a shape out of it doesn't snap
  // onto that area, nor onto a neighbour's corner or edge on its outline or across it: put onto its edge or over it, the
  // line wouldn't cross it and a shape would touch it. a pin isn't snapped onto, and nothing snaps while decorating
  const snapAt = (x: number, y: number, exclude: string | null, touch: boolean) => {
    const svg = svgRef.current;
    if (!snap?.on || !svg || decor) return null;
    const reach = (touch ? 20 : 10) / ((pxPerMeter * framePx()) / WIDTH);
    const others = map.areas.filter((a) => a.id !== exclude && !isPin(a) && !hidden.has(a.properties.type as Layer)).map((a) => a.outline);
    const s = snapPoint({x, y}, others, reach);
    const cut = pickingPoints ? map.areas.find((a) => a.id === exclude) : undefined;
    if (s && cut && ((nearestOnOutline(cut.outline, s)?.d ?? 1) < 0.002 || containsPoint(cut.outline, s.x, s.y) !== containsPoint(cut.outline, x, y))) return null;
    return s;
  };

  // midpoints are only offered where there's room for them
  const showMidpoint = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y) * pxPerMeter >= 30;

  // nearest vertex or edge midpoint within finger/mouse reach, handles themselves are too small to hit
  const pickHandle = (clientX: number, clientY: number, touch: boolean) => {
    const svg = svgRef.current;
    const local = clientToLocal(clientX, clientY);
    if (!svg || !local || !selectedArea || !onMoveVertex || pickingPoints) return null;

    const reach = (touch ? 22 : 12) / ((pxPerMeter * framePx()) / WIDTH);
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

    const reach = (touch ? 22 : 12) / ((pxPerMeter * framePx()) / WIDTH);
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
  // decorating with no picture to set: the pin a press or a tap hits (gardenLook pinTapped, a finger's 24 px round its
  // middle at least) and where it stands
  const pickPin = (clientX: number, clientY: number) => {
    const p = decor && !decor.armed ? clientToSvg(clientX, clientY) : null;
    if (!p) return null;
    const at = (q: Point) => {
      const [x, y] = toScreen(q.x, q.y);
      return {x, y};
    };
    const hit = pinTapped(map.areas, gardenLook?.things ?? null, at, {x: p[0], y: p[1]}, (24 * framed.size) / framePx());
    const a = hit && map.areas.find((x) => x.id === hit.id);
    return hit && a ? {id: a.id, d: hit.d, at: pinAt(a)} : null;
  };
  // a press on a marker near a point of the area being edited (or near a pin) moves it: the marker only takes it otherwise
  const grabbable = (e: React.PointerEvent) =>
    editing &&
    !!(
      pickPending(e.clientX, e.clientY, e.pointerType !== 'mouse') ||
      (selectedArea && pickHandle(e.clientX, e.clientY, e.pointerType !== 'mouse')) ||
      pickPin(e.clientX, e.clientY)
    );


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
    const frame = frameRef.current;
    if (zoomable && !following && !glides && frame) return zoomShift(factor, frame.clientWidth / 2, frame.clientWidth / 2, true);
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

  // the wheel's zoom round the pointer, as a shift unless the view goes with the mower
  const wheel = useRef<(factor: number, clientX: number, clientY: number) => void>(() => {});
  useEffect(() => {
    // on the sheet both layers lie on, so it zooms over the markers on the layer above too
    const sheet = sheetRef.current;
    if (!zoomable || !svgEl || !sheet) return;

    // react's onWheel is passive, can't preventDefault the page scroll there
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheel.current(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY);
    };
    sheet.addEventListener('wheel', onWheel, {passive: false});
    return () => sheet.removeEventListener('wheel', onWheel);
  }, [zoomable, svgEl]);

  useEffect(() => {
    if (viewKey && viewMeters) savedViews.set(viewKey, viewMeters);
  }, [viewKey, viewMeters]);

  // a press on one of the picture's handles: which one and how far from it (svg units), null for none in reach
  const pickThingHandle = (clientX: number, clientY: number, touch: boolean): {kind: 'turn' | 'size'; d: number} | null => {
    const p = clientToSvg(clientX, clientY);
    const svg = svgRef.current;
    if (!p || !svg || !handles) return null;
    const reach = ((touch ? 22 : 12) * framed.size) / framePx();
    const far = (q: [number, number] | null) => (q ? Math.hypot(q[0] - p[0], q[1] - p[1]) : Infinity);
    const [turn, size] = [far(handles.turn), far(handles.size)];
    if (Math.min(turn, size) > reach) return null;
    return turn <= size ? {kind: 'turn', d: turn} : {kind: 'size', d: size};
  };

  const startThingDrag = (e: Press, kind: 'turn' | 'size') => {
    if (!handles || !pickedThing || !selectedAreaId) return;
    const p = clientToSvg(e.clientX, e.clientY);
    const {pl} = handles;
    thingDrag.current = {
      kind,
      areaId: selectedAreaId,
      cx: pl.cx,
      cy: pl.cy,
      size: settings.lookSizes?.[selectedAreaId] ?? Math.max(pl.w, pl.h) / pickedThing.m,
      dist: p ? Math.max(1e-6, Math.hypot(p[0] - pl.cx, p[1] - pl.cy)) : 1,
      reaches: handles.reaches,
      was: looksOf(settingsStore.snapshot(), [selectedAreaId]),
    };
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      touch: e.pointerType !== 'mouse',
      insert: null,
      orig: null,
      off: null,
    };
    gesture.current.moved = true; // eat the click that follows
    setDragging({areaId: THING, index: kind === 'turn' ? 0 : 1, bounds: {minX, maxX, minY, maxY}});
  };

  const startDrag = (e: Press, areaId: string, hit: Handle) => {
    const at = {x: hit.x, y: hit.y};
    const from = map.areas.some((a) => a.id === areaId && isPin(a)) ? clientToLocal(e.clientX, e.clientY) : null;
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
      off: from ? {x: hit.x - from[0], y: hit.y - from[1]} : null,
    };
    gesture.current.moved = true; // eat the click that follows
    if (e.pointerType === 'touch') tick();
    setDragging({areaId, index: hit.mid ? hit.index + 1 : hit.index, bounds: {minX, maxX, minY, maxY}});
    setHeld(areaId === PENDING ? null : {map, bounds: {minX, maxX, minY, maxY}});
  };

  // a second finger while a point is held means the first one was the start of a pinch
  const cancelDrag = (e: React.PointerEvent<Element>) => {
    if (!dragging) return;
    const d = drag.current;
    if (dragging.areaId === THING) {
      // what the handle changed goes back
      const was = thingDrag.current?.was;
      const cur = settingsStore.snapshot();
      if (d.moved && was && withLooks(cur, was) !== cur) saveSettings(withLooks(cur, was));
      thingDrag.current = null;
    } else if (d.moved) {
      if (dragging.areaId !== PENDING) onDragCancel?.();
      else if (d.orig) onMovePending?.(dragging.index, d.orig.x, d.orig.y);
    }
    d.at = undefined;
    live.set(null);
    setDragging(null);
    setHeld(null);
    setFinger(null);
    setActive(null);
    onDragging?.(false);
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

  const onPointerDown = (e: React.PointerEvent<Element>) => {
    const touch = e.pointerType !== 'mouse';
    if (dragging) {
      if (touch && drag.current.touch && e.pointerId !== drag.current.pointerId) cancelDrag(e);
      return;
    }
    // a second finger while one rests on a point: a pinch
    if (hold.current && e.pointerId !== hold.current.press.pointerId) dropHold();

    // (a picture to set picked: a tap by the picked pin sets it, its handles take nothing)
    const thingHit = editing && handles && !decor?.armed && pointers.current.size === 0 ? pickThingHandle(e.clientX, e.clientY, touch) : null;
    const pendingHit = editing && pointers.current.size === 0 ? pickPending(e.clientX, e.clientY, touch) : null;
    const hit = editing && !pendingHit && selectedArea && pointers.current.size === 0 ? pickHandle(e.clientX, e.clientY, touch) : null;
    const pinHit = editing && !pendingHit && !hit && pointers.current.size === 0 ? pickPin(e.clientX, e.clientY) : null;
    // the picture's handle only when it's closer than the point or edge's middle in reach (its size handle sits right by a
    // corner) or than a pin's middle
    const at = thingHit && hit ? clientToSvg(e.clientX, e.clientY) : null;
    const [hx, hy] = hit ? toScreen(hit.x, hit.y) : [0, 0];
    if (thingHit && !(at && Math.hypot(hx - at[0], hy - at[1]) <= thingHit.d) && !(pinHit && pinHit.d < thingHit.d)) {
      startThingDrag(e, thingHit.kind);
      return;
    }
    // a pin goes along by its middle, picked as it's picked up
    const grab = pendingHit
      ? {areaId: PENDING, hit: pendingHit}
      : hit && selectedArea
        ? {areaId: selectedArea.id, hit}
        : pinHit
          ? {areaId: pinHit.id, hit: {mid: false, index: 0, ...pinHit.at}, pin: true}
          : null;
    if (grab && (e.pointerType !== 'touch' || !zoomable)) {
      if (grab.pin) onSelectArea?.(grab.areaId);
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
          if (h.pin) onSelectArea?.(h.areaId);
          startDrag(h.press, h.areaId, h.hit);
        }, HOLD_MS),
      };
    }

    if (!zoomable) return;
    pointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (pointers.current.size === 1) gesture.current = {moved: false, pinchDist: null};
    // the second finger: the pinch goes from how far apart they are now, its first move zooms already
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.pinchMid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    }
  };

  // a pan or a pinch moves the map that's drawn by a css transform (the phone's gpu moves it, nothing is drawn again), the
  // view is set from it when the fingers let go and before they reach the edge of what's drawn round the view: a map full
  // of pictures drawn again for every move of a finger stuttered
  // the view is set in a transition, react draws it in pieces and the fingers go on moving the map meanwhile. until it's
  // drawn the map on screen is the one before, moved by what was set (pending) and then by the shift since: a finger
  // moving before it was drawn (with two fingers that's the other one, in the same frame) jumped back to the old view
  type Shift = {tx: number; ty: number; s: number};
  const shift = useRef<Shift | null>(null);
  // the shifts set as views and not drawn yet, oldest first, each with the view and its number (drawnShift once drawn)
  const pending = useRef<(Shift & {view: View; n: number})[]>([]);
  const [drawnShift, setDrawnShift] = useState(0);
  // the last number given, counted on when pending is emptied: a shift still being drawn never shares one with a newer
  const lastShift = useRef(0);
  // the view drawn, for an ease or a timer started a few renders ago
  const drawnView = useRef(base);
  useLayoutEffect(() => {
    drawnView.current = base;
  });
  // the map on screen moved by the pending shifts and the one since, one after the other
  const moved = (): Shift =>
    [...pending.current, shift.current ?? {tx: 0, ty: 0, s: 1}].reduce((a, b) => ({tx: b.tx + b.s * a.tx, ty: b.ty + b.s * a.ty, s: b.s * a.s}), {tx: 0, ty: 0, s: 1});
  const show = () => {
    const sheet = sheetRef.current;
    // (while it glides along the mower the transform is slide's)
    if (!sheet || glideRef.current) return;
    const m = moved();
    sheet.style.transform = !pending.current.length && !shift.current ? '' : `translate(${m.tx}px, ${m.ty}px) scale(${m.s})`;
  };
  const commitShift = () => {
    const sh = shift.current;
    const frame = frameRef.current;
    shift.current = null;
    if (!sh || !frame) return;
    const last = pending.current.at(-1);
    const v = last?.view ?? drawnView.current ?? {x: 0, y: 0, size: WIDTH};
    const unit = v.size / (frame.clientWidth || 1);
    const view = {x: v.x - (sh.tx / sh.s) * unit, y: v.y - (sh.ty / sh.s) * unit, size: Math.min(WIDTH * 4, Math.max(WIDTH / MAX_ZOOM, v.size / sh.s))};
    const n = ++lastShift.current;
    pending.current = [...pending.current, {...sh, view, n}];
    startTransition(() => {
      setView(view);
      setDrawnShift(n);
    });
  };
  // moved by dx, dy (px), scaled by f round q (px from the frame's corner) within the zoom's limits. drawn again only
  // once the frame gets near the edge of what's drawn (OVERSCAN: from -w/2 to 3w/2 at scale 1) or it's six times as big
  // and blurred
  const nudge = (dx: number, dy: number, f = 1, qx = 0, qy = 0) => {
    const svg = sheetRef.current;
    const frame = frameRef.current;
    if (!svg || !frame) return;
    const sh = (shift.current ??= {tx: 0, ty: 0, s: 1});
    const size = (pending.current.at(-1)?.view ?? drawnView.current ?? {size: WIDTH}).size / sh.s;
    f = size / Math.min(WIDTH * 4, Math.max(WIDTH / MAX_ZOOM, size / f));
    sh.tx = f * (sh.tx - qx) + qx + dx;
    sh.ty = f * (sh.ty - qy) + qy + dy;
    sh.s *= f;
    show();
    // against what's drawn now, the view before the pending ones
    const {tx, ty, s} = moved();
    const w = frame.clientWidth || 1;
    const covers = (t: number) => t - (s * w * (SPAN - 1)) / 2 <= -0.05 * w && t + (s * w * (SPAN + 1)) / 2 >= 1.05 * w;
    if (!covers(tx) || !covers(ty) || s > 6) commitShift();
  };
  // a button's or the wheel's zoom by factor (<1 = in) round q (px from the frame's corner) as a shift, the view set
  // from it once it's there. a button's eases out over a few frames, a click during it adds to what's left (a css
  // transition would have it drawn at the end's size first), the wheel's goes at once and is set a moment after its last
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = useRef(commitShift);
  const easing = useRef({left: 0, frame: 0, qx: 0, qy: 0});
  const zoomShift = (factor: number, qx: number, qy: number, ease: boolean) => {
    moving();
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    if (!ease) {
      nudge(0, 0, 1 / factor, qx, qy);
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        settle.current();
      }, 200);
      return;
    }
    const z = easing.current;
    Object.assign(z, {left: z.left - Math.log(factor), qx, qy});
    if (z.frame) return;
    let last: number | null = null;
    const step = (now: number) => {
      // each frame a part of what's left, most of it in the first 150 ms
      const d = Math.abs(z.left) < 0.004 ? z.left : z.left * (1 - Math.exp(-Math.max(0, now - (last ?? now - 16)) / 50));
      last = now;
      z.left -= d;
      nudge(0, 0, Math.exp(d), z.qx, z.qy);
      z.frame = z.left ? requestAnimationFrame(step) : 0;
      if (!z.frame) settle.current();
    };
    z.frame = requestAnimationFrame(step);
  };
  useLayoutEffect(() => {
    settle.current = commitShift;
    wheel.current = (factor, clientX, clientY) => {
      const box = frameRef.current?.getBoundingClientRect();
      if (box && !following && !glides) return zoomShift(factor, clientX - box.left, clientY - box.top, false);
      const p = clientToSvg(clientX, clientY);
      if (p) zoomAt(factor, p[0], p[1]);
    };
  });
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      cancelAnimationFrame(easing.current.frame);
    },
    [],
  );
  // following the mower the frame loop slides the map (slide): a zoom still easing or waiting to be set is dropped, and
  // so are the shifts not drawn yet
  useLayoutEffect(() => {
    if (!glides) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    cancelAnimationFrame(easing.current.frame);
    Object.assign(easing.current, {left: 0, frame: 0});
    shift.current = null;
    pending.current = [];
  }, [glides]);
  // the views set from shifts drawn: only the shift since on the map, in the same frame
  useLayoutEffect(() => {
    if (!pending.current.some((p) => p.n <= drawnShift)) return;
    pending.current = pending.current.filter((p) => p.n > drawnShift);
    show();
  });

  const onPointerMove = (e: React.PointerEvent<Element>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!zoomable || !prev || dragging) return;
    // a mouse let go where its up didn't come here: the pan ended there
    if (e.pointerType === 'mouse' && e.buttons === 0) return onPointerEnd(e);
    const svg = svgRef.current;
    if (!svg) return;

    pointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
    const pts = [...pointers.current.values()];

    if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const [mx, my] = [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2];
      const mid = clientToSvg(mx, my);
      const box = frameRef.current?.getBoundingClientRect();
      const last = gesture.current.pinchMid ?? [mx, my];
      if (gesture.current.pinchDist && following && mid) zoomAt(gesture.current.pinchDist / dist, mid[0], mid[1]);
      else if (gesture.current.pinchDist && box && !glides) {
        moving();
        // scaled round where the fingers' middle was and moved along with it: what's under the fingers stays there
        nudge(mx - last[0], my - last[1], dist / gesture.current.pinchDist, last[0] - box.left, last[1] - box.top);
      }
      gesture.current = {moved: true, pinchDist: dist, pinchMid: [mx, my]};
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
    moving();
    if (glides || !frameRef.current) {
      const v = base ?? {x: 0, y: 0, size: WIDTH};
      const unitsPerPx = v.size / svg.getBoundingClientRect().width;
      setView({...v, x: v.x - dx * unitsPerPx, y: v.y - dy * unitsPerPx});
    } else nudge(dx, dy);
  };

  const onPointerEnd = (e: {pointerId: number; type: string}) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = {...gesture.current, pinchDist: null, pinchMid: undefined};
    if (pointers.current.size === 0) commitShift();
    const h = hold.current;
    if (h && h.press.pointerId === e.pointerId) {
      dropHold();
      if (e.type !== 'pointerup' || gesture.current.moved) return;
      // a tap on a pin picks it, not a click on the map as well
      if (h.pin) {
        gesture.current.moved = true;
        onSelectArea?.(h.areaId);
      } else tapHandle(h.areaId, h.hit);
    }
  };
  // a mouse let go outside the frame: its up goes to what's under it there, the pan ends all the same
  const pointerEnd = useRef(onPointerEnd);
  useLayoutEffect(() => {
    pointerEnd.current = onPointerEnd;
  });
  useEffect(() => {
    const onUp = (e: PointerEvent) => {
      if (pointers.current.has(e.pointerId)) pointerEnd.current(e);
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

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
      // a picture's handle: turned in steps of 5°, sized in steps of 10 cm, kept with the app's settings once the step
      // changes (each save draws the garden again)
      if (dragging.areaId === THING) {
        const t = thingDrag.current;
        const p = clientToSvg(e.clientX, e.clientY);
        if (!d.moved) {
          if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < (d.touch ? 6 : 3)) return;
          d.moved = true;
          onDragging?.(true);
        }
        if (!t || !p) return;
        const cur = settingsStore.snapshot();
        if (t.kind === 'turn') {
          const deg = (Math.atan2(p[1] - t.cy, p[0] - t.cx) * 180) / Math.PI + (t.reaches ? 0 : 90);
          const turn = (Math.round((((deg % 360) + 360) % 360) / 5) * 5) % 360;
          if (cur.lookTurns?.[t.areaId] !== turn) saveSettings({...cur, lookTurns: {...cur.lookTurns, [t.areaId]: turn}});
        } else {
          const size = Math.max(0.1, Math.round(t.size * (Math.hypot(p[0] - t.cx, p[1] - t.cy) / t.dist) * 10) / 10);
          if (cur.lookSizes?.[t.areaId] !== size) saveSettings({...cur, lookSizes: {...cur.lookSizes, [t.areaId]: size}});
        }
        return;
      }
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
      const s = local && !e.altKey ? snapAt(local[0], local[1], dragging.areaId === PENDING ? (selectedAreaId ?? null) : dragging.areaId, d.touch) : null;
      const [x, y] = s ? [s.x, s.y] : local ? [local[0] + (d.off?.x ?? 0), local[1] + (d.off?.y ?? 0)] : [0, 0];
      const rect = (frameRef.current ?? svgRef.current)?.getBoundingClientRect();
      const at = d.touch && rect ? {x: e.clientX - rect.left, y: e.clientY - rect.top, width: rect.width} : null;
      // a point of an area or a pin: only it goes along, the map gets it once it's let go
      if (dragging.areaId !== PENDING) {
        if (!local || !onMoveVertex) return;
        d.at = {x, y};
        live.set({x, y, snap: s, finger: at});
        return;
      }
      setSnapMark(s);
      if (local && dragging.areaId === PENDING) onMovePending?.(dragging.index, x, y);
      else if (local) onMoveVertex?.(dragging.areaId, dragging.index, x, y);
      if (at) setFinger(at);
    };
    // the point of an area moved where it was let go
    const putDown = () => {
      const d = drag.current;
      if (d.at && d.moved && dragging.areaId !== PENDING) onMoveVertex?.(dragging.areaId, dragging.index, d.at.x, d.at.y);
      d.at = undefined;
      live.set(null);
    };
    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      if (e.pointerId !== d.pointerId) return;
      // handled, a repeated up for the same finger does nothing
      d.pointerId = -1;
      if (dragging.areaId === THING) {
        thingDrag.current = null;
        setDragging(null);
        onDragging?.(false);
        return;
      }
      putDown();
      if (!d.moved && d.insert) {
        // a tap on an edge midpoint adds the point there
        addPoint(d.insert.x, d.insert.y);
        setActive(null);
      } else if (!d.moved && dragging.areaId !== PENDING && !d.off) {
        const same = active?.areaId === dragging.areaId && active.index === dragging.index;
        setActive(same ? null : {areaId: dragging.areaId, index: dragging.index});
      } else {
        setActive(null);
      }
      setDragging(null);
      // moved, it's let go once its garden is worked out (above). a pin's picture right away where it went
      if (!d.moved || d.off) setHeld(null);
      setFinger(null);
      setSnapMark(null);
      onDragging?.(false);
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== drag.current.pointerId) return;
      drag.current.pointerId = -1;
      putDown();
      setDragging(null);
      if (!drag.current.moved || drag.current.off) setHeld(null);
      setFinger(null);
      setSnapMark(null);
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

  // an empty map is drawn while points are set on it: a frame round 0,0 without a mower to put it round
  if (map.areas.length === 0 && !mower && !pickingPoints) return null;


  const sources = datum ? availableSources(datum, settings.imagery) : [];
  const source = imagery && sources.length ? (sources.includes(imagery) ? imagery : sources[0]) : null;
  const savedShift = source ? imageryShift(source, settings.imagery) : null;
  // esri's tiles all fail with a key it doesn't take: said once two have failed and none has loaded with it, a tile that
  // loads takes that back (other sources have no key)
  const esriKey = source === 'esri' ? (settings.imagery?.esriKey?.trim() ?? '') : null;
  if (rejectedKey !== null && esriKey === null) setRejectedKey(null);
  const imageryRejected = esriKey !== null && rejectedKey === esriKey && loadedKey !== esriKey;
  let tiles: ReturnType<typeof imageryTiles> = [];
  if (zoomable && datum && source && svgPx > 0) {
    const v = svgBox;
    const [left, bottom] = toLocal(v.x, v.y + v.size);
    const [right, top] = toLocal(v.x + v.size, v.y);
    const metersPerPixel = 1 / ((pxPerMeter * svgPx) / WIDTH);
    tiles = imageryTiles(source, datum, {left, right, bottom, top, metersPerPixel}, settings.imagery, aligning ?? savedShift ?? undefined);
  }
  // kept with the settings, for every device: per source, none when it's back at nothing
  const saveShift = (shift: [number, number]) => {
    if (!source) return;
    const cur = settingsStore.snapshot();
    const offsets = {...cur.imagery?.offsets};
    if (Math.abs(shift[0]) < 0.005 && Math.abs(shift[1]) < 0.005) delete offsets[source];
    else offsets[source] = shift;
    saveSettings({...cur, imagery: {...cur.imagery, offsets: Object.keys(offsets).length ? offsets : undefined}});
  };

  let grid: ReturnType<typeof meterGrid> | null = null;
  if (zoomable && showGrid) {
    const v = svgBox;
    const [left, bottom] = toLocal(v.x, v.y + v.size);
    const [right, top] = toLocal(v.x + v.size, v.y);
    grid = meterGrid({left, right, bottom, top}, pxPerMeter);
  }

  // as big as the points of the area picked up while one of them is dragged, they don't all change with every move
  const heldArea = held && selectedArea ? held.map.areas.find((a) => a.id === selectedArea.id) : undefined;
  const vertexR = selectedArea ? handleRadius((heldArea ?? selectedArea).outline, pxPerMeter) : 2.5;

  // k = svg units per screen unit, the loupe passes its own so handles don't get magnified
  // an area's picture standing in it (a tree, a table ...), with the garden's life drawn over the lawn's (scene.things)
  const thingOf = (area: MapArea) => {
    const thing = gardenLook?.things.get(area.id);
    return thing ? <GardenThing uid={uid} thing={thing} off={area.properties.active === false} part="ground" /> : null;
  };
  // the crowns and parasols over everything on the ground and the mower too, where they hide it the mower shows as its
  // outline (the garden's life has them as well)
  const shownThings = gardenLook ? areasBySize.filter((a) => !hidden.has(a.properties.type as Layer)).flatMap((a) => gardenLook.things.get(a.id) ?? []) : [];
  const overThings = shownThings.filter((t) => t.places.some((pl) => pl.over));
  const canopies = scene
    ? glidingPin
      ? withoutKey(scene.canopies, 'c' + glidingPin.id)
      : scene.canopies
    : overThings
        .filter((t) => t.id !== glidingPin?.id)
        .map((t) => <GardenThing key={'c' + t.id} uid={uid} thing={t} off={shapeMap.areas.find((a) => a.id === t.id)?.properties.active === false} part="over" />);
  const covers = scene ? scene.covers : coversOf(overThings);
  // the plan's lanes and loops, under the dock and the track
  const planLines = (
    <>
      {loopsPath && !hidden.has('stripes') && <path className={styles.stripes} d={loopsPath} />}
      {stripesPath && !hidden.has('stripes') && <path className={styles.stripes} d={stripesPath} />}
      {piecePaths && !hidden.has('stripes') && (
        <>
          {piecePaths.mowed && <path className={styles.stripes} d={piecePaths.mowed} />}
          {turnsOn && piecePaths.turns && <path className={styles.stripes} d={piecePaths.turns} />}
          {transitOn && piecePaths.transit && <path className={styles.planTransit} d={piecePaths.transit} />}
        </>
      )}
    </>
  );
  // the real edges, the strip the blade cut and the track of the pieces that are done, and what's left to mow with the
  // strip and the track of the piece that grows
  const swathShown = !scene?.parts.growth || !!pastTrack?.length || !!beforeTrack?.length;
  // with the garden's stones along the lawns' real edges only the obstacles' line (the loupe has no stones)
  const settledOf = (stones: boolean) => (
    <>
      {edges && (stones ? edges.obstacleLine : edges.line) && <path className={styles.realEdge} d={stones ? edges.obstacleLine : edges.line} />}
      {swathShown && swathSettled}
      {trackSettled}
    </>
  );
  const settledLines = settledOf(!!scene?.stones);
  const liveLines = (
    <>
      {todoPath && !hidden.has('stripes') && <path className={[styles.planTodo, styles[planStyle]].join(' ')} d={todoPath} />}
      {swathShown && swathLive}
      {trackLive}
      {sim && !hidden.has('track') && (
        <SimTrail frames={sim.frames} clock={sim.clock} fit={{minX, minY, m: scale, padX, padY}} body={body} swath={swathOn} transit={!hidden.has('transit')} />
      )}
    </>
  );
  const lateLines = (
    <>
      {settledLines}
      {liveLines}
    </>
  );
  // part: the map on the ground, the lines that grow while the mower drives (the strip the blade cut, the track, what's
  // left to mow), or what's over it and changes often (the mower, the crowns over it, the picked area and its points),
  // drawn as layers on a map that can move: a mower driving along doesn't draw all the garden again. loupe: all but the
  // garden's pictures, it comes up with every point picked up (their patterns would be on the page twice too)
  const renderContent = (k: number, part: Part = 'all') => (
    <>
      {drawsPart(part, 'ground') && (
        <>
      {tiles.length > 0 && (
        <g className={styles.imagery}>
          {tiles.map((t) => {
            const [p0, p1, p2] = t.corners.map((c) => toScreen(c.x, c.y));
            const m = [p1[0] - p0[0], p1[1] - p0[1], p2[0] - p0[0], p2[1] - p0[1], p0[0], p0[1]].join(' ');
            // a hair over the next tile, else a thin line of what's under them shows where they meet
            const over = (a: number[], b: number[]) => 1 + (0.75 * k) / Math.max(1e-9, Math.hypot(b[0] - a[0], b[1] - a[1]));
            return (
              <image
                key={t.href}
                href={t.href}
                width={over(p0, p1)}
                height={over(p0, p2)}
                preserveAspectRatio="none"
                transform={`matrix(${m})`}
                onError={
                  part !== 'loupe' && esriKey !== null && loadedKey !== esriKey && !imageryRejected
                    ? () => {
                        if (failedTiles.current.key !== esriKey) failedTiles.current = {key: esriKey, hrefs: new Set()};
                        const {hrefs} = failedTiles.current;
                        hrefs.add(t.href);
                        if (hrefs.size < 2) return;
                        setRejectedKey(esriKey);
                        setImageryHint(true);
                      }
                    : undefined
                }
                onLoad={part !== 'loupe' && esriKey !== null && loadedKey !== esriKey ? () => setLoadedKey(esriKey) : undefined}
              />
            );
          })}
        </g>
      )}
        {edges?.grassOutside && <path className={styles.realGrass} d={edges.grassOutside} />}
        {areasBySize.filter((area) => !hidden.has(area.properties.type as Layer)).map((area) => {
          // a pin is only its picture, its square isn't drawn. the loupe has the one being dragged
          if (isPin(area))
            return (
              <Fragment key={area.id}>{area.id !== glidingPin?.id && (part === 'loupe' ? area.id === dragging?.areaId : !scene) && thingOf(area)}</Fragment>
            );
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
                // (decorating the taps go by themselves, see onClick)
                style={decor ? {...gardenFill(area), pointerEvents: 'none'} : gardenFill(area)}
                data-area
                onClick={(e) => {
                  if (!pickingPoints && editing && !decor) selectAt(area.id, e.clientX, e.clientY);
                }}
              />
              {!scene && part !== 'loupe' && thingOf(area)}
            </Fragment>
          );
        })}
        {part !== 'loupe' && scene?.lawn}
        {edges?.grassObstacles && <path className={styles.realGrass} d={edges.grassObstacles} />}
        {part !== 'loupe' && (
          <>
            {scene?.stones}
            {glidingPin ? withoutKey(scene?.things, 't' + glidingPin.id) : scene?.things}
            {scene?.sky}
            {coverLayer}
          </>
        )}

        {planLines}

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

        </>
      )}
      {drawsPart(part, 'settled') && (part === 'loupe' ? settledOf(false) : settledLines)}
      {drawsPart(part, 'live') && liveLines}
      {drawsPart(part, 'over') && (
        <>
        {markerMower && (
          <MowerMarker
            mower={markerMower}
            poses={sim ? sim.clock : livePoses}
            fit={drawn}
            k={k}
            icons={settings.icons}
            body={body}
            // without the icon the outline shows where the mower is
            outline={!!body && (layerOn(hidden, 'body') || !layerOn(hidden, 'mowerIcon'))}
            showIcon={!body || layerOn(hidden, 'mowerIcon')}
            emergency={emergency}
            blades={!sim && track?.at(-1)?.at(-1)?.b === true}
            ghost={halloween.night}
            costume={{hat: halloween.day, towel: costume?.towel, umbrella: costume?.umbrella}}
            cover={part === 'loupe' ? undefined : canopies}
            covers={part === 'loupe' ? undefined : covers}
            coverId={uid + 'under'}
          />
        )}
        {part !== 'loupe' && !markerMower && canopies}
        {/* the plan, the real edges and the track over the crowns too, only where they are (else they'd be twice) */}
        {part !== 'loupe' && covers.length > 0 && (
          <>
            <defs>
              <mask id={uid + 'rim'} maskUnits="userSpaceOnUse" x={-10 * WIDTH} y={-10 * HEIGHT} width={21 * WIDTH} height={21 * HEIGHT}>
                {covers.map((c, i) =>
                  c.pts ? <polygon key={i} points={c.pts.map((p) => p.join(',')).join(' ')} fill="#fff" /> : <circle key={i} cx={c.cx} cy={c.cy} r={c.rim} fill="#fff" />,
                )}
              </mask>
            </defs>
            <g mask={`url(#${uid}rim)`}>
              {planLines}
              {lateLines}
            </g>
          </>
        )}

        {/* decorating: a ring round each pin's middle, the picked one has its frame */}
        {decor &&
          map.areas.map((a) => {
            if (!isPin(a) || a.id === selectedAreaId || !a.outline.length) return null;
            const pl = gardenLook?.things.get(a.id)?.places[0];
            const [cx, cy] = pl ? [pl.cx, pl.cy] : toScreen(pinAt(a).x, pinAt(a).y);
            // round the picture when it's small, else a small one in its middle (and under a crown or a parasol)
            const r = Math.min(Math.max(pl && !pl.over ? Math.max(pl.w, pl.h) / 2 + 2 * k : 0, 7 * k), 14 * k);
            return (
              <g key={'pin' + a.id} className={styles.pinRing}>
                <circle cx={cx} cy={cy} r={r} />
                <circle cx={cx} cy={cy} r={r} />
              </g>
            );
          })}

        {selectedArea &&
          (gliding && dragging ? (
            <LiveDrag live={live} outline={selectedArea.outline} index={dragging.index} toScreen={toScreen} k={k} part="outline" />
          ) : (
            <>
              {/* a dark rim under it in the garden style */}
              <polygon points={selectedArea.outline.map((p) => toScreen(p.x, p.y).join(',')).join(' ')} className={styles.selectedHalo} />
              <polygon
                points={selectedArea.outline.map((p) => toScreen(p.x, p.y).join(',')).join(' ')}
                className={styles.selected}
              />
            </>
          ))}

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


        {/* (not while a simulated drive plays back on it: the mower and its trail would go under them) */}
        {selectedArea && !pickingPoints && !sim && (
          <>
            {onInsertVertex &&
              !gliding &&
              selectedArea.outline.map((p, i) => {
                const next = selectedArea.outline[(i + 1) % selectedArea.outline.length];
                if (!showMidpoint(p, next)) return null;
                const [sx, sy] = toScreen((p.x + next.x) / 2, (p.y + next.y) / 2);
                return <circle key={i} cx={sx} cy={sy} r={2 * k} className={styles.midpoint} />;
              })}

            {selectedArea.outline.map((p, i) => {
              if (gliding && i === dragging?.index) return null;
              const [sx, sy] = toScreen(p.x, p.y);
              return (
                <Fragment key={i}>
                  <circle cx={sx} cy={sy} r={(i === activeIndex ? 4 : vertexR) * k} className={i === activeIndex ? styles.activeVertex : styles.vertex} />
                </Fragment>
              );
            })}
          </>
        )}

        {handles && (
          <g className={styles.thingHandles}>
            {handles.frame && <polygon points={handles.frame.map((q) => q.join(',')).join(' ')} className={styles.thingFrame} />}
            {handles.turn && (
              <g transform={`translate(${handles.turn[0]} ${handles.turn[1]})`}>
                <circle r={9 * k} className={styles.thingHandle} />
                <path
                  d={`M${-4.5 * k} ${-1 * k}A${4.5 * k} ${4.5 * k} 0 1 1 ${-1 * k} ${4.4 * k}M${-4.6 * k} ${-4.4 * k}L${-4.5 * k} ${-1 * k}L${-1.2 * k} ${-1.4 * k}`}
                  className={styles.thingIcon}
                />
              </g>
            )}
            <g transform={`translate(${handles.size[0]} ${handles.size[1]})`}>
              <circle r={9 * k} className={styles.thingHandle} />
              <path
                d={`M${-4 * k} ${4 * k}L${4 * k} ${-4 * k}M${0.5 * k} ${-4 * k}H${4 * k}V${-0.5 * k}M${-4 * k} ${0.5 * k}V${4 * k}H${-0.5 * k}`}
                className={styles.thingIcon}
              />
            </g>
            {dragging?.areaId === THING && selectedAreaId && (
              <text
                className={styles.thingLabel}
                x={(dragging.index === 0 && handles.turn ? handles.turn : handles.size)[0]}
                y={(dragging.index === 0 && handles.turn ? handles.turn : handles.size)[1] - 14 * k}
                fontSize={11 * k}
              >
                {dragging.index === 0 ? `${settings.lookTurns?.[selectedAreaId] ?? 0}°` : `${fmt(settings.lookSizes?.[selectedAreaId] ?? 0, 1)} m`}
              </text>
            )}
          </g>
        )}

        {gliding && selectedArea && dragging && (
          <LiveDrag live={live} outline={selectedArea.outline} index={dragging.index} toScreen={toScreen} k={k} part="point" />
        )}
        {glidingPin && gardenLook?.things.get(glidingPin.id) && (
          <LivePin live={live} thing={gardenLook.things.get(glidingPin.id)!} uid={uid} from={pinAt(glidingPin)} scale={scale} toScreen={toScreen} k={k} />
        )}
        {snapMark && (
          <circle
            className={snapMark.corner ? styles.snapCorner : styles.snapEdge}
            cx={toScreen(snapMark.x, snapMark.y)[0]}
            cy={toScreen(snapMark.x, snapMark.y)[1]}
            r={(snapMark.corner ? 7 : 5) * k}
          />
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
      )}
    </>
  );

  // the pointer on the map: on the svg, or on the sheet both layers lie on
  const events = {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onClickCapture: (e: React.MouseEvent) => {
      // swallow the click at the end of a pan/pinch
      if (gesture.current.moved) {
        e.stopPropagation();
        gesture.current.moved = false;
      }
    },
    onDoubleClick: (e: React.MouseEvent) => {
      if (!editing) return;
      const hit = pickHandle(e.clientX, e.clientY, false);
      if (hit && !hit.mid && selectedArea && selectedArea.outline.length > 3) {
        onDeleteVertex?.(selectedArea.id, hit.index);
        setActive(null);
      }
    },
    onClick: (e: React.MouseEvent) => {
      setActive(null);
      // with the coverage on, a tap also shows the numbers of the square under it (or closes them off the squares)
      if (!pickingPoints && coverMode !== 'off' && coverage) {
        const local = clientToLocal(e.clientX, e.clientY);
        const c = local
          ? coverage.find((q) => q.seconds >= MIN_SECONDS && local[0] >= q.x && local[0] < q.x + CELL_M && local[1] >= q.y && local[1] < q.y + CELL_M)
          : undefined;
        setCoverCell(c && c !== coverCell ? c : null);
      }
      // decorating: a tap sets the picture picked, else picks the pin it hits or lets the picked one go. a tap on an area's
      // picture says where that one is changed
      if (decor) {
        const local = editing ? clientToLocal(e.clientX, e.clientY) : null;
        if (!local) return;
        if (decor.armed) return onCanvasClick?.(local[0], local[1]);
        const pin = pickPin(e.clientX, e.clientY);
        if (pin) return onSelectArea?.(pin.id);
        onClickEmpty?.();
        const owner = areasBySize
          .filter((a) => !isPin(a) && !hidden.has(a.properties.type as Layer) && gardenLook?.things.has(a.id) && containsPoint(a.outline, local[0], local[1]))
          .at(-1);
        if (!owner) return;
        const name = owner.properties.name;
        const text = name ? tr('Belongs to the area "{name}", tap it after Finish.', {name}) : tr('Belongs to an area, tap it after Finish.');
        setAreaHint((h) => ({text, n: (h?.n ?? 0) + 1}));
        return;
      }
      if (!pickingPoints && !(e.target as Element).closest('[data-area]')) onClickEmpty?.();
      if (!pickingPoints || !onCanvasClick || !editing) return;
      const local = clientToLocal(e.clientX, e.clientY);
      if (!local) return;
      const s = e.altKey ? null : snapAt(local[0], local[1], selectedAreaId ?? null, (e.nativeEvent as PointerEvent).pointerType !== 'mouse');
      onCanvasClick(s ? s.x : local[0], s ? s.y : local[1]);
    },
  };
  // what's drawn over everything else: the check's spots and bodies, the markers
  const after = (
    <>
      {leftPieces?.map((piece, i) => (
        <polygon key={'left' + i} className={styles.leftPiece} points={piece.map((p) => toScreen(p.x, p.y).join(',')).join(' ')} />
      ))}
      {navErrors?.map((p, i) => {
        const [x, y] = toScreen(p.x, p.y);
        const r = 7 * k;
        return <path key={'nav' + i} className={styles.navError} d={`M ${x - r} ${y - r} L ${x + r} ${y + r} M ${x - r} ${y + r} L ${x + r} ${y - r}`} />;
      })}
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
    </>
  );
  const layered = zoomable || glides;
  const svg = (
    <svg
      ref={attachSvg}
      className={[styles.svg, zoomable ? styles.zoomable : '', garden ? styles.garden : ''].filter(Boolean).join(' ')}
      // for the page around it: the garden style's paving lets the page show through
      data-garden={garden || undefined}
      // (gliding along the mower: twice the window around the anchor, slid along under the frame above; a map that can be
      // moved: twice the view round its middle)
      viewBox={glides ? `${gx - glideSize} ${gy - glideSize} ${2 * glideSize} ${2 * glideSize}` : `${svgBox.x} ${svgBox.y} ${svgBox.size} ${svgBox.size}`}
      style={layered ? LAYER : undefined}
      {...(layered ? {} : events)}
    >
      {gardenLook?.defs}
      {scene?.defs}
      <Ground draw={() => renderContent(k, layered ? 'ground' : 'all')} held={held} view={`${k} ${svgBox.x} ${svgBox.y} ${svgBox.size} ${layered}`} />
      {!layered && after}
    </svg>
  );
  if (!zoomable && !glides) return svg;

  // magnified copy of the map above the finger, the finger hides the point otherwise
  let loupe = null;
  const draggedPin = dragging ? map.areas.find((a) => a.id === dragging.areaId && isPin(a)) : undefined;
  const dragged =
    dragging && (dragging.areaId === PENDING ? pendingPoints?.[dragging.index] : draggedPin ? pinAt(draggedPin) : selectedArea?.outline[dragging.index]);
  if ((gliding && selectedArea) || glidingPin) {
    loupe = (
      <LiveLoupe live={live} toScreen={toScreen} size={shown?.size ?? WIDTH} garden={garden}>
        {renderContent(k / LOUPE_ZOOM, 'loupe')}
      </LiveLoupe>
    );
  } else if (finger && dragged) {
    loupe = (
      <Loupe finger={finger} at={toScreen(dragged.x, dragged.y)} size={shown?.size ?? WIDTH} garden={garden}>
        {renderContent(k / LOUPE_ZOOM, 'loupe')}
      </Loupe>
    );
  }

  return (
    <div className={styles.wrap}>
      <div ref={frameRef} className={[styles.frame, glides ? styles.frameGliding : ''].filter(Boolean).join(' ')}>
        <div ref={sheetRef} style={glides ? GLIDING : OVERSCAN} {...events}>
          {svg}
          {(['settled', 'live'] as const).map((part) => (
            <svg key={part} className={[styles.svg, zoomable ? styles.zoomable : '', garden ? styles.garden : ''].filter(Boolean).join(' ')} viewBox={svg.props.viewBox} style={OVER}>
              {renderContent(k, part)}
            </svg>
          ))}
          <svg
            className={[styles.svg, zoomable ? styles.zoomable : '', garden ? styles.garden : ''].filter(Boolean).join(' ')}
            viewBox={svg.props.viewBox}
            style={OVER}
          >
            {renderContent(k, 'over')}
            {after}
          </svg>
        </div>
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
      {zoomable && !bare && (
        <MapControls
          onZoom={zoomCenter}
          showGrid={showGrid}
          onToggleGrid={toggleGrid}
          sources={sources}
          source={source}
          lastSource={lastImagery}
          imagerySettings={settings.imagery}
          onSource={setImagery}
          align={
            savedShift
              ? {
                  shift: aligning,
                  onStart: () => setAligning(savedShift),
                  onChange: setAligning,
                  onDone: () => {
                    if (aligning) saveShift(aligning);
                    setAligning(null);
                  },
                }
              : undefined
          }
          hidden={hidden}
          onToggleLayer={toggleLayer}
          layersOpen={layersOpen}
          onLayersOpen={setLayersOpen}
          body={body ? {blade: body.blade > 0} : undefined}
          planParts={!!pieces?.length}
          planner={!!plannerSettings}
          coverage={
            // on the maps to look around in, with MowBite's container (it keeps the gps log). wifi off once the log has none.
            // not while decorating, undo, redo and finish are there
            zoomable && updates.level !== null && !decor
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
          snap={editing ? snap : undefined}
          decorate={editing ? onDecorate : undefined}
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
      )}
      {grid && <span className={styles.gridLabel} data-grid-label>{tr('grid {n} m', {n: fmt(grid.step, grid.step < 1 ? 1 : 0)})}</span>}
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
      {areaHint && !holdHint && (
        <div key={areaHint.n} className={[styles.hintToast, styles.hintLong].join(' ')}>
          {areaHint.text}
        </div>
      )}
      {imageryHint && imageryRejected && <div className={styles.hintToast}>{tr('Esri key rejected or expired')}</div>}
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
