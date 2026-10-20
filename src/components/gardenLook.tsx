'use client';

import type {MapArea, Point} from '@/hooks/useMowerMap';
import {containsPoint} from '@/lib/geometry';
import {tr} from '@/lib/i18n';
import {insideEdge, type MowerBody} from '@/lib/mowerBody';
import {autoMowAngle} from '@/lib/mowStripes';
import {useEffect, useId} from 'react';
import {createPortal} from 'react-dom';
import {BY_NAME, GROUPS, PICTURE_KEYS, PICTURES, type Box} from './gardenPictures';
import styles from './MapLookSettings.module.css';

// The garden map style, drawn from above like the pictures in the guides: the lawn mown in stripes along each area's
// mowing direction, an area not mowed as meadow, ways and obstacles as the picture picked for them, else from their
// name (a way as gravel, an obstacle as a pond, a tree, a house ... or a bed). The pictures are in gardenPictures.

export type Look = string;
export type {Box};

export const isThing = (look: Look) => !!PICTURES[look]?.thing;

// what a way or an obstacle is drawn as: the picture picked for it, else from its name, a way only as a ground (gravel
// unless the name says otherwise), an obstacle as anything (a bed unless the name says otherwise)
export function areaLook(area: MapArea, looks?: Record<string, string>): Look {
  const picked = looks?.[area.id];
  if (picked && PICTURES[picked]) return picked;
  const name = area.properties.name ?? '';
  const way = area.properties.type === 'nav';
  return BY_NAME.find(([look, re]) => (!way || !isThing(look)) && re.test(name))?.[0] ?? (way ? 'gravel' : 'bed');
}

// the texture an area is filled with: the ground itself, or the one around a thing
export const groundOf = (look: Look): Look => (isThing(look) ? (PICTURES[look].around ?? 'meadow') : look);

// p starts the ids of its gradients and clips, unique on the page
export const drawThing = (look: Look, box: Box, p = 'gp') => PICTURES[look]?.thing?.(box, p);

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
}

// where a thing goes in its area, o its outline in svg units: around cx, cy, turned deg, w by h. a long one along the
// area's long side into the biggest box of that shape that fits in it, any other into the biggest circle in it
export function placeThing(look: Look, o: Point[]): Place {
  const n = o.length;
  const [mx, my] = [o.reduce((s, p) => s + p.x, 0) / n, o.reduce((s, p) => s + p.y, 0) / n];
  if (PICTURES[look]?.long) {
    // the long side from how the points spread
    let [sxx, syy, sxy] = [0, 0, 0];
    for (const p of o) {
      sxx += (p.x - mx) ** 2;
      syy += (p.y - my) ** 2;
      sxy += (p.x - mx) * (p.y - my);
    }
    const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
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
  return {cx: best.x, cy: best.y, deg: 0, w: 2 * best.r, h: 2 * best.r};
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
// each way's and obstacle's look, and a thing placed inside the area's real edge (with the mower's body known, else
// inside its outline), cut to clips[i]. worked out again only for another map, looks, body or fit
export interface GardenThings {
  lawns: Map<string, number>;
  looks: Map<string, Look>;
  things: Map<string, {i: number; look: Look; place: Place}>;
  angles: number[];
  clips: string[];
}

const thingsCache = new WeakMap<object, {looks?: object; body: object | null; key: string; out: GardenThings}>();

export function gardenThings(areas: MapArea[], looks: Record<string, string> | undefined, body: MowerBody | null, fit: Fit): GardenThings {
  const key = fitKey(fit);
  const hit = thingsCache.get(areas);
  if (hit && hit.looks === looks && hit.body === body && hit.key === key) return hit.out;
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
      const outline = ((body && insideEdge(a.outline, body)) || a.outline).map(at);
      out.things.set(a.id, {i: out.clips.length, look, place: placeThing(look, outline)});
      out.clips.push(outline.map((p) => `${p.x},${p.y}`).join(' '));
    }
  }
  thingsCache.set(areas, {looks, body, key, out});
  return out;
}

// a picture as a small square: its ground, a thing drawn on top
export function LookSwatch({look, size = 44}: {look: Look; size?: number}) {
  const id = 'look' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <defs>{texture(groundOf(look), id, 40)}</defs>
      <rect width={40} height={40} rx={7} fill={`url(#${id})`} />
      {isThing(look) && drawThing(look, {x: 4, y: 4, w: 32, h: 32}, id + 't')}
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
