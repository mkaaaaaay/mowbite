'use client';

import {MergePanel, SimplifyPanel, SplitPanel} from '@/app/map/Panels';
import {AREA_TYPES} from '@/app/map/editing';
import mapPage from '@/app/map/page.module.css';
import {MergeIcon, ScissorsIcon, SimplifyIcon, TrashIcon} from '@/components/icons';
import MapView from '@/components/MapView';
import mapView from '@/components/MapView.module.css';
import type {MapArea, MowerMap, Point} from '@/hooks/useMowerMap';
import {polygonArea} from '@/lib/geometry';
import {fmt, tr} from '@/lib/i18n';
import {mergeOutlines} from '@/lib/mergeAreas';
import {simplifyPolygon} from '@/lib/simplifyPolygon';
import {splitByPath} from '@/lib/splitPolygon';
import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from 'react';
import styles from './page.module.css';

// the editor guide shows the app's own map with an example garden on it and what the map page shows under it, the
// same parts the editor uses. a hand on top does what the step says, each step a loop played by a timeline

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
const DOCK = {id: 'dock', position: pt(2.2, -0.9), heading: Math.PI / 2};
const mapOf = (...areas: MapArea[]): MowerMap => ({areas, docking_stations: [DOCK]});
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

// where the hand is: a spot on the map, a button (by what it says), the range slider at a value, or off the bottom
type Target = {map: Point; dx?: number; dy?: number} | {button: string} | {range: number} | 'off';
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
function Stage({t, map, selected, picking, pending, preview, extra, under, hand}: {
  t: number;
  map: MowerMap;
  selected: string | null;
  picking?: boolean;
  pending?: Point[];
  preview?: Point[][];
  extra?: (toStage: (p: Point) => [number, number]) => React.ReactNode;
  under: React.ReactNode;
  hand: HandPlan;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const handRef = useRef<SVGGElement>(null);
  const ripple = useRef<SVGCircleElement>(null);
  // map spot -> stage, worked out anew every frame: the map can still settle after it's shown. what's drawn next to a
  // spot (the delete button) gets it a frame later, only when it changed
  const [place, setPlace] = useState<((p: Point) => [number, number]) | null>(null);
  const placed = useRef<((p: Point) => [number, number]) | null>(null);

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
    const at = (target: Target): [number, number] | null => {
      if (target === 'off') return [(box.width / z) * 0.85, box.height / z + 70];
      if ('map' in target) {
        if (!place) return null;
        const [x, y] = place(target.map);
        return [x + (target.dx ?? 0), y + (target.dy ?? 0)];
      }
      if ('button' in target) {
        const b = [...el.querySelectorAll('button')].find((x) => x.textContent?.trim() === target.button);
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return [(r.left - box.left + r.width / 2) / z, (r.top - box.top + r.height / 2) / z];
      }
      const input = el.querySelector<HTMLInputElement>('input[type=range]');
      if (!input) return null;
      const r = input.getBoundingClientRect();
      const f = (target.range - Number(input.min)) / (Number(input.max) - Number(input.min));
      return [(r.left - box.left + 8 + f * (r.width - 16)) / z, (r.top - box.top + r.height / 2) / z];
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
    if (!now) {
      g.setAttribute('opacity', '0');
      return;
    }
    const pressed = hand.press.some(([a, b]) => t >= a && t <= b);
    g.setAttribute('transform', `translate(${now[0]} ${now[1]}) scale(${pressed ? 0.88 : 1})`);
    g.setAttribute('opacity', t > hand.show[0] && t < hand.show[1] ? '1' : '0');
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
    <div ref={stage} className={styles.stage}>
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
  );
}

// what the map page shows under the map for a picked area: name, type, what it is and its tools
function AreaCard({a}: {a: MapArea}) {
  const tool = [mapPage.pillButton, mapPage.tool].join(' ');
  const type = AREA_TYPES.find((x) => x.value === a.properties.type);
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
          <input type="checkbox" checked readOnly tabIndex={-1} />
          {tr('active')}
        </label>
        <span className={mapPage.dim}>
          {tr(type?.hint ?? '')} · {fmt(polygonArea(a.outline), 1)} m²
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
          <SimplifyIcon size={16} />
          {tr('Reduce points')}
        </button>
        <button className={[tool, mapPage.danger].join(' ')} tabIndex={-1}>
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

// 2: a dent pulled out to the edge, a cut off corner pulled back out between two points, a stray point deleted
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

// 3: split: the button, two points for a line across, apply: two areas
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

// 4: merge: the button, then the other area, apply: one area from both
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

// 5: a recorded edge with a point every few cm: the slider takes out the ones that barely matter
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

export const EDITOR_ART = [Select, Points, Split, Merge, Reduce];
