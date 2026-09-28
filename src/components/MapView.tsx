'use client';

import type {MowerMap, Point} from '@/hooks/useMowerMap';
import {useEasedPose} from '@/hooks/useEasedPose';
import {containsPoint, polygonArea} from '@/lib/geometry';
import {settingsStore} from '@/lib/settings';
import {dockIcon, mowerIcon} from './mapIcons';
import {availableSources, imageryTiles, type Datum, type ImagerySource} from '@/lib/imagery';
import {handleRadius, meterGrid} from '@/lib/mapGrid';
import MapControls, {layerOn, type Layer} from './MapControls';
import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import styles from './MapView.module.css';
import {tr, useLang} from '@/lib/i18n';

interface MapViewProps {
  map: MowerMap;
  mower?: {x: number; y: number; heading: number};
  selectedAreaId?: string | null;
  onSelectArea?: (id: string) => void;
  onMoveVertex?: (areaId: string, vertexIndex: number, x: number, y: number) => void;
  onDragStart?: () => void;
  onInsertVertex?: (areaId: string, vertexIndex: number, x: number, y: number) => void;
  onDeleteVertex?: (areaId: string, vertexIndex: number) => void;
  // clicks report map coords instead of selecting (split line, new area)
  pickingPoints?: boolean;
  pendingPoints?: Point[];
  onCanvasClick?: (x: number, y: number) => void;
  onMovePending?: (index: number, x: number, y: number) => void;
  onInsertPending?: (index: number, x: number, y: number) => void;
  // fixed window around the mower instead of fitting the whole map
  follow?: boolean;
  followSpanMeters?: number;
  // oldest first
  track?: (Point & {b?: boolean})[];
  // a recorded job instead of the live trail, mowed parts solid, driving without blades dashed
  pastTrack?: {points: Point[]; blades: boolean}[];
  // wheel / pinch zoom, drag to pan
  zoomable?: boolean;
  // mowing direction preview
  stripes?: Point[][];
  // the outline passes of the mowing plan, drawn with the stripes
  loops?: Point[][];
  // how far the current run got in the mower's plan: what's left is drawn, the planned part it has done only if
  // switched on in the layer menu (the track shows what it really drove)
  progress?: {done: Point[][]; todo: Point[][]};
  // shapes an edit would give (split pieces, merge result), drawn in two alternating colors
  preview?: Point[][];
  // click on the map where there's no area
  onClickEmpty?: () => void;
  // gps datum of the map, enables the aerial imagery option
  datum?: Datum;
  // numbers drawn in areas, e.g. mowing order
  orderLabels?: Record<string, number>;
  // spots to point out, e.g. where an error happened (red, pulsing)
  markers?: Point[];
  // start zoomed in around this point instead of showing the whole map
  focus?: Point;
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
// dragging.areaId while a point of the line being drawn is dragged
const PENDING = '__pending';

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

const PADDING = 20;
const MOWER_SIZE = 0.4; // m
const WIDTH = 400;
const HEIGHT = 400;


export default function MapView({
  map,
  mower,
  selectedAreaId,
  onSelectArea,
  onMoveVertex,
  onDragStart,
  onInsertVertex,
  onDeleteVertex,
  pickingPoints,
  pendingPoints,
  onCanvasClick,
  onMovePending,
  onInsertPending,
  follow = false,
  followSpanMeters = 6,
  track,
  pastTrack,
  progress,
  zoomable = false,
  stripes,
  loops,
  preview,
  overlay,
  markers,
  focus,
  onClickEmpty,
  datum,
  orderLabels,
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
  const drag = useRef({startX: 0, startY: 0, moved: false, inserted: false, touch: false});
  // finger position while dragging on touch, drives the loupe
  const [finger, setFinger] = useState<{x: number; y: number; width: number} | null>(null);
  // tapped point, gets a delete button
  const [active, setActive] = useState<{areaId: string; index: number} | null>(null);
  const [view, setView] = useState<View | null>(null);
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  // in follow mode zooming changes how many meters around the mower are shown
  const [followZoom, setFollowZoom] = useState(1);
  // off by default, it sends the map area to the imagery provider
  const [imagery, setImagery] = useState<ImagerySource | null>(() => {
    try {
      return (localStorage.getItem('mapImagery') as ImagerySource | null) || null;
    } catch {
      return null;
    }
  });
  const [svgPx, setSvgPx] = useState(0);
  // only mounted client side once the map arrived, so localStorage is fine here
  const [showGrid, setShowGrid] = useState(() => {
    try {
      return localStorage.getItem('mapGrid') !== 'off';
    } catch {
      return true;
    }
  });
  // layers switched off in the layer menu, remembered per device like the grid
  const [hidden, setHidden] = useState<Set<Layer>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('mapHidden') ?? '[]'));
    } catch {
      return new Set();
    }
  });
  const [layersOpen, setLayersOpen] = useState(false);
  const toggleLayer = (l: Layer) => {
    const next = new Set(hidden);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    setHidden(next);
    try {
      localStorage.setItem('mapHidden', JSON.stringify([...next]));
    } catch {}
  };
  const pointers = useRef(new Map<number, {x: number; y: number}>());
  const gesture = useRef<{moved: boolean; pinchDist: number | null}>({moved: false, pinchDist: null});
  const smoothedMower = useEasedPose(mower ?? {x: 0, y: 0, heading: 0});
  const displayMower = mower ? smoothedMower : undefined;

  // fitted to the map only, so the geometry doesn't change while the mower moves. follow mode
  // moves the view instead
  const fit = useMemo(() => {
    const points = [...map.areas.flatMap((a) => a.outline), ...(pendingPoints ?? [])];
    if (!points.length) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return {minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys)};
  }, [map, pendingPoints]);

  const center = displayMower ?? {x: 0, y: 0};
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

  // map y points north, svg y points down
  const toScreen = (x: number, y: number): [number, number] => [(x - minX) * scale + padX, HEIGHT - ((y - minY) * scale + padY)];
  const toLocal = (sx: number, sy: number): [number, number] => [(sx - padX) / scale + minX, (HEIGHT - sy - padY) / scale + minY];

  // about 12 m around the focus point, until the user zooms or pans themselves
  const home: View | null = focus
    ? (() => {
        const [fx, fy] = toScreen(focus.x, focus.y);
        const size = Math.min(WIDTH, 12 * scale);
        return {x: fx - size / 2, y: fy - size / 2, size};
      })()
    : null;

  // what's shown: the user's zoom, or in follow mode a window around the mower
  let shown = view ?? home;
  if (follow && displayMower) {
    const [sx, sy] = toScreen(displayMower.x, displayMower.y);
    const size = followSpanMeters * followZoom * scale;
    shown = {x: sx - size / 2, y: sy - size / 2, size};
  }

  // outlines as svg point strings, rebuilt only when the map or the fit changes, not every frame
  const outlinePoints = useMemo(() => {
    const out = new Map<string, string>();
    for (const a of map.areas) {
      out.set(a.id, a.outline.map((p) => `${(p.x - minX) * scale + padX},${HEIGHT - ((p.y - minY) * scale + padY)}`).join(' '));
    }
    return out;
  }, [map, minX, minY, scale, padX, padY]);
  // the live trail cut where the blades go on or off, driving without them is drawn dashed
  const trackRuns = useMemo(() => {
    const runs: {points: string; blades: boolean}[] = [];
    if (!track || track.length < 2) return runs;
    const at = (p: Point) => `${(p.x - minX) * scale + padX},${HEIGHT - ((p.y - minY) * scale + padY)}`;
    let start = 0;
    for (let i = 1; i <= track.length; i++) {
      if (i < track.length && (track[i].b ?? true) === (track[start].b ?? true)) continue;
      // include the next point so the runs connect
      const pts = track.slice(start, Math.min(i + 1, track.length));
      if (pts.length >= 2) runs.push({points: pts.map(at).join(' '), blades: track[start].b ?? true});
      start = i;
    }
    return runs;
  }, [track, minX, minY, scale, padX, padY],
  );

  const selectedArea = map.areas.find((a) => a.id === selectedAreaId);
  const activeIndex =
    active && selectedArea && active.areaId === selectedArea.id && active.index < selectedArea.outline.length
      ? active.index
      : null;

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
    let best: {mid: boolean; index: number; x: number; y: number} | null = null;
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
    return best as {mid: boolean; index: number; x: number; y: number} | null;
  };

  // same for the points of a line that's being drawn (split, new area)
  const pickPending = (clientX: number, clientY: number, touch: boolean) => {
    const svg = svgRef.current;
    const local = clientToLocal(clientX, clientY);
    if (!svg || !local || !pickingPoints || !pendingPoints?.length || !onMovePending) return null;

    const reach = (touch ? 22 : 12) / ((pxPerMeter * svg.getBoundingClientRect().width) / WIDTH);
    let best: {mid: boolean; index: number; x: number; y: number} | null = null;
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
    return best as {mid: boolean; index: number; x: number; y: number} | null;
  };

  // zoom by factor (<1 = in) keeping the svg point (px, py) where it is on screen
  const zoomAt = (factor: number, px: number, py: number) => {
    if (follow) {
      setFollowZoom((z) => Math.min(8, Math.max(0.25, z * factor)));
      return;
    }
    setView((prev) => {
      const v = prev ?? home ?? {x: 0, y: 0, size: WIDTH};
      const size = Math.min(WIDTH * 4, Math.max(WIDTH / MAX_ZOOM, v.size * factor));
      const f = size / v.size;
      return {x: px - (px - v.x) * f, y: py - (py - v.y) * f, size};
    });
  };

  const zoomCenter = (factor: number) => {
    const v = view ?? home ?? {x: 0, y: 0, size: WIDTH};
    zoomAt(factor, v.x + v.size / 2, v.y + v.size / 2);
  };

  useEffect(() => {
    if (!svgEl) return;
    const ro = new ResizeObserver(() => setSvgPx(svgEl.getBoundingClientRect().width));
    ro.observe(svgEl);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoomAt only uses setters and follow
  }, [zoomable, follow, svgEl]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const pendingHit = pointers.current.size === 0 ? pickPending(e.clientX, e.clientY, e.pointerType !== 'mouse') : null;
    if (pendingHit) {
      const index = pendingHit.mid ? pendingHit.index + 1 : pendingHit.index;
      if (pendingHit.mid) onInsertPending?.(index, pendingHit.x, pendingHit.y);
      // inserted: true skips the undo snapshot, drawing isn't part of the map history yet
      drag.current = {startX: e.clientX, startY: e.clientY, moved: false, inserted: true, touch: e.pointerType !== 'mouse'};
      gesture.current.moved = true;
      setDragging({areaId: PENDING, index, bounds: {minX, maxX, minY, maxY}});
      return;
    }

    const hit = selectedArea && pointers.current.size === 0 ? pickHandle(e.clientX, e.clientY, e.pointerType !== 'mouse') : null;
    if (hit && selectedArea) {
      let index = hit.index;
      if (hit.mid) {
        index = hit.index + 1;
        onInsertVertex?.(selectedArea.id, index, hit.x, hit.y);
      }
      drag.current = {startX: e.clientX, startY: e.clientY, moved: false, inserted: hit.mid, touch: e.pointerType !== 'mouse'};
      gesture.current.moved = true; // eat the click that follows
      setDragging({areaId: selectedArea.id, index, bounds: {minX, maxX, minY, maxY}});
      return;
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
    if (!gesture.current.moved && Math.hypot(dx, dy) < 4) {
      // not a pan yet, don't eat the click
      pointers.current.set(e.pointerId, prev);
      return;
    }
    gesture.current.moved = true;
    if (follow) return; // the view is pinned to the mower
    const v = view ?? home ?? {x: 0, y: 0, size: WIDTH};
    const unitsPerPx = v.size / svg.getBoundingClientRect().width;
    setView({...v, x: v.x - dx * unitsPerPx, y: v.y - dy * unitsPerPx});
  };

  const onPointerEnd = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current.pinchDist = null;
  };

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
        d.moved = true;
        if (!d.inserted) onDragStart?.();
      }
      const local = clientToLocal(e.clientX, e.clientY);
      if (local && dragging.areaId === PENDING) onMovePending?.(dragging.index, local[0], local[1]);
      else if (local) onMoveVertex?.(dragging.areaId, dragging.index, local[0], local[1]);
      const rect = svgRef.current?.getBoundingClientRect();
      if (d.touch && rect) setFinger({x: e.clientX - rect.left, y: e.clientY - rect.top, width: rect.width});
    };
    const onUp = () => {
      const d = drag.current;
      if (!d.moved && !d.inserted) {
        const same = active?.areaId === dragging.areaId && active.index === dragging.index;
        setActive(same ? null : {areaId: dragging.areaId, index: dragging.index});
      } else {
        setActive(null);
      }
      setDragging(null);
      setFinger(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, scale, minX, minY]);

  if (map.areas.length === 0 && !displayMower && !pendingPoints?.length) return null;


  const sources = datum ? availableSources(datum, settings.imagery) : [];
  const source = imagery && sources.length ? (sources.includes(imagery) ? imagery : sources[0]) : null;
  const setSource = (next: ImagerySource | null) => {
    setImagery(next);
    try {
      if (next) localStorage.setItem('mapImagery', next);
      else localStorage.removeItem('mapImagery');
    } catch {}
  };
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
        {areasBySize.filter((area) => !hidden.has(area.properties.type as Layer)).map((area) => (
          <polygon
            key={area.id}
            points={outlinePoints.get(area.id)}
            className={[
              AREA_CLASS[area.properties.type ?? 'draft'] ?? styles.draftArea,
              area.properties.active === false ? styles.inactive : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-area
            onClick={(e) => {
              if (!pickingPoints) selectAt(area.id, e.clientX, e.clientY);
            }}
          />
        ))}

        {loops && loops.length > 0 && !hidden.has('stripes') && (
          <path
            className={styles.stripes}
            d={loops
              .map((o) => o.map((p, i) => `${i ? 'L' : 'M'}${toScreen(p.x, p.y).join(' ')}`).join('') + 'Z')
              .join('')}
          />
        )}
        {stripes && stripes.length > 0 && !hidden.has('stripes') && (
          <path
            className={styles.stripes}
            d={stripes.map((o) => o.map((p, i) => `${i ? 'L' : 'M'}${toScreen(p.x, p.y).join(' ')}`).join('')).join('')}
          />
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
          return (
            <g key={station.id} className={styles.dock} transform={`translate(${sx} ${sy}) scale(${8 * k * (settings.icons?.dockSize ?? 1)})`}>
              {dockIcon(settings.icons?.dock).draw()}
            </g>
          );
        })}

        {progress && !hidden.has('stripes') && (
          <>
            <path
              className={[styles.planTodo, layerOn(hidden, 'planSolid') ? styles.solid : ''].join(' ')}
              d={progress.todo.map((o) => o.map((p, i) => `${i ? 'L' : 'M'}${toScreen(p.x, p.y).join(' ')}`).join('')).join('')}
            />
            {layerOn(hidden, 'planDone') && (
              <path
                className={styles.planDone}
                d={progress.done.map((o) => o.map((p, i) => `${i ? 'L' : 'M'}${toScreen(p.x, p.y).join(' ')}`).join('')).join('')}
              />
            )}
          </>
        )}

        {!hidden.has('track') &&
          trackRuns
            .filter((run) => run.blades || !hidden.has('transit'))
            .map((run, i) => (
              <polyline key={'run' + i} points={run.points} className={run.blades ? styles.track : styles.transit} />
            ))}
        {!hidden.has('track') &&
          pastTrack?.map((seg, i) =>
          seg.points.length >= 2 && (seg.blades || !hidden.has('transit')) ? (
            <polyline
              key={'past' + i}
              points={seg.points.map((p) => toScreen(p.x, p.y).join(',')).join(' ')}
              className={seg.blades ? styles.track : styles.transit}
            />
          ) : null,
        )}

        {displayMower &&
          (() => {
            const [sx, sy] = toScreen(displayMower.x, displayMower.y);
            // same size on screen like the dock, or its real size (never smaller than a few pixels)
            const base = settings.icons?.mowerRealSize ? Math.max(MOWER_SIZE * scale, 7 * k) : 8 * k;
            const size = base * (settings.icons?.mowerSize ?? 1);
            // svg y points down, so the map's ccw heading becomes a cw rotation
            const deg = (-displayMower.heading * 180) / Math.PI;
            return (
              <g className={styles.mower} transform={`translate(${sx} ${sy}) rotate(${deg}) scale(${size})`}>
                {mowerIcon(settings.icons?.mower).draw()}
              </g>
            );
          })()}

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
            className={i === 0 ? styles.pieceA : styles.pieceB}
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
      className={[styles.svg, zoomable ? styles.zoomable : ''].filter(Boolean).join(' ')}
      viewBox={shown ? `${shown.x} ${shown.y} ${shown.size} ${shown.size}` : `0 0 ${WIDTH} ${HEIGHT}`}
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
        const hit = pickHandle(e.clientX, e.clientY, false);
        if (hit && !hit.mid && selectedArea && selectedArea.outline.length > 3) {
          onDeleteVertex?.(selectedArea.id, hit.index);
          setActive(null);
        }
      }}
      onClick={(e) => {
        setActive(null);
        if (!pickingPoints && !(e.target as Element).closest('[data-area]')) onClickEmpty?.();
        if (!pickingPoints || !onCanvasClick) return;
        const local = clientToLocal(e.clientX, e.clientY);
        if (local) onCanvasClick(local[0], local[1]);
      }}
    >
      {renderContent(k)}
      {/* last, so a spot at the dock isn't hidden under the mower */}
      {markers?.map((m, i) => {
        const [mx, my] = toScreen(m.x, m.y);
        return (
          <g key={'mk' + i} className={styles.marker}>
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
        <svg className={styles.svg} viewBox={`${cx - size / 2} ${cy - size / 2} ${size} ${size}`}>
          {renderContent(k / LOUPE_ZOOM)}
        </svg>
        <span className={styles.crosshair} />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {svg}
      {loupe}
      <MapControls
        onZoom={zoomCenter}
        showGrid={showGrid}
        onToggleGrid={() => {
          setShowGrid(!showGrid);
          try {
            localStorage.setItem('mapGrid', showGrid ? 'off' : 'on');
          } catch {}
        }}
        sources={sources}
        source={source}
        imagerySettings={settings.imagery}
        onSource={setSource}
        hidden={hidden}
        onToggleLayer={toggleLayer}
        layersOpen={layersOpen}
        onLayersOpen={setLayersOpen}
        reset={
          view || (follow && followZoom !== 1)
            ? {
                follow: !!follow,
                onReset: () => {
                  setView(null);
                  setFollowZoom(1);
                },
              }
            : null
        }
      />
      {grid && <span className={styles.gridLabel}>{tr('grid {n} m', {n: grid.step})}</span>}
      {selectedArea && activeIndex !== null && onDeleteVertex && selectedArea.outline.length > 3 && (
        <button
          className={styles.deletePoint}
          onClick={() => {
            onDeleteVertex(selectedArea.id, activeIndex);
            setActive(null);
          }}
        >
          {tr('Delete point')}
        </button>
      )}
    </div>
  );
}
