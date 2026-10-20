'use client';

import type {MapArea, Point} from '@/hooks/useMowerMap';
import {containsPoint} from '@/lib/geometry';
import {tr} from '@/lib/i18n';
import {insideEdge, type MowerBody} from '@/lib/mowerBody';
import {autoMowAngle} from '@/lib/mowStripes';
import {useEffect, useId} from 'react';
import {createPortal} from 'react-dom';
import {BY_NAME, GROUPS, PICTURE_KEYS, PICTURES, random, type Box} from './gardenPictures';
import styles from './MapLookSettings.module.css';

// The garden map style, drawn from above like the pictures in the guides: the lawn mown in stripes along each area's
// mowing direction, an area not mowed as meadow, ways and obstacles as the picture picked for them, else from their
// name (a way as gravel, an obstacle as a pond, a tree, a house ... or a bed). The pictures are in gardenPictures.

export type Look = string;
export type {Box};

export const isThing = (look: Look) => !!PICTURES[look]?.thing;

// what a way or an obstacle is drawn as: the picture picked for it, else from its name, a way only as a ground (gravel
// unless the name says otherwise) or as steps or a bridge, an obstacle as anything (a bed unless the name says otherwise)
export function areaLook(area: MapArea, looks?: Record<string, string>): Look {
  const picked = looks?.[area.id];
  if (picked && PICTURES[picked]) return picked;
  const name = area.properties.name ?? '';
  const way = area.properties.type === 'nav';
  return BY_NAME.find(([look, re]) => (!way || !isThing(look) || PICTURES[look].way) && re.test(name))?.[0] ?? (way ? 'gravel' : 'bed');
}

// the texture an area is filled with: the ground itself, or the one around a thing
export const groundOf = (look: Look): Look => (isThing(look) ? (PICTURES[look].around ?? 'meadow') : look);

// p starts the ids of its gradients and clips, unique on the page. seed varies it (the area's id: the same tree every time,
// p without one), variant is the color picked for it (settings.lookVariants), m svg units per meter (left out: from the box),
// edge a bed's real edge in the box's units, closed a parasol folded up, tile a bed as one tile of a pattern, border only
// its border
export const drawThing = (
  look: Look,
  box: Box,
  p = 'gp',
  o?: {seed?: string; variant?: string; m?: number; edge?: [number, number][]; closed?: boolean; tile?: boolean; border?: boolean},
) => PICTURES[look]?.thing?.(box, p, {seed: o?.seed ?? p, variant: o?.variant, m: o?.m, edge: o?.edge, closed: o?.closed, tile: o?.tile, border: o?.border});

// how far a point is from the outline
function edgeDistance(o: Point[], x: number, y: number) {
  let best = Infinity;
  o.forEach((a, i) => {
    const b = o[(i + 1) % o.length];
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
  });
  return best;
}

export interface Place {
  cx: number;
  cy: number;
  deg: number;
  w: number;
  h: number;
  // reaches over the area's edge (a crown, a parasol), not cut to it
  over?: boolean;
  // made bigger than its area by hand: not cut to it either, but on the ground
  loose?: boolean;
  // one of several in the area, varied by this
  seed?: string;
}

// where a thing goes in its area, o its outline in svg units: around cx, cy, turned deg, w by h. a long one along the
// area's long side into the biggest box of that shape that fits in it, any other into the biggest circle in it
export function placeThing(look: Look, o: Point[], turn?: number): Place {
  if (PICTURES[look]?.fill) {
    // a bed over the whole area
    const [xs, ys] = [o.map((q) => q.x), o.map((q) => q.y)];
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return {cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, deg: 0, w: x1 - x0, h: y1 - y0};
  }
  const n = o.length;
  const [mx, my] = [o.reduce((s, p) => s + p.x, 0) / n, o.reduce((s, p) => s + p.y, 0) / n];
  if (PICTURES[look]?.long) {
    // the long side from how the points spread, or the way it's turned (degrees)
    let [sxx, syy, sxy] = [0, 0, 0];
    for (const p of o) {
      sxx += (p.x - mx) ** 2;
      syy += (p.y - my) ** 2;
      sxy += (p.x - mx) * (p.y - my);
    }
    const a = turn !== undefined ? (turn * Math.PI) / 180 : 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const [c, s] = [Math.cos(a), Math.sin(a)];
    const us = o.map((p) => (p.x - mx) * c + (p.y - my) * s);
    const vs = o.map((p) => -(p.x - mx) * s + (p.y - my) * c);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    const [uc, vc] = [(u0 + u1) / 2, (v0 + v1) / 2];
    const [cx, cy] = [mx + uc * c - vc * s, my + uc * s + vc * c];
    // smaller until its corners and the middles of its sides are inside
    for (let f = 0.92; f > 0.3; f -= 0.04) {
      const [w, h] = [(u1 - u0) * f, (v1 - v0) * f];
      const edge = [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => [i, j])).filter(([i, j]) => i || j);
      if (edge.every(([i, j]) => containsPoint(o, cx + ((i * w) / 2) * c - ((j * h) / 2) * s, cy + ((i * w) / 2) * s + ((j * h) / 2) * c))) {
        return {cx, cy, deg: (a * 180) / Math.PI, w, h};
      }
    }
  }
  // the biggest circle: its middle looked for on a grid, finer around the best one so far
  let best = {x: mx, y: my, r: containsPoint(o, mx, my) ? edgeDistance(o, mx, my) : 0};
  const xs = o.map((p) => p.x);
  const ys = o.map((p) => p.y);
  let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let pass = 0; pass < 3; pass++) {
    const k = 14;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        const [x, y] = [x0 + ((x1 - x0) * (i + 0.5)) / k, y0 + ((y1 - y0) * (j + 0.5)) / k];
        if (!containsPoint(o, x, y)) continue;
        const r = edgeDistance(o, x, y);
        if (r > best.r) best = {x, y, r};
      }
    }
    const [dx, dy] = [(x1 - x0) / k, (y1 - y0) / k];
    [x0, x1, y0, y1] = [best.x - dx, best.x + dx, best.y - dy, best.y + dy];
  }
  return {cx: best.x, cy: best.y, deg: turn ?? 0, w: 2 * best.r, h: 2 * best.r};
}

// round ones as big across as each() says packed into the outline as snug as they go, each a little into the next. over:
// only their middles inside (crowns over the edge), else inside but for a little. extra: a spot that's surely free
function pack(o: Point[], each: () => number, over: boolean, rnd: () => number, extra: Point & {e: number}, most = 40) {
  const xs = o.map((p) => p.x);
  const ys = o.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const big = Math.max(x1 - x0, y1 - y0);
  const first = each() / 2;
  const step = Math.max(big / 60, Math.min(big / 30, first * 0.25));
  const spots = [extra];
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let y = y0 + step / 2; y < y1; y += step) {
      if (containsPoint(o, x, y)) spots.push({x, y, e: edgeDistance(o, x, y)});
    }
  }
  const out: {x: number; y: number; r: number}[] = [];
  for (let k = 0; k < most; k++) {
    const r = k ? each() / 2 : first;
    let best: Point | null = null;
    let least = Infinity;
    for (const c of spots) {
      let gap = c.e - r * (over ? 0.15 : 0.8);
      for (let i = 0; i < out.length && gap >= 0; i++) gap = Math.min(gap, Math.hypot(c.x - out[i].x, c.y - out[i].y) - (r + out[i].r) * (over ? 0.62 : 0.8));
      if (gap < 0) continue;
      const score = gap + rnd() * r * 0.3;
      if (score < least) [least, best] = [score, c];
    }
    if (!best) break;
    out.push({x: best.x, y: best.y, r});
  }
  return out;
}

// where a thing goes in its area about as big as it really is (PICTURES' size), o the area's outline in svg units, m svg
// units per meter, seed the area's id. size and turn picked for the area: how big it is in meters (across, a long one its
// length, bushes and trees each), which way it lies or reaches (degrees in the svg, 0 right). by itself a long one lies
// along the area no longer nor deeper than it is, a crown or a parasol reaches over the edge, several bushes or trees
// stand where there's room, any other goes into the biggest circle but no bigger than it is. one made bigger than its
// area isn't cut to it
export function placeThings(look: Look, o: Point[], m: number, seed: string, size?: number, turn?: number): Place[] {
  const pic = PICTURES[look];
  const fit = placeThing(look, o, pic?.over ? undefined : turn);
  if (!pic || !(m > 0)) return [fit];
  const own = size && size > 0 ? size * m : undefined;
  if (pic.long) {
    const w = pic.size ? Math.min(fit.w, pic.size[1] * m) : fit.w;
    // turned by hand it keeps lying that way: never deeper than long
    const h = Math.min(pic.deep ? Math.min(fit.h, pic.deep * m) : fit.h, turn !== undefined ? w : Infinity);
    if (!own) return [{...fit, w, h}];
    const k = own / w;
    return [{...fit, w: own, h: h * k, loose: own > fit.w + 0.01 || h * k > fit.h + 0.01}];
  }
  if (!pic.size) return [own ? {...fit, w: own, h: own, loose: own > fit.w + 0.01} : fit];
  const [lo, hi] = [pic.size[0] * m, pic.size[1] * m];
  if (pic.many) {
    const rnd = random(seed + 'many');
    // trees as big as they are over the edge, bushes no bigger than fits, mostly on the small side
    const top = pic.over ? hi : Math.min(hi, fit.w * 0.9);
    const from = Math.min(lo, top);
    const each = own ? () => own : () => from + (top - from) * (pic.over ? 0.1 + rnd() * 0.4 : rnd() * 0.55);
    const spots = pack(o, each, !!pic.over, rnd, {x: fit.cx, y: fit.cy, e: fit.w / 2});
    if (spots.length > 1) {
      return spots
        .map((c, k) => ({cx: c.x, cy: c.y, deg: turn ?? 0, w: 2 * c.r, h: 2 * c.r, over: pic.over, seed: k ? `${seed}~${k}` : undefined}))
        .sort((a, b) => a.w - b.w);
    }
  }
  if (pic.over) {
    const s = own ?? Math.min(Math.max(fit.w, lo), hi);
    return [{...fit, w: s, h: s, over: true, deg: turn ?? fit.deg}];
  }
  const s = own ?? Math.min(fit.w, hi);
  return [{...fit, w: s, h: s, loose: s > fit.w + 0.01}];
}

// a ground as a texture with this id, m: svg units per meter
function texture(look: Look, id: string, m: number) {
  const tile = PICTURES[look]?.tile;
  if (!tile) return null;
  return (
    <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={tile.w * m} height={tile.h * m}>
      <rect width={tile.w * m} height={tile.h * m} fill={tile.base} />
      {tile.draw(m)}
    </pattern>
  );
}

// the textures and outlines to cut things to, once per map. lawns: each mowing area's direction in radians, the area's
// lawn is {uid}lawn{its index}, every ground {uid}{its name}, the outline of thing i {uid}clip{i}. ids start with uid,
// several maps can be on one page
export function GardenDefs({uid, m, lawns, clips}: {uid: string; m: number; lawns: number[]; clips: string[]}) {
  return (
    <defs>
      {/* stripes a meter wide along the mowing direction (svg y points down, the angle counts the other way round) */}
      {lawns.map((angle, i) => (
        <pattern
          key={i}
          id={`${uid}lawn${i}`}
          patternUnits="userSpaceOnUse"
          width={2 * m}
          height={2 * m}
          patternTransform={`rotate(${(-angle * 180) / Math.PI})`}
        >
          <rect width={2 * m} height={2 * m} fill="#4a873b" />
          <rect width={2 * m} height={m} fill="#539340" />
        </pattern>
      ))}
      {PICTURE_KEYS.map((look) => texture(look, uid + look, m))}
      {clips.map((points, i) => (
        <clipPath key={i} id={`${uid}clip${i}`}>
          <polygon points={points} />
        </clipPath>
      ))}
    </defs>
  );
}

// where MapView's square of 400 shows the map: m svg units per meter, the map's corner minX, minY at padX, padY from the
// square's bottom left (svg's y points down)
export interface Fit {
  minX: number;
  minY: number;
  m: number;
  padX: number;
  padY: number;
}

export const fitKey = (f: Fit) => `${f.minX},${f.minY},${f.m},${f.padX},${f.padY}`;
export const inSquare = (f: Fit) => (p: Point): Point => ({x: (p.x - f.minX) * f.m + f.padX, y: 400 - ((p.y - f.minY) * f.m + f.padY)});

// a map's garden as MapView draws it: each mowing area's lawn by the index of its stripes (angles: their directions),
// each way's and obstacle's look, and things placed in the area's real edge (with the mower's body known, else in its
// outline) at their size (sizes: picked per area, settings.lookSizes), cut to clips[i] unless they reach over it. m: svg
// units per meter. worked out again only for another map, looks, body or fit, the places only for an area that changed
export interface GardenThing {
  i: number;
  id: string;
  look: Look;
  variant?: string;
  m: number;
  places: Place[];
  // a bed's real edge (svg units), its border goes along it
  edge?: Point[];
  // a parasol folded up
  closed?: boolean;
  // a bed over the whole area, drawn as a pattern
  fill?: boolean;
}
export interface GardenThings {
  lawns: Map<string, number>;
  looks: Map<string, Look>;
  things: Map<string, GardenThing>;
  angles: number[];
  clips: string[];
}

// what's picked for each area's picture besides which one (settings.lookVariants, lookSizes, lookTurns, lookClosed): its
// color, size (m), direction (degrees in the svg) and a parasol folded up, by area id
export interface ThingsOwn {
  variants?: Record<string, string>;
  sizes?: Record<string, number>;
  turns?: Record<string, number>;
  closed?: Record<string, boolean>;
}

const thingsCache = new WeakMap<object, {looks?: object; own: ThingsOwn; body: object | null; key: string; out: GardenThings}>();

// the things a cantilever parasol stands by, it reaches over them
const SEATS = ['table', 'furniture', 'lounge', 'lounger', 'bench', 'pingPong', 'grill', 'firePit', 'hotTub'];

// which way a thing that faces a way does by itself: towards the nearest table or seats within 6 m, else towards the
// middle of the lawn it stands in. degrees in the svg (at: map to svg), 0 without either
export function facing(a: MapArea, areas: MapArea[], looks: Record<string, string> | undefined, at: (p: Point) => Point): number {
  const mid = (o: Point[]) => ({x: o.reduce((s, p) => s + p.x, 0) / o.length, y: o.reduce((s, p) => s + p.y, 0) / o.length});
  const from = mid(a.outline);
  let near: {d: number; to: Point} | null = null;
  for (const b of areas) {
    if (b === a || b.outline.length < 3 || (b.properties.type !== 'obstacle' && b.properties.type !== 'nav')) continue;
    if (!SEATS.includes(areaLook(b, looks))) continue;
    const to = mid(b.outline);
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    if (d < 6 && (!near || d < near.d)) near = {d, to};
  }
  const lawn = near ? null : areas.find((b) => b.properties.type === 'mow' && b.outline.length > 2 && containsPoint(b.outline, from.x, from.y));
  const to = near?.to ?? (lawn ? mid(lawn.outline) : null);
  if (!to) return 0;
  const [p, q] = [at(from), at(to)];
  return (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
}
const placeCache = new WeakMap<MapArea, {key: string; body: object | null; outline: Point[]; places: Place[]}>();

export function gardenThings(
  areas: MapArea[],
  looks: Record<string, string> | undefined,
  body: MowerBody | null,
  fit: Fit,
  own: ThingsOwn = {},
): GardenThings {
  const {variants, sizes, turns, closed} = own;
  const key = fitKey(fit);
  const hit = thingsCache.get(areas);
  const same = (o: ThingsOwn) => o.variants === variants && o.sizes === sizes && o.turns === turns && o.closed === closed;
  if (hit && hit.looks === looks && same(hit.own) && hit.body === body && hit.key === key) return hit.out;
  const at = inSquare(fit);
  const out: GardenThings = {lawns: new Map(), looks: new Map(), things: new Map(), angles: [], clips: []};
  for (const a of areas) {
    const type = a.properties.type;
    if (type === 'mow') {
      out.lawns.set(a.id, out.angles.length);
      out.angles.push(a.properties.angle ?? autoMowAngle(a.outline));
    } else if ((type === 'obstacle' || type === 'nav') && a.outline.length > 2) {
      const look = areaLook(a, looks);
      out.looks.set(a.id, look);
      if (!isThing(look)) continue;
      const turn = turns?.[a.id] ?? (PICTURES[look].turn ? facing(a, areas, looks, at) : undefined);
      const placeKey = `${look}|${sizes?.[a.id] ?? ''}|${turn ?? ''}|${key}`;
      let placed = placeCache.get(a);
      if (!placed || placed.key !== placeKey || placed.body !== body) {
        const outline = ((body && insideEdge(a.outline, body)) || a.outline).map(at);
        placed = {key: placeKey, body, outline, places: placeThings(look, outline, fit.m, a.id, sizes?.[a.id], turn)};
        placeCache.set(a, placed);
      }
      const edge = PICTURES[look].edged ? placed.outline : undefined;
      const folded = PICTURES[look].folds && closed?.[a.id] ? true : undefined;
      out.things.set(a.id, {i: out.clips.length, id: a.id, look, variant: variants?.[a.id], m: fit.m, places: placed.places, edge, closed: folded, fill: PICTURES[look].fill});
      out.clips.push(placed.outline.map((p) => `${p.x},${p.y}`).join(' '));
    }
  }
  thingsCache.set(areas, {looks, own: {variants, sizes, turns, closed}, body, key, out});
  return out;
}

// a picture as a small square: its ground, a thing drawn on top, as the area with this seed draws it in that color
export function LookSwatch({look, size = 44, seed, variant}: {look: Look; size?: number; seed?: string; variant?: string}) {
  const id = 'look' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <defs>
        {texture(groundOf(look), id, 40)}
        <clipPath id={id + 'c'}>
          <rect width={40} height={40} rx={7} />
        </clipPath>
      </defs>
      <rect width={40} height={40} rx={7} fill={`url(#${id})`} />
      {isThing(look) && <g clipPath={`url(#${id}c)`}>{drawThing(look, {x: 4, y: 4, w: 32, h: 32}, id + 't', {seed, variant})}</g>}
    </svg>
  );
}

// all pictures to pick from, by group, over the page like the map settings. value: the one picked, auto: what the
// area is drawn as without one
export function LookPicker({value, auto, onPick, onClose}: {value?: string; auto: Look; onPick: (look: Look | undefined) => void; onClose: () => void}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const keep = (e: React.SyntheticEvent) => e.stopPropagation();
  const choice = (look: Look | undefined, label: string) => (
    <button key={look ?? 'auto'} className={[styles.icon, value === look ? styles.iconOn : ''].join(' ')} onClick={() => onPick(look)}>
      <LookSwatch look={look ?? auto} />
      <span>{label}</span>
    </button>
  );
  return createPortal(
    <div className={styles.backdrop} onClick={onClose} onPointerDown={keep} onWheel={keep} onTouchStart={keep}>
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label={tr('Picture on the map')} onClick={keep}>
        <div className={styles.panelHead}>
          <h2>{tr('Picture on the map')}</h2>
          <button className={styles.close} onClick={onClose} aria-label={tr('Close')}>
            ✕
          </button>
        </div>
        <section className={styles.section}>
          <div className={styles.icons}>{choice(undefined, tr('Auto ({what})', {what: tr(PICTURES[auto].label)}))}</div>
          <p className={styles.dim}>{tr('Auto goes by the name of the area.')}</p>
        </section>
        {GROUPS.map((g) => (
          <section key={g.key} className={styles.section}>
            <h3>{tr(g.label)}</h3>
            <div className={styles.icons}>{PICTURE_KEYS.filter((k) => PICTURES[k].group === g.key).map((k) => choice(k, tr(PICTURES[k].label)))}</div>
          </section>
        ))}
      </div>
    </div>,
    document.body,
  );
}
