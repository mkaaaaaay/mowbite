'use client';

import {MergePanel, RestorePanel, SimplifyPanel, SnapPanel, SplitPanel, SubtractPanel} from '@/app/map/Panels';
import DecorPanel from '@/app/map/DecorPanel';
import EditorToolbar from '@/app/map/EditorToolbar';
import OrderBox from '@/app/map/OrderBox';
import {SimPlayer, SimulationView} from '@/app/map/PlanSimulation';
import {AREA_TYPES, DEG, pinSquare} from '@/app/map/editing';
import {AngleCompass, AngleOnMap, AngleSlider, AngleStep} from '@/app/map/MowSettings';
import mapPage from '@/app/map/page.module.css';
import {MagnetIcon, MergeIcon, ScissorsIcon, SimplifyIcon, SubtractIcon, TrashIcon} from '@/components/icons';
import MapBackups from '@/components/MapBackups';
import {LIFE} from '@/components/MapLookSettings';
import look from '@/components/MapLookSettings.module.css';
import MapView from '@/components/MapView';
import mapView from '@/components/MapView.module.css';
import type {MapArea, MowerMap, Point} from '@/hooks/useMowerMap';
import {polygonArea} from '@/lib/geometry';
import {fmt, tr} from '@/lib/i18n';
import {mergeOutlines} from '@/lib/mergeAreas';
import {MOWER_MODELS, sizesBody} from '@/lib/mowerBody';
import {mowPlan} from '@/lib/mowPlan';
import {simplifyPolygon} from '@/lib/simplifyPolygon';
import {createSimClock, type SimFrame, type SimResult} from '@/lib/simulate';
import {layAgainst, movingOf} from '@/lib/snapAreas';
import {splitByPath} from '@/lib/splitPolygon';
import {subtractOutline} from '@/lib/subtractAreas';
import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from 'react';
import styles from './page.module.css';

// the editor guide shows the app's own map with an example garden on it in the garden style and what the map page shows
// under it, the same parts the editor uses. a hand on top does what the step says, each step a loop played by a timeline

const pt = (x: number, y: number): Point => ({x, y});
const noop = () => {};

// a recorded edge: a point every step m along the corners, a little off the straight line like gps
function recorded(corners: Point[], step: number, wobble: number, seed: number): Point[] {
  const out: Point[] = [];
  let n = 0;
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const parts = Math.max(1, Math.round(len / step));
    for (let j = 0; j < parts; j++) {
      const f = j / parts;
      const off = Math.sin(++n * 12.9898 + seed * 78.233) * wobble;
      out.push(pt(a.x + (b.x - a.x) * f + ((a.y - b.y) / len) * off, a.y + (b.y - a.y) * f + ((b.x - a.x) / len) * off));
    }
  });
  return out;
}

const circle = (cx: number, cy: number, r: number, n = 18) =>
  Array.from({length: n}, (_, i) => pt(cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)));

const area = (id: string, name: string, type: string, outline: Point[]): MapArea => ({id, properties: {name, type, active: true}, outline});

const GARTEN_CORNERS = [pt(0, 0), pt(14, 0), pt(14, 9), pt(13, 10), pt(0, 10)];
const GARTEN = area('garten', 'Garten', 'mow', recorded(GARTEN_CORNERS, 1.4, 0.04, 1));
const TREE = area('baum', 'Baum', 'obstacle', circle(4.5, 6, 1.1));
const VORGARTEN = area('vorgarten', 'Vorgarten', 'mow', recorded([pt(1, 13), pt(13, 13), pt(13, 20), pt(1, 20)], 1.4, 0.04, 2));
const WEG = area('weg', 'Weg', 'nav', [pt(8, 9.6), pt(10, 9.6), pt(10, 13.4), pt(8, 13.4)]);
const BED = area('beet', 'Beet', 'obstacle', [pt(8.5, 16), pt(11.5, 16), pt(11.5, 18), pt(8.5, 18)]);
// a bed along the lawn, outside it: only a picture, a little off the lawn's edge
const BORDER = area('staudenbeet', 'Staudenbeet', 'decor', [pt(-2.6, 1.5), pt(-0.45, 1.5), pt(-0.45, 10), pt(-2.6, 10)]);
const DOCK = {id: 'dock', position: pt(2.2, -0.9), heading: Math.PI / 2};
const mapOf = (...areas: MapArea[]): MowerMap => ({areas: [...areas, BORDER], docking_stations: [DOCK]});
const GARDEN = mapOf(GARTEN, TREE, VORGARTEN, WEG, BED);

// a map made once for each state of a step, so the map is drawn anew only when something on it changes
const maps = new Map<string, MowerMap>();
function cached(key: string, make: () => MowerMap): MowerMap {
  let m = maps.get(key);
  if (!m) {
    if (maps.size > 300) maps.clear();
    m = make();
    maps.set(key, m);
  }
  return m;
}

// the timeline: t runs from 0 to 1 over a step's seconds, again and again. standing still with reduced motion
function useLoop(seconds: number, still: number): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    let frame = 0;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      frame = requestAnimationFrame(() => setT(still));
      return () => cancelAnimationFrame(frame);
    }
    let last = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (now - last >= 40) {
        last = now;
        setT((((now - start) / 1000) % seconds) / seconds);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [seconds, still]);
  return t;
}

// 0 before a, 1 after b, eased in between
const ease = (t: number, a: number, b: number) => {
  const f = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return f * f * (3 - 2 * f);
};
const mix = (p: Point, q: Point, f: number) => pt(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f);

// where the hand is: a spot on the map, a button (by what it says or one of several it can say, the nth of them, or an
// icon's by its aria-label), a switch's box (by its words), the range slider at a value, or off the bottom
type Target =
  | {map: Point; dx?: number; dy?: number}
  | {button: string | string[]; nth?: number}
  | {aria: string}
  | {label: string}
  | {range: number}
  | 'off';
interface HandPlan {
  moves: [number, Target][];
  // the stretches it touches the screen
  press: [number, number][];
  taps: number[];
  show: [number, number];
}
const tap = (...ts: number[]): [number, number][] => ts.map((x) => [x - 0.01, x + 0.03]);

// a pointing hand, the tip of the index finger at its origin, the other fingers curled and the thumb out to the side
const HAND =
  'M-5 23 L-5 5 A5 5 0 0 1 5 5 L5 18 Q5 14 9 14 Q13 14 13 18 Q13 16 16.5 16 Q20 16 20 20 Q20.5 18.5 23 19.5 ' +
  'Q26 21 25.5 25 L25 37 Q24 47 15 51 L2 51 Q-6 49 -8 41 L-14 34 Q-17 30 -13 28 L-6 32 Z';

function HandShape() {
  const id = useId();
  return (
    <>
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dfe5eb" />
        </linearGradient>
        <filter id={`${id}s`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={1.8} />
        </filter>
      </defs>
      <g transform="rotate(-15) scale(0.9)">
        <path d={HAND} transform="translate(3 5)" fill="#000" opacity={0.3} filter={`url(#${id}s)`} />
        <path d={HAND} fill={`url(#${id}f)`} stroke="#56616c" strokeWidth={1.3} strokeLinejoin="round" />
        <path d="M-3 6 Q-3 2.2 0 2.2 Q3 2.2 3 6 L3 9 Q0 10.5 -3 9 Z" fill="#f6f8fa" stroke="#c4ccd4" strokeWidth={0.7} />
        <path d="M-3 15 Q0 16.5 3 15" stroke="#bcc5ce" strokeWidth={0.9} fill="none" strokeLinecap="round" />
        <path d="M13 18 Q13.6 21 12.6 24.5 M20 20 Q20.6 23 19.6 26.5" stroke="#bcc5ce" strokeWidth={0.9} fill="none" strokeLinecap="round" />
        <path d="M-7.5 34.5 Q-9.5 36 -10.5 38" stroke="#bcc5ce" strokeWidth={0.9} fill="none" strokeLinecap="round" />
      </g>
    </>
  );
}

// map spot -> place in the stage, from where the map drew an area it was given
function mapToStage(stage: HTMLElement, map: MowerMap): ((p: Point) => [number, number]) | null {
  const box = stage.getBoundingClientRect();
  // shown smaller (css zoom): the page measures it zoomed, what's inside it counts without
  const z = parseFloat(getComputedStyle(stage).zoom) || 1;
  // the area it is: the one whose every point lands on the drawn ones the same way
  for (const el of stage.querySelectorAll<SVGPolygonElement>('polygon[data-area]')) {
    // the area's own place on the screen, the map moves its drawing around inside the svg
    const ctm = el.getScreenCTM();
    if (!ctm) continue;
    const drawn = (el.getAttribute('points') ?? '').trim().split(/\s+/).map((s) => s.split(',').map(Number));
    for (const a of map.areas) {
      const o = a.outline;
      if (o.length !== drawn.length || o.length < 3) continue;
      // uniform scale, y the other way round: from the two points furthest apart on each axis
      let [jx, jy] = [0, 0];
      o.forEach((p, i) => {
        if (Math.abs(p.x - o[0].x) > Math.abs(o[jx].x - o[0].x)) jx = i;
        if (Math.abs(p.y - o[0].y) > Math.abs(o[jy].y - o[0].y)) jy = i;
      });
      const kx = (drawn[jx][0] - drawn[0][0]) / (o[jx].x - o[0].x);
      const ky = (drawn[jy][1] - drawn[0][1]) / (o[jy].y - o[0].y);
      if (!Number.isFinite(kx) || !Number.isFinite(ky)) continue;
      const ox = drawn[0][0] - kx * o[0].x;
      const oy = drawn[0][1] - ky * o[0].y;
      if (o.some((p, i) => Math.abs(ox + kx * p.x - drawn[i][0]) > 1.5 || Math.abs(oy + ky * p.y - drawn[i][1]) > 1.5)) continue;
      return (p) => {
        const s = new DOMPoint(ox + kx * p.x, oy + ky * p.y).matrixTransform(ctm);
        return [(s.x - box.left) / z, (s.y - box.top) / z];
      };
    }
  }
  return null;
}

// the stage: the map as the editor shows it, what's under it and the hand on top
function Stage({t, map, selected, picking, pending, preview, view, extra, under, hand}: {
  t: number;
  map: MowerMap;
  selected: string | null;
  picking?: boolean;
  pending?: Point[];
  preview?: Point[][];
  // more for the map: the plan's lanes and loops, the mowing order, a mower's body for the real edges, a spot to zoom to
  view?: Pick<
    React.ComponentProps<typeof MapView>,
    'stripes' | 'loops' | 'orderLabels' | 'bodyOverride' | 'focus' | 'focusSpan' | 'mapStyle' | 'snap' | 'decor' | 'sim' | 'leftPieces' | 'marginPlaces'
  >;
  extra?: (toStage: (p: Point) => [number, number]) => React.ReactNode;
  under: React.ReactNode;
  hand: HandPlan;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const mover = useRef<HTMLDivElement>(null);
  // how far the stage is slid up under its window (px), following the hand
  const camera = useRef(0);
  const handRef = useRef<SVGGElement>(null);
  const ripple = useRef<SVGCircleElement>(null);
  // map spot -> stage, worked out anew every frame: the map can still settle after it's shown. what's drawn next to a
  // spot (the delete button) gets it a frame later, only when it changed
  const [place, setPlace] = useState<((p: Point) => [number, number]) | null>(null);
  const placed = useRef<((p: Point) => [number, number]) | null>(null);
  // where each target was last seen: once its button is gone (the panel after it showed up) the hand goes on from there
  const seen = useRef(new Map<string, [number, number]>());

  // the stage seen through a window that ends above the tab bar (on a phone the map and its card don't fit on the screen
  // under the words): it slides up while the hand works further down and back when it's done, the page itself stays.
  // tip: where the finger is, to: where it's going, in px from the stage's top (null with the hand away)
  const follow = (tip: number | null, to: number | null, height: number) => {
    const f = frame.current;
    const m = mover.current;
    if (!f || !m) return;
    const nav = document.querySelector('nav')?.getBoundingClientRect();
    const bottom = nav && nav.top > window.innerHeight / 2 ? nav.top : window.innerHeight;
    const room = Math.max(300, Math.round(bottom - (f.getBoundingClientRect().top + window.scrollY) - 12));
    const fits = height <= room;
    f.style.maxHeight = fits ? '' : `${room}px`;
    f.style.overflow = fits ? '' : 'hidden';
    let want = camera.current;
    if (fits || tip === null) want = 0;
    else {
      // the finger with the hand under it in view, where it is and where it's going, or the latter if both don't fit
      const ys = to === null ? [tip] : [tip, to];
      const [low, high] = [Math.max(...ys) - (room - 64), Math.min(...ys) - 30];
      if (low <= high) want = Math.min(Math.max(want, low), high);
      else if (to !== null) want = Math.min(Math.max(want, to - (room - 64)), to - 30);
      // a little past the bottom, the hand under the last row
      want = Math.max(0, Math.min(want, height + 70 - room));
    }
    const at = Math.abs(want - camera.current) < 0.5 ? want : camera.current + (want - camera.current) * 0.18;
    camera.current = at;
    m.style.transform = at ? `translateY(${-at.toFixed(1)}px)` : '';
  };

  useLayoutEffect(() => {
    const el = stage.current;
    const g = handRef.current;
    if (!el || !g) return;
    const fresh = mapToStage(el, map);
    const was = placed.current;
    const probe = (f: (p: Point) => [number, number]) => [...f(pt(0, 0)), ...f(pt(10, 10))];
    if (fresh && (!was || probe(fresh).some((v, i) => Math.abs(v - probe(was)[i]) > 0.5))) {
      placed.current = fresh;
      requestAnimationFrame(() => setPlace(() => fresh));
    }
    const place = fresh ?? was;
    const box = el.getBoundingClientRect();
    const z = parseFloat(getComputedStyle(el).zoom) || 1;
    const middle = (r: DOMRect): [number, number] => [(r.left - box.left + r.width / 2) / z, (r.top - box.top + r.height / 2) / z];
    const find = (target: Target): [number, number] | null => {
      if (target === 'off') return [(box.width / z) * 0.85, box.height / z + 70];
      if ('map' in target) {
        if (!place) return null;
        const [x, y] = place(target.map);
        return [x + (target.dx ?? 0), y + (target.dy ?? 0)];
      }
      if ('button' in target) {
        const says = [target.button].flat();
        const b = [...el.querySelectorAll('button')].filter((x) => says.includes(x.textContent?.trim() ?? ''))[target.nth ?? 0];
        return b ? middle(b.getBoundingClientRect()) : null;
      }
      if ('aria' in target) {
        const b = el.querySelector(`button[aria-label="${target.aria}"]`);
        return b ? middle(b.getBoundingClientRect()) : null;
      }
      if ('label' in target) {
        const l = [...el.querySelectorAll('label')].find((x) => x.textContent?.trim() === target.label);
        const check = l?.querySelector('input') ?? l;
        return check ? middle(check.getBoundingClientRect()) : null;
      }
      // the one shown: the angle's slider sits on the map on a phone, in the settings on a wide screen
      const input = [...el.querySelectorAll<HTMLInputElement>('input[type=range]')].find((x) => x.getClientRects().length > 0);
      if (!input) return null;
      const r = input.getBoundingClientRect();
      const f = (target.range - Number(input.min)) / (Number(input.max) - Number(input.min));
      return [(r.left - box.left + 8 + f * (r.width - 16)) / z, (r.top - box.top + r.height / 2) / z];
    };
    const at = (target: Target): [number, number] | null => {
      const key = JSON.stringify(target);
      const found = find(target);
      if (found) seen.current.set(key, found);
      return found ?? seen.current.get(key) ?? null;
    };
    // where the hand is at a time: between the two stops around it
    const handAt = (time: number): [number, number] | null => {
      const m = hand.moves;
      let i = m.length - 1;
      while (i > 0 && m[i][0] > time) i--;
      const from = at(m[i][1]);
      const to = i + 1 < m.length ? at(m[i + 1][1]) : from;
      if (!from || !to) return null;
      const f = i + 1 < m.length ? ease(time, m[i][0], m[i + 1][0]) : 0;
      return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f];
    };
    const now = handAt(t);
    const shown = !!now && t > hand.show[0] && t < hand.show[1];
    // the stop it's heading for (or at), not off the bottom
    const next = hand.moves.find(([time]) => time > t)?.[1] ?? hand.moves[hand.moves.length - 1][1];
    const to = shown && next !== 'off' ? at(next) : null;
    follow(now && shown ? now[1] * z : null, to ? to[1] * z : null, el.getBoundingClientRect().height);
    if (!now) {
      g.setAttribute('opacity', '0');
      return;
    }
    const pressed = hand.press.some(([a, b]) => t >= a && t <= b);
    g.setAttribute('transform', `translate(${now[0]} ${now[1]}) scale(${pressed ? 0.88 : 1})`);
    g.setAttribute('opacity', shown ? '1' : '0');
    // a ring where it just tapped, staying there while the hand moves on
    const tapped = hand.taps.find((s) => t - s >= 0 && t - s < 0.07);
    const spot = tapped === undefined ? null : handAt(tapped);
    if (ripple.current) {
      const since = tapped === undefined ? 0 : t - tapped;
      ripple.current.setAttribute('cx', String(spot?.[0] ?? 0));
      ripple.current.setAttribute('cy', String(spot?.[1] ?? 0));
      ripple.current.setAttribute('r', String(8 + since * 200));
      ripple.current.setAttribute('opacity', spot ? String(0.9 * (1 - since / 0.07)) : '0');
    }
  });

  return (
    <div ref={frame} className={styles.stageFrame}>
      <div ref={mover} className={styles.stageMover}>
        {/* only a picture of the page: nothing in it takes a tap, a key or the focus */}
        <div ref={stage} className={styles.stage} inert>
          <div className={styles.stageMap}>
            <MapView
              map={map}
              zoomable
              selectedAreaId={selected}
              onSelectArea={noop}
              onMoveVertex={noop}
              onInsertVertex={noop}
              pickingPoints={picking}
              pendingPoints={pending}
              preview={preview}
              allLayers
              sample
              mapStyle="garden"
              {...view}
            />
            {place && extra?.(place)}
          </div>
          <div className={mapPage.panel}>{under}</div>
          <svg className={styles.handLayer} aria-hidden="true">
            <circle ref={ripple} r={8} fill="none" stroke="#fff" strokeWidth={2} opacity={0} />
            <g ref={handRef} opacity={0}>
              <HandShape />
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}

// what the map page shows under the map for a picked area: name, type, its switches, what it is and its tools
function AreaCard({a}: {a: MapArea}) {
  const tool = [mapPage.pillButton, mapPage.tool].join(' ');
  const type = AREA_TYPES.find((x) => x.value === a.properties.type);
  const on = a.properties.active !== false;
  return (
    <div className={mapPage.areaEditor}>
      <div className={mapPage.areaHead}>
        <input className={mapPage.nameInput} value={a.properties.name ?? ''} readOnly tabIndex={-1} />
        <select className={mapPage.typeSelect} value={a.properties.type} onChange={noop} tabIndex={-1}>
          {AREA_TYPES.map((x) => (
            <option key={x.value} value={x.value}>
              {tr(x.label)}
            </option>
          ))}
        </select>
      </div>
      <div className={mapPage.areaMeta}>
        <label className={mapPage.toggle}>
          <input type="checkbox" checked={on} readOnly tabIndex={-1} />
          {tr('active')}
        </label>
        {a.properties.type === 'mow' && on && (
          <label className={mapPage.toggle}>
            <input type="checkbox" checked={a.properties.mowable === false} readOnly tabIndex={-1} />
            {tr("don't mow")}
          </label>
        )}
        <span className={mapPage.dim}>
          {!on
            ? a.properties.type === 'obstacle'
              ? tr('inactive: ignored, the mower mows there')
              : tr('inactive: not driven on and not mowed')
            : a.properties.mowable === false
              ? tr('driven on, but not mowed')
              : tr(type?.hint ?? '')}
          {' · '}
          {fmt(polygonArea(a.outline), 1)} m²
        </span>
      </div>
      <div className={mapPage.toolbar}>
        <span className={mapPage.toolLabel}>{tr('Edit')}</span>
        <button className={tool} tabIndex={-1}>
          <ScissorsIcon size={16} />
          {tr('Split area')}
        </button>
        <button className={tool} tabIndex={-1}>
          <MergeIcon size={16} />
          {tr('Merge')}
        </button>
        <button className={tool} tabIndex={-1}>
          <SubtractIcon size={16} />
          {tr('Take out')}
        </button>
        <button className={tool} tabIndex={-1}>
          <MagnetIcon size={16} />
          {tr('Lay against')}
        </button>
        <button className={tool} tabIndex={-1}>
          <SimplifyIcon size={16} />
          {tr('Reduce points')}
        </button>
        <button className={[tool, mapPage.toolWide, mapPage.danger].join(' ')} tabIndex={-1}>
          <TrashIcon size={16} />
          {tr('Delete area')}
        </button>
      </div>
    </div>
  );
}

const Hint = () => <p className={mapPage.dim}>{tr('Click an area to edit it.')}</p>;
const SPOT = pt(9.5, 3);

// 1: tap an area: it's picked, its points show up and its card under the map
function Select() {
  const t = useLoop(6.5, 0.6);
  const picked = t >= 0.25;
  return (
    <Stage
      t={t}
      map={GARDEN}
      selected={picked ? GARTEN.id : null}
      under={picked ? <AreaCard a={GARTEN} /> : <Hint />}
      hand={{moves: [[0, 'off'], [0.2, {map: SPOT}], [0.6, {map: SPOT}]], press: tap(0.22), taps: [0.22], show: [0.02, 0.5]}}
    />
  );
}

// 2: the types: a path, a bed, the bed along the lawn and a lawn tapped one after another, the card says what the mower
// does there
const NAV_SPOT = pt(9, 11.5);
const BED_SPOT = pt(10, 17);
const BORDER_SPOT = pt(-1.5, 5);

function Types() {
  const t = useLoop(12, 0.88);
  const picked = t >= 0.78 ? GARTEN : t >= 0.56 ? BORDER : t >= 0.34 ? BED : t >= 0.12 ? WEG : null;
  return (
    <Stage
      t={t}
      map={GARDEN}
      selected={picked?.id ?? null}
      under={picked ? <AreaCard a={picked} /> : <Hint />}
      hand={{
        moves: [
          [0, 'off'],
          [0.1, {map: NAV_SPOT}],
          [0.14, {map: NAV_SPOT}],
          [0.32, {map: BED_SPOT}],
          [0.36, {map: BED_SPOT}],
          [0.54, {map: BORDER_SPOT}],
          [0.58, {map: BORDER_SPOT}],
          [0.76, {map: SPOT}],
          [0.84, {map: SPOT}],
        ],
        press: tap(0.12, 0.34, 0.56, 0.78),
        taps: [0.12, 0.34, 0.56, 0.78],
        show: [0.02, 0.88],
      }}
    />
  );
}

// 3: don't mow (driven across, not mowed), then not active (left out, not even driven on)
function Switches() {
  const t = useLoop(11, 0.4);
  const skip = t >= 0.2 && t < 0.5;
  const off = t >= 0.62 && t < 0.92;
  const front = {...VORGARTEN, properties: {...VORGARTEN.properties, mowable: skip ? false : undefined, active: !off}};
  const map = cached(`switches ${skip} ${off}`, () => mapOf(GARTEN, TREE, front, WEG, BED));
  return (
    <Stage
      t={t}
      map={map}
      selected={VORGARTEN.id}
      under={<AreaCard a={front} />}
      hand={{
        moves: [
          [0, 'off'],
          [0.16, {label: tr("don't mow")}],
          [0.52, {label: tr("don't mow")}],
          [0.58, {label: tr('active')}],
        ],
        press: tap(0.18, 0.48, 0.6, 0.9),
        taps: [0.18, 0.48, 0.6, 0.9],
        show: [0.06, 0.95],
      }}
    />
  );
}

// 4: a dent pulled out to the edge, a cut off corner pulled back out between two points, a stray point deleted
const P_BASE = [
  [0, 0], [3, 0], [6, 0], [9, 0], [12, 0], [14, 0], [14, 3], [14, 6], [14, 8.4], [12.6, 10], [10, 10], [7, 8.6], [4, 10], [0, 10], [-0.8, 5], [0, 2],
].map(([x, y]) => pt(x, y));
const DENT = 11;
const CORNER = 8;
const STRAY = 14;

function Points() {
  const t = useLoop(11, 0.7);
  const dent = mix(P_BASE[DENT], pt(7, 10), ease(t, 0.17, 0.3));
  const mid = mix(P_BASE[CORNER], P_BASE[CORNER + 1], 0.5);
  const corner = mix(mid, pt(14, 10), ease(t, 0.45, 0.57));
  const outline = P_BASE.map((p, i) => (i === DENT ? dent : p));
  // pulled out, the dot between the two is a point of its own
  if (t >= 0.44) outline.splice(CORNER + 1, 0, corner);
  const stray = P_BASE[STRAY];
  const gone = t >= 0.8;
  const shown = gone ? outline.filter((p) => p !== stray) : outline;
  const map = cached(`points ${shown.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}`, () =>
    mapOf({...GARTEN, outline: shown}, TREE, VORGARTEN, WEG, BED),
  );
  const tapped = t >= 0.7 && !gone;
  return (
    <Stage
      t={t}
      map={map}
      selected={GARTEN.id}
      under={<AreaCard a={map.areas[0]} />}
      extra={(at) => {
        const [x, y] = at(stray);
        return (
          <>
            {t >= 0.12 && t < 0.2 && <div className={mapView.hintToast}>{tr('Hold to move')}</div>}
            {tapped && (
              <>
                <svg className={styles.handLayer}>
                  <circle cx={x} cy={y} r={5} className={mapView.activeVertex} />
                </svg>
                <button className={mapView.deletePoint} style={{left: x + 14, top: y - 54}} tabIndex={-1} aria-label={tr('Delete point')}>
                  <TrashIcon size={18} />
                </button>
              </>
            )}
            {gone && t < 0.96 && (
              <div className={mapView.undoToast}>
                {tr('Point deleted')}
                <button tabIndex={-1}>{tr('Undo')}</button>
              </div>
            )}
          </>
        );
      }}
      hand={{
        moves: [
          [0, 'off'],
          [0.1, {map: P_BASE[DENT]}],
          [0.17, {map: P_BASE[DENT]}],
          [0.3, {map: pt(7, 10)}],
          [0.34, {map: pt(7, 10)}],
          [0.42, {map: mid}],
          [0.45, {map: mid}],
          [0.57, {map: pt(14, 10)}],
          [0.6, {map: pt(14, 10)}],
          [0.68, {map: stray}],
          [0.72, {map: stray}],
          // the delete button up and to the right of it
          [0.76, {map: stray, dx: 34, dy: -34}],
          [0.82, {map: stray, dx: 34, dy: -34}],
        ],
        press: [[0.11, 0.31], [0.43, 0.58], ...tap(0.7, 0.785)],
        taps: [0.7, 0.785],
        show: [0.02, 0.9],
      }}
    />
  );
}

// snapping: the bed's corner dragged towards the lawn's corner next to it, close to it it jumps onto it and stays there.
// the magnet on the map switches it off
const withBorder = (outline: Point[]): MowerMap => ({areas: [GARTEN, TREE, VORGARTEN, WEG, BED, {...BORDER, outline}], docking_stations: [DOCK]});
const B_CORNER = 2;
// the lawn's recorded corner next to the bed's
const L_CORNER = GARTEN.outline.reduce((a, b) => (Math.hypot(b.x, b.y - 10) < Math.hypot(a.x, a.y - 10) ? b : a));
const NEAR = pt(L_CORNER.x - 0.16, L_CORNER.y + 0.14);

function Snap() {
  const t = useLoop(10, 0.6);
  const snapped = t >= 0.42;
  const corner = snapped ? L_CORNER : mix(BORDER.outline[B_CORNER], NEAR, ease(t, 0.18, 0.4));
  const map = cached(`snap ${corner.x.toFixed(2)},${corner.y.toFixed(2)}`, () => withBorder(BORDER.outline.map((p, i) => (i === B_CORNER ? corner : p))));
  const held = t >= 0.15 && t < 0.52;
  const on = t < 0.74;
  return (
    <Stage
      t={t}
      map={map}
      selected={BORDER.id}
      view={{focus: pt(-0.5, 9.2), focusSpan: 3, snap: {on, onToggle: noop}}}
      under={<AreaCard a={map.areas[5]} />}
      extra={(at) => {
        const [x, y] = at(L_CORNER);
        return (
          <>
            {t >= 0.12 && t < 0.2 && <div className={mapView.hintToast}>{tr('Hold to move')}</div>}
            {snapped && held && (
              <svg className={styles.handLayer}>
                <circle cx={x} cy={y} r={11} className={mapView.snapCorner} />
              </svg>
            )}
          </>
        );
      }}
      hand={{
        moves: [
          [0, 'off'],
          [0.1, {map: BORDER.outline[B_CORNER]}],
          [0.18, {map: BORDER.outline[B_CORNER]}],
          [0.4, {map: NEAR}],
          [0.43, {map: L_CORNER}],
          [0.52, {map: L_CORNER}],
          [0.66, {aria: tr('Snap')}],
          [0.82, {aria: tr('Snap')}],
        ],
        press: [[0.15, 0.52], ...tap(0.73)],
        taps: [0.73],
        show: [0.02, 0.86],
      }}
    />
  );
}

// 5: split: the button, two points for a line across, apply: two areas
const CUT = [pt(5.5, 11.6), pt(7.5, -1.6)];

function Split() {
  const t = useLoop(11, 0.5);
  const pieces = useMemo(() => splitByPath(GARTEN.outline, CUT), []);
  const splitting = t >= 0.14 && t < 0.6;
  const pending = t >= 0.45 ? CUT : t >= 0.3 ? CUT.slice(0, 1) : [];
  const done = t >= 0.6;
  const map = useMemo(
    () =>
      done && pieces
        ? mapOf(area('garten', 'Garten', 'mow', pieces[0]), area('garten2', 'Garten', 'mow', pieces[1]), TREE, VORGARTEN, WEG, BED)
        : GARDEN,
    [done, pieces],
  );
  return (
    <Stage
      t={t}
      map={map}
      selected={done ? null : GARTEN.id}
      picking={splitting}
      pending={splitting ? pending : undefined}
      preview={splitting && pending.length === 2 && pieces ? pieces : undefined}
      under={
        done ? (
          <Hint />
        ) : splitting ? (
          <SplitPanel preview={pending.length === 2 ? pieces : null} cutShape={false} onCutShape={noop} points={pending.length} onApply={noop} onRemoveLast={noop} onCancel={noop} />
        ) : (
          <AreaCard a={GARTEN} />
        )
      }
      hand={{
        moves: [
          [0, 'off'],
          [0.1, {button: tr('Split area')}],
          [0.16, {button: tr('Split area')}],
          [0.28, {map: CUT[0]}],
          [0.32, {map: CUT[0]}],
          [0.43, {map: CUT[1]}],
          [0.47, {map: CUT[1]}],
          [0.56, {button: tr('Apply split')}],
          [0.7, {button: tr('Apply split')}],
        ],
        press: tap(0.12, 0.3, 0.45, 0.58),
        taps: [0.12, 0.3, 0.45, 0.58],
        show: [0.02, 0.64],
      }}
    />
  );
}

// 6: merge: the button, then the other area, apply: one area from both
const STRIP = area('streifen', 'Streifen', 'mow', recorded([pt(13.6, 2.5), pt(19, 2.5), pt(19, 7.5), pt(13.6, 7.5)], 1.4, 0.03, 3));
const BOTH = mapOf(GARTEN, STRIP, TREE, VORGARTEN, WEG, BED);

function Merge() {
  const t = useLoop(11, 0.4);
  const merged = useMemo(() => mergeOutlines(GARTEN.outline, STRIP.outline), []);
  const merging = t >= 0.14 && t < 0.54;
  const other = t >= 0.32 ? STRIP : null;
  const done = t >= 0.54 && !!merged;
  const map = useMemo(() => (done ? mapOf({...GARTEN, outline: merged!.outline}, TREE, VORGARTEN, WEG, BED) : BOTH), [done, merged]);
  return (
    <Stage
      t={t}
      map={map}
      selected={GARTEN.id}
      preview={merging && other && merged ? [merged.outline] : undefined}
      under={merging ? <MergePanel area={GARTEN} other={other} merged={other ? merged : null} onApply={noop} onCancel={noop} /> : <AreaCard a={map.areas[0]} />}
      hand={{
        moves: [
          [0, 'off'],
          [0.1, {button: tr('Merge')}],
          [0.16, {button: tr('Merge')}],
          [0.3, {map: pt(16.8, 5)}],
          [0.34, {map: pt(16.8, 5)}],
          [0.5, {button: tr('Apply merge')}],
          [0.62, {button: tr('Apply merge')}],
        ],
        press: tap(0.12, 0.32, 0.52),
        taps: [0.12, 0.32, 0.52],
        show: [0.02, 0.6],
      }}
    />
  );
}

// 7: take out: the button, then the path lying over the lawn, apply: the lawn without the part under the path
function Subtract() {
  const t = useLoop(11, 0.4);
  const result = useMemo(() => subtractOutline(GARTEN.outline, WEG.outline), []);
  const picking = t >= 0.14 && t < 0.54;
  const other = t >= 0.32 ? WEG : null;
  const done = t >= 0.54 && !!result?.pieces.length;
  const map = useMemo(() => (done ? mapOf({...GARTEN, outline: result!.pieces[0]}, TREE, VORGARTEN, WEG, BED) : GARDEN), [done, result]);
  return (
    <Stage
      t={t}
      map={map}
      selected={GARTEN.id}
      preview={picking && other && result ? result.pieces : undefined}
      under={
        picking ? <SubtractPanel area={GARTEN} other={other} result={other ? result : null} onApply={noop} onCancel={noop} /> : <AreaCard a={map.areas[0]} />
      }
      hand={{
        moves: [
          [0, 'off'],
          [0.1, {button: tr('Take out')}],
          [0.16, {button: tr('Take out')}],
          [0.3, {map: NAV_SPOT}],
          [0.34, {map: NAV_SPOT}],
          [0.5, {button: tr('Take out')}],
          [0.62, {button: tr('Take out')}],
        ],
        press: tap(0.12, 0.32, 0.52),
        taps: [0.12, 0.32, 0.52],
        show: [0.02, 0.6],
      }}
    />
  );
}

// lay against: the bed along the lawn picked, the button, then the lawn: its corners near the lawn move onto its edge
function Lay() {
  const t = useLoop(11, 0.4);
  const [moving, fixed] = movingOf(BORDER, GARTEN);
  const laid = useMemo(() => layAgainst(moving.outline, fixed.outline, 0.5), [moving, fixed]);
  const picking = t >= 0.14 && t < 0.54;
  const other = t >= 0.32 ? GARTEN : null;
  const done = t >= 0.54 && !!laid?.valid;
  const map = useMemo(() => (done ? withBorder(laid!.outline) : GARDEN), [done, laid]);
  return (
    <Stage
      t={t}
      map={map}
      selected={BORDER.id}
      view={{focus: pt(-0.8, 5), focusSpan: 9}}
      preview={picking && other && laid?.valid ? [laid.outline] : undefined}
      under={
        picking ? (
          <SnapPanel area={BORDER} other={other} moving={other ? moving : null} laid={other ? laid : null} cm={50} onCm={noop} onApply={noop} onCancel={noop} />
        ) : (
          <AreaCard a={map.areas[5]} />
        )
      }
      hand={{
        moves: [
          [0, 'off'],
          [0.1, {button: tr('Lay against')}],
          [0.16, {button: tr('Lay against')}],
          [0.3, {map: pt(3, 5)}],
          [0.34, {map: pt(3, 5)}],
          [0.5, {button: tr('Lay against')}],
          [0.62, {button: tr('Lay against')}],
        ],
        press: tap(0.12, 0.32, 0.52),
        taps: [0.12, 0.32, 0.52],
        show: [0.02, 0.6],
      }}
    />
  );
}

// 8: a recorded edge with a point every few cm: the slider takes out the ones that barely matter
const DENSE = recorded(GARTEN_CORNERS, 0.22, 0.05, 4);

function Reduce() {
  const t = useLoop(11, 0.6);
  const reducing = t >= 0.14 && t < 0.64;
  const cm = Math.round(12 * ease(t, 0.27, 0.48));
  const fewer = useMemo(() => (cm ? simplifyPolygon(DENSE, cm / 100) : DENSE), [cm]);
  const kept = t >= 0.64 ? 12 : cm;
  const map = cached(`reduce ${kept}`, () => mapOf({...GARTEN, outline: kept === cm ? fewer : simplifyPolygon(DENSE, 0.12)}, TREE, VORGARTEN, WEG, BED));
  return (
    <Stage
      t={t}
      map={map}
      selected={GARTEN.id}
      under={
        reducing ? (
          <SimplifyPanel cm={cm} from={DENSE.length} to={fewer.length} onChange={noop} onApply={noop} onCancel={noop} />
        ) : (
          <AreaCard a={map.areas[0]} />
        )
      }
      hand={{
        moves: [
          [0, 'off'],
          [0.1, {button: tr('Reduce points')}],
          [0.16, {button: tr('Reduce points')}],
          [0.25, {range: 0}],
          [0.27, {range: 0}],
          [0.48, {range: 12}],
          [0.52, {range: 12}],
          [0.6, {button: tr('Apply')}],
          [0.7, {button: tr('Apply')}],
        ],
        press: [...tap(0.12), [0.25, 0.49], ...tap(0.62)],
        taps: [0.12, 0.62],
        show: [0.02, 0.68],
      }}
    />
  );
}

// 8: an area's own direction: on a phone the slider at the bottom of the map, the field (on a wide screen the slider
// too) in the mowing settings. turning it shows the lanes of the plan
const angled = (deg: number) => ({
  area: {...GARTEN, properties: {...GARTEN.properties, angle: deg * DEG}},
  autoAngle: 0,
  remember: noop,
  update: noop,
});
// lanes 60 cm apart, wider than a blade: few enough to follow while they turn
const LANES = {outline: GARTEN.outline, holes: [TREE.outline], outlineOffset: 0, outlineCount: 2, overlapCount: 0, toolWidth: 0.6};

function AngleSettings({deg}: {deg: number}) {
  return (
    <details className={mapPage.fold} open>
      <summary>{tr('Mowing settings')}</summary>
      <div className={mapPage.foldBody}>
        <div className={mapPage.mowSettings}>
          <p className={mapPage.dim}>{tr('Only for this area, saved with the map ("Save map").')}</p>
          <div className={mapPage.areaDirection}>
            <label className={mapPage.dirRow}>
              <span className={mapPage.dirLabel}>{tr('Mow angle (°)')}</span>
              <input type="number" value={deg} readOnly tabIndex={-1} />
            </label>
            <div className={mapPage.angleRow}>
              <AngleCompass rad={deg * DEG} />
              <AngleStep {...angled(deg)} by={-1} />
              <AngleSlider {...angled(deg)} />
              <AngleStep {...angled(deg)} by={1} />
              <button className={mapPage.pillButton} tabIndex={-1}>
                {tr('Auto')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

function Direction() {
  const t = useLoop(10, 0.3);
  const deg = Math.round(20 + 90 * ease(t, 0.25, 0.6));
  const plan = useMemo(() => mowPlan({...LANES, angle: deg * DEG}), [deg]);
  return (
    <Stage
      t={t}
      map={GARDEN}
      selected={GARTEN.id}
      view={{stripes: plan.stripes, loops: plan.loops}}
      extra={() => <AngleOnMap {...angled(deg)} />}
      under={<AngleSettings deg={deg} />}
      hand={{
        moves: [
          [0, 'off'],
          [0.2, {range: 20}],
          [0.25, {range: 20}],
          [0.6, {range: 110}],
          [0.66, {range: 110}],
        ],
        press: [[0.24, 0.61]],
        taps: [],
        show: [0.06, 0.75],
      }}
    />
  );
}

// 9: the mowing order under the map: a lawn moved down, the numbers on the map go with it, then back up
function Order() {
  const t = useLoop(9, 0.2);
  const swapped = t >= 0.34 && t < 0.74;
  const order = swapped ? [VORGARTEN, GARTEN] : [GARTEN, VORGARTEN];
  const labels = Object.fromEntries(order.map((a, i) => [a.id, i + 1]));
  return (
    <Stage
      t={t}
      map={GARDEN}
      selected={null}
      view={{orderLabels: labels}}
      under={<OrderBox areas={order} idle onSelect={noop} onMove={noop} />}
      hand={{
        moves: [
          [0, 'off'],
          [0.28, {button: '↓'}],
          [0.36, {button: '↓'}],
          [0.68, {button: '↑', nth: 1}],
          [0.78, {button: '↑', nth: 1}],
        ],
        press: tap(0.32, 0.72),
        taps: [0.32, 0.72],
        show: [0.2, 0.84],
      }}
    />
  );
}

// 10: where the lawn really ends, close up at a corner: the line is where the middle drove, dashed where the body
// reached, green between them
const NX = MOWER_MODELS.find((m) => m.key === 'yf-nx')!;
const NX_BODY = sizesBody({...NX.sizes, outline: NX.outline})!;
// what the map says from when on
const EDGE_SAYS: [number, string][] = [
  [0.1, 'Line: where the middle of the mower drove'],
  [0.38, 'Dashed: how far its body reached'],
  [0.64, 'Green between them: lawn too'],
  [0.92, ''],
];

function Edges() {
  const t = useLoop(11, 0.6);
  const say = [...EDGE_SAYS].reverse().find(([from]) => t >= from)?.[1];
  return (
    <Stage
      t={t}
      map={GARDEN}
      selected={null}
      view={{bodyOverride: NX_BODY, focus: pt(13, 0.6), focusSpan: 4}}
      // each its own, so it fades in again
      extra={() =>
        say && (
          <div key={say} className={mapView.hintToast}>
            {tr(say)}
          </div>
        )
      }
      under={<Hint />}
      hand={{
        moves: [
          [0, 'off'],
          [0.1, {map: pt(12.2, 0)}],
          [0.36, {map: pt(12.2, 0)}],
          [0.4, {map: pt(12.2, -0.2)}],
          [0.62, {map: pt(12.2, -0.2)}],
          [0.66, {map: pt(12.2, -0.1)}],
          [0.9, {map: pt(12.2, -0.1)}],
        ],
        press: [],
        taps: [0.12, 0.42, 0.68],
        show: [0.06, 0.92],
      }}
    />
  );
}

// 11: the plan driven by the planner: the button under the map, then the mower round the lawn and along its lanes with
// its trail on the map, what it left (orange) and where the body got into the safety distance (red)
// the plan driven at a steady pace, turning on the spot at every corner
function framesAlong(path: Point[], speed = 0.45, turn = 0.8): SimFrame[] {
  const frames: SimFrame[] = [];
  let t = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.01) continue;
    const yaw = Math.atan2(b.y - a.y, b.x - a.x);
    if (frames.length) t += turn;
    frames.push([t, a.x, a.y, yaw, 1]);
    t += len / speed;
    frames.push([t, b.x, b.y, yaw, 1]);
  }
  return frames;
}
const SIM_PLAN = mowPlan({...LANES, angle: 20 * DEG});
// round the lawn once, then the lanes one way and the next one back
const SIM_FRAMES = framesAlong([...(SIM_PLAN.loops[0] ?? []), ...SIM_PLAN.stripes.flatMap(([a, b], i) => (i % 2 ? [b, a] : [a, b]))]);
const SIM_MINUTES = (SIM_FRAMES.at(-1)?.[0] ?? 0) / 60;
const SIM_RESULT: SimResult = {
  minutes: {all: SIM_MINUTES, mow: SIM_MINUTES * 0.97, plan: SIM_MINUTES * 1.06},
  drivenM: 0,
  mowedM2: 0,
  leftM2: 0.3,
  plannedLeftM2: 0.1,
  left: [{m2: 0.3, outline: [pt(13.3, 8.6), pt(13.85, 8.6), pt(13.4, 9.4)]}],
  touches: [
    {x: 6.15, y: 6.1, m: 0.031},
    {x: 4.4, y: 7.7, m: 0.018},
    {x: 2.9, y: 5.5, m: 0.012},
  ],
  navErrors: [],
  aborted: false,
  offPlan: {usual: 0.018, p95: 0.037, max: 0.05},
  spins: 4,
  frames: SIM_FRAMES,
};
const SIM_LEFT = SIM_RESULT.left.map((l) => l.outline);

function Simulate() {
  const t = useLoop(13, 0.86);
  const driving = t >= 0.12 && t < 0.22;
  const done = t >= 0.22;
  const clock = useMemo(() => createSimClock(SIM_FRAMES), []);
  // the drive played from start to end while the loop goes from 0.24 to 0.92
  useEffect(() => clock.seek(clock.end * Math.min(1, Math.max(0, (t - 0.24) / 0.68))), [clock, t]);
  const sim = useMemo(() => ({frames: SIM_FRAMES, clock}), [clock]);
  return (
    <Stage
      t={t}
      map={GARDEN}
      selected={GARTEN.id}
      view={{
        stripes: SIM_PLAN.stripes,
        loops: SIM_PLAN.loops,
        bodyOverride: NX_BODY,
        ...(done ? {sim, leftPieces: SIM_LEFT, marginPlaces: SIM_RESULT.touches} : {}),
      }}
      extra={() => (done ? <SimPlayer clock={clock} onClose={noop} /> : null)}
      under={
        <details className={mapPage.fold} open>
          <summary>{tr('This area')}</summary>
          <div className={mapPage.foldBody}>
            <SimulationView
              model="realistic"
              locked={driving}
              wait={driving ? tr('{what}, {pct} %', {what: tr('driving'), pct: Math.round(Math.min(1, (t - 0.12) / 0.1) * 100)}) : null}
              error={null}
              result={done ? SIM_RESULT : null}
              shown={done}
              canCancel
              onRun={noop}
              onModel={noop}
              onStop={noop}
              onShow={noop}
            />
          </div>
        </details>
      }
      hand={{
        moves: [
          [0, 'off'],
          [0.05, {button: tr('Simulate the drive')}],
          [0.12, {button: tr('Simulate the drive')}],
          [0.16, 'off'],
        ],
        press: tap(0.1),
        taps: [0.1],
        show: [0.03, 0.15],
      }}
    />
  );
}

// 12: the map's style: the gear on the map, then Garden, the lawn in stripes, ways and obstacles as pictures. what can
// come alive in the garden is switched on under it, each on its own
function StyleSettings({garden}: {garden: boolean}) {
  return (
    <section className={look.section}>
      <h3>{tr('Map style')}</h3>
      <div className={look.segment}>
        <button className={garden ? undefined : look.segmentOn} onClick={noop} tabIndex={-1}>
          {tr('Plain')}
        </button>
        <button className={garden ? look.segmentOn : undefined} onClick={noop} tabIndex={-1}>
          {tr('Garden')}
        </button>
      </div>
      {garden && (
        <div className={look.lifeChecks}>
          {LIFE.map(([part, label]) => (
            <label key={part}>
              <input type="checkbox" checked={false} onChange={noop} tabIndex={-1} />
              {tr(label)}
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

function Style() {
  const t = useLoop(9, 0.8);
  const open = t >= 0.17;
  const garden = t >= 0.42;
  return (
    <Stage
      t={t}
      map={GARDEN}
      selected={null}
      view={{mapStyle: garden ? 'garden' : 'plain'}}
      under={open ? <StyleSettings garden={garden} /> : <Hint />}
      hand={{
        moves: [
          [0, 'off'],
          [0.12, {aria: tr('Map settings')}],
          [0.2, {aria: tr('Map settings')}],
          [0.38, {button: tr('Garden')}],
          [0.8, {button: tr('Garden')}],
        ],
        press: tap(0.15, 0.4),
        taps: [0.15, 0.4],
        show: [0.06, 0.86],
      }}
    />
  );
}

// 13: decorating: a gnome picked in the row under the map and set with a tap on the map, picked right away (the lamps
// by the path have their rings), then held a moment and taken to another spot
const pinOf = (id: string, name: string, at: Point): MapArea => ({id, properties: {name, type: 'decor', pin: true}, outline: pinSquare(at.x, at.y)});
const LAMPS = [pinOf('lampe1', 'Gartenlampe', pt(7.4, 11)), pinOf('lampe2', 'Gartenlampe', pt(10.6, 11))];
const GNOME_AT = pt(12, 3.2);
const GNOME_TO = pt(11.4, 7.2);

function Decorate() {
  const t = useLoop(11, 0.62);
  const armed = t >= 0.14 && t < 0.36;
  const set = t >= 0.36;
  const at = mix(GNOME_AT, GNOME_TO, ease(t, 0.58, 0.74));
  const map = cached(`decor ${set} ${at.x.toFixed(2)},${at.y.toFixed(2)}`, () =>
    mapOf(GARTEN, TREE, VORGARTEN, WEG, BED, ...LAMPS, ...(set ? [pinOf('zwerg', 'Gartenzwerg', at)] : [])),
  );
  return (
    <Stage
      t={t}
      map={map}
      selected={set ? 'zwerg' : null}
      view={{decor: {armed}}}
      under={
        <DecorPanel
          areas={map.areas}
          pin={map.areas.find((a) => a.id === 'zwerg') ?? null}
          armed={armed ? {look: 'gnome', copy: false} : null}
          canUndo={set}
          canRedo={false}
          unsaved={set}
          saving={false}
          busy={false}
          error={null}
          changed={set}
          onArm={noop}
          onCopy={noop}
          onRemove={noop}
          onUndo={noop}
          onRedo={noop}
          onFinish={noop}
          onSaveAnyway={noop}
          onLater={noop}
          onCancel={noop}
          onSwap={noop}
        />
      }
      hand={{
        moves: [
          [0, 'off'],
          [0.1, {button: tr('Garden gnome')}],
          [0.16, {button: tr('Garden gnome')}],
          [0.32, {map: GNOME_AT}],
          [0.56, {map: GNOME_AT}],
          [0.74, {map: GNOME_TO}],
          [0.8, {map: GNOME_TO}],
        ],
        press: [...tap(0.13, 0.34), [0.48, 0.75]],
        taps: [0.13, 0.34],
        show: [0.04, 0.86],
      }}
    />
  );
}

// 14: save: the old map goes into the backups first, its preview can bring it back
const BACKUP = {id: 'b1', t: Math.round(Date.now() / 1000) - 120, name: 'before saving', auto: true, areas: GARDEN.areas.length, size: 1};

// the backups as the map page shows them, opened
function OpenBackups() {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    box.current?.querySelector('details')?.setAttribute('open', '');
  });
  return (
    <div ref={box}>
      <MapBackups backups={[BACKUP]} onCreate={async () => {}} onPreview={noop} onDelete={noop} onDownload={noop} onDownloadGeo={noop} onFile={noop} geo={null} />
    </div>
  );
}

function Save() {
  const t = useLoop(11, 0.5);
  const saving = t >= 0.16 && t < 0.26;
  const saved = t >= 0.26;
  const preview = t >= 0.56;
  // the buttons say something else a moment later: saving, asking again
  const saveSays = [tr('Save map'), tr('saving…')];
  const restoreSays = [tr('Restore'), tr('Really restore?')];
  return (
    <Stage
      t={t}
      map={GARDEN}
      selected={null}
      under={
        preview ? (
          <RestorePanel
            areas={BACKUP.areas}
            backedUp
            idle
            restoring={false}
            confirm={t >= 0.8}
            error={null}
            onRestore={noop}
            onDisarm={noop}
            onClose={noop}
          />
        ) : (
          <>
            <EditorToolbar
              idle
              canUndo={!saved}
              canRedo={false}
              unsaved={!saved}
              saving={saving}
              saveLabel={saving ? tr('saving…') : tr('Save map')}
              saveError={null}
              onDraw={noop}
              onUndo={noop}
              onRedo={noop}
              onSave={noop}
            />
            {saved && <OpenBackups />}
          </>
        )
      }
      hand={{
        moves: [
          [0, 'off'],
          [0.1, {button: saveSays}],
          [0.3, {button: saveSays}],
          [0.48, {button: tr('Preview')}],
          [0.56, {button: tr('Preview')}],
          [0.74, {button: restoreSays}],
          [0.9, {button: restoreSays}],
        ],
        press: tap(0.14, 0.53, 0.78),
        taps: [0.14, 0.53, 0.78],
        show: [0.04, 0.92],
      }}
    />
  );
}

export const EDITOR_ART = [Select, Types, Switches, Points, Snap, Split, Merge, Subtract, Lay, Reduce, Direction, Order, Edges, Simulate, Style, Decorate, Save];
