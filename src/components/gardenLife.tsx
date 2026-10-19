'use client';

import type {MapArea, Point} from '@/hooks/useMowerMap';
import {containsPoint, polygonArea} from '@/lib/geometry';
import type {Season} from '@/lib/sun';
import type {Look} from './gardenLook';

// what makes the garden map style come alive, each part switched on on its own in the map settings (all off by default):
// light and shadows after the sun, the season and the weather on the lawn, a mowing edge of stones and the lawn
// growing back where the mower hasn't been for a while, cut fresh where it goes now
export interface GardenLife {
  sun: boolean;
  season: boolean;
  edge: boolean;
  growth: boolean;
}

export const lifeOf = (s?: Partial<GardenLife>): GardenLife => ({
  sun: s?.sun === true,
  season: s?.season === true,
  edge: s?.edge === true,
  growth: s?.growth === true,
});

// how tall a thing stands for its shadow (m), a flat one casts none
const HEIGHTS: Record<string, number> = {
  tree: 5,
  conifer: 6,
  fruitTree: 3.5,
  palm: 4,
  bush: 1.3,
  raisedBed: 0.6,
  pot: 0.6,
  pool: 0.4,
  roundPool: 0.8,
  fountain: 1.2,
  rainBarrel: 1,
  trampoline: 1,
  sandbox: 0.25,
  swing: 2.2,
  goal: 1.5,
  greenhouse: 2.4,
  gazebo: 2.8,
  kennel: 1,
  car: 1.5,
  furniture: 0.9,
  table: 0.8,
  bench: 0.8,
  lounger: 0.4,
  lounge: 0.8,
  grill: 1,
  hammock: 1.2,
  umbrella: 2.4,
  firePit: 0.3,
  clothesDryer: 1.8,
  compost: 1,
  bins: 1.1,
  rocks: 0.5,
  gnome: 0.4,
  house: 7,
  shed: 2.5,
};

export const heightOf = (look: Look) => HEIGHTS[look] ?? 0;

// where a shadow falls per meter of height, in the map's meters (x east, y north): away from the sun, the lower it is
// the longer. null with the sun too low for one
export function shadowOf(sun: {azimuth: number; elevation: number} | null): {x: number; y: number} | null {
  if (!sun || sun.elevation < 3) return null;
  const length = Math.min(3, 1 / Math.tan((sun.elevation * Math.PI) / 180));
  const a = (sun.azimuth * Math.PI) / 180;
  return {x: -Math.sin(a) * length, y: -Math.cos(a) * length};
}

// the light over the garden after the sun: golden before it sets, blue at dusk, dark at night (a pool of light around
// the mower then), nothing by day
export function lightOf(elevation: number): {color: string; opacity: number; dark: boolean} | null {
  if (elevation > 6) return null;
  if (elevation > 0) return {color: '#ff9a4d', opacity: 0.14 * (1 - elevation / 6), dark: false};
  if (elevation > -6) return {color: '#2b2f6b', opacity: 0.18 + 0.22 * (-elevation / 6), dark: true};
  return {color: '#0d1636', opacity: 0.45, dark: true};
}

// the same random numbers for the same garden every time
function random(seed: string) {
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// things lying on the lawn by the season, in the map's meters: leaves in autumn, daisies in spring. on the lawns only,
// not in their obstacles
export interface Sprinkle {
  x: number;
  y: number;
  turn: number;
  color: string;
}

const LEAVES = ['#c8642a', '#d9a13b', '#a8452c', '#8c6a2f', '#b8862e'];

export function sprinkles(lawns: MapArea[], obstacles: MapArea[], season: Season): Sprinkle[] {
  if (season !== 'autumn' && season !== 'spring') return [];
  const perSquareMeter = season === 'autumn' ? 0.22 : 0.12;
  const out: Sprinkle[] = [];
  for (const a of lawns) {
    const xs = a.outline.map((p) => p.x);
    const ys = a.outline.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const next = random(a.id + season);
    const wanted = Math.min(140, Math.round(polygonArea(a.outline) * perSquareMeter));
    for (let tries = 0, n = 0; n < wanted && tries < wanted * 6; tries++) {
      const x = x0 + next() * (x1 - x0);
      const y = y0 + next() * (y1 - y0);
      if (!containsPoint(a.outline, x, y) || obstacles.some((o) => containsPoint(o.outline, x, y))) continue;
      out.push({x, y, turn: next() * 360, color: season === 'autumn' ? LEAVES[Math.floor(next() * LEAVES.length)] : '#ffffff'});
      n++;
    }
  }
  return out;
}

// a leaf or a daisy at a spot in svg units, m: svg units per meter
export function drawSprinkle(s: {x: number; y: number; turn: number; color: string}, m: number, season: Season, key: number) {
  if (season === 'spring') {
    return (
      <g key={key} transform={`translate(${s.x} ${s.y})`}>
        <circle r={0.03 * m} fill="#fbfbf5" />
        <circle r={0.012 * m} fill="#f2c53d" />
      </g>
    );
  }
  const l = 0.075 * m;
  return (
    <g key={key} transform={`translate(${s.x} ${s.y}) rotate(${s.turn})`}>
      <path d={`M0 ${-l}C${l * 0.7} ${-l * 0.5} ${l * 0.7} ${l * 0.5} 0 ${l}C${-l * 0.7} ${l * 0.5} ${-l * 0.7} ${-l * 0.5} 0 ${-l}Z`} fill={s.color} />
      <path d={`M0 ${-l}V${l * 1.25}`} stroke="rgba(70,40,20,.55)" strokeWidth={0.6} fill="none" />
    </g>
  );
}

// a run cut into the lawn: the stretches with the blade on as two paths by the way they went along the lawn's stripes,
// there and back look lighter and darker like a mown lawn. along: the stripes' direction (map), at: to svg
export function cutPaths(runs: Point[][], along: {x: number; y: number}, at: (p: Point) => string, minStep = 0.05) {
  let there = '';
  let back = '';
  for (const pts of runs) {
    let side: boolean | null = null;
    let last: Point | null = null;
    for (const p of pts) {
      if (!last) {
        last = p;
        continue;
      }
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      if (dx * dx + dy * dy < minStep * minStep) continue;
      const s = dx * along.x + dy * along.y >= 0;
      if (s !== side) {
        if (s) there += `M${at(last)}`;
        else back += `M${at(last)}`;
        side = s;
      }
      if (s) there += `L${at(p)}`;
      else back += `L${at(p)}`;
      last = p;
    }
  }
  return {there, back};
}

// how much a cut still shows after so many days, the grass growing back over it
export const freshness = (days: number) => Math.max(0.15, Math.min(1, 1 - 0.13 * days));

// the textures of the lawn's life, m: svg units per meter. ids start with uid like the garden's own
export function LifeDefs({uid, m}: {uid: string; m: number}) {
  const t = 0.6 * m;
  // tufts of long grass at fixed spots in the tile
  const tufts = [
    [0.12, 0.2],
    [0.45, 0.1],
    [0.3, 0.42],
    [0.08, 0.55],
    [0.5, 0.5],
    [0.22, 0.75],
    [0.42, 0.82],
    [0.05, 0.92],
  ];
  return (
    <>
      <pattern id={`${uid}long`} patternUnits="userSpaceOnUse" width={t} height={t}>
        <rect width={t} height={t} fill="#3f7533" />
        {tufts.map(([x, y], i) => (
          <path
            key={i}
            d={`M${x * t} ${y * t}l${-0.03 * m} ${-0.08 * m}M${x * t} ${y * t}l${0.01 * m} ${-0.09 * m}M${x * t} ${y * t}l${0.04 * m} ${-0.07 * m}`}
            stroke={i % 2 ? '#335f29' : '#4e8a3d'}
            strokeWidth={0.012 * m}
            strokeLinecap="round"
            style={{vectorEffect: 'none'}}
          />
        ))}
      </pattern>
      <pattern id={`${uid}frost`} patternUnits="userSpaceOnUse" width={0.4 * m} height={0.4 * m}>
        <rect width={0.4 * m} height={0.4 * m} fill="rgba(235,245,255,.28)" />
        {[
          [0.05, 0.08],
          [0.22, 0.04],
          [0.33, 0.2],
          [0.12, 0.27],
          [0.28, 0.35],
          [0.02, 0.36],
        ].map(([x, y], i) => (
          <circle key={i} cx={x * m} cy={y * m} r={0.014 * m} fill="rgba(255,255,255,.85)" />
        ))}
      </pattern>
      <pattern id={`${uid}wet`} patternUnits="userSpaceOnUse" width={1.2 * m} height={1.2 * m} patternTransform="rotate(-30)">
        <rect width={1.2 * m} height={1.2 * m} fill="rgba(70,110,170,.12)" />
        <rect y={0.2 * m} width={1.2 * m} height={0.05 * m} fill="rgba(255,255,255,.12)" />
        <rect y={0.75 * m} width={1.2 * m} height={0.03 * m} fill="rgba(255,255,255,.08)" />
      </pattern>
      <radialGradient id={`${uid}pool`}>
        <stop offset="0" stopColor="#000" />
        <stop offset="0.55" stopColor="#000" stopOpacity="0.6" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
    </>
  );
}
