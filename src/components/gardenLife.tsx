'use client';

import type {ReactNode} from 'react';
import type {MapArea, Point} from '@/hooks/useMowerMap';
import {containsPoint, polygonArea} from '@/lib/geometry';
import {joinedOutlines, realEdges, type MowerBody} from '@/lib/mowerBody';
import {autoMowAngle} from '@/lib/mowStripes';
import {seasonOf, sunPosition, type Season} from '@/lib/sun';
import {drawThing, fitKey, gardenThings, inSquare, type Fit, type GardenThing as Thing, type Look, type Place} from './gardenLook';
import styles from './MapView.module.css';

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
  floweringBush: 1.6,
  herbSpiral: 0.8,
  hotTub: 0.9,
  playTower: 3,
  pingPong: 0.8,
  pergola: 2.5,
  sunSail: 2.6,
  lamp: 0.7,
  woodpile: 1.2,
  birdhouse: 1.6,
  statue: 1.4,
  stump: 0.4,
  woodStairs: 0.6,
  bridge: 0.7,
  butterflyBush: 2.2,
  hydrangea: 1.2,
  rhododendron: 1.6,
  rose: 1,
  boxwood: 0.8,
  japaneseMaple: 2.5,
  bamboo: 3,
  lavender: 0.5,
  fern: 0.6,
  grass: 1.2,
  hosta: 0.4,
  cantilever: 2.6,
  cantilever8: 2.6,
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

// ---- the garden's life as MapView draws it, the same for the app and the home assistant card (mowbite-art.js)

// where the sun is worked out from when the mower has no position on earth: the middle of germany
const SOMEWHERE = {lat: 51, lon: 10};

// a point in the square of 400 as svg path text
export function svgAt(fit: Fit) {
  const at = inSquare(fit);
  return (p: Point) => {
    const q = at(p);
    return `${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
  };
}

const rings = (areas: {outline: Point[]}[], at: (p: Point) => string) => areas.map((a) => 'M' + a.outline.map(at).join('L') + 'Z').join('');

// worked out once per object (a map's areas, a job, a piece of the trail) and key, while they stay the same
function cached<T>(cache: WeakMap<object, {key: string; value: T}>, of: object, key: string, make: () => T): T {
  const hit = cache.get(of);
  if (hit && hit.key === key) return hit.value;
  const value = make();
  cache.set(of, {key, value});
  return value;
}

type Lawns = {lawns: MapArea[]; obstacles: MapArea[]; bySize: MapArea[]; along: {x: number; y: number}};
const lawnsCache = new WeakMap<object, {key: string; value: Lawns}>();
const lawnDCache = new WeakMap<object, {key: string; value: string}>();
const edgeCache = new WeakMap<object, {key: string; value: string}>();
const lawnLineCache = new WeakMap<object, {key: string; value: string}>();
const sprinkleCache = new WeakMap<object, {key: string; value: Sprinkle[]}>();
const jobCache = new WeakMap<object, {key: string; value: {there: string; back: string} | null}>();
const pieceCache = new WeakMap<object, {key: string; value: {there: string; back: string}}>();

// the lawns as they're cut (active, mowed), what lies in them, all areas biggest first like MapView draws them, and the
// stripes' way of the biggest lawn: a cut along it looks lighter, against it darker
function lawnsOf(areas: MapArea[]): Lawns {
  return cached(lawnsCache, areas, '', () => {
    const lawns = areas.filter((a) => a.properties.type === 'mow' && a.properties.active !== false && a.properties.mowable !== false && a.outline.length > 2);
    const obstacles = areas.filter((a) => a.properties.type === 'obstacle' && a.outline.length > 2);
    const bySize = [...areas].sort((a, b) => polygonArea(b.outline) - polygonArea(a.outline));
    const biggest = bySize.find((a) => lawns.includes(a));
    const angle = biggest ? (biggest.properties.angle ?? autoMowAngle(biggest.outline)) : 0;
    return {lawns, obstacles, bySize, along: {x: Math.cos(angle), y: Math.sin(angle)}};
  });
}

// the real edges as one line, the mowing areas grown and the obstacles shrunk by half the mower's width (lib/mowerBody)
export function realEdgeLine(areas: MapArea[], body: MowerBody, fit: Fit, obstacles = true) {
  const at = svgAt(fit);
  return cached(edgeCache, areas, `${fitKey(fit)}|${obstacles}|${JSON.stringify(body)}`, () => {
    const edges = realEdges(areas, body);
    return rings([...edges.lawn, ...(obstacles ? edges.obstacles : [])].map((outline) => ({outline})), at);
  });
}

// the lawns' outlines as one line: where two lawns meet there's no edge
function lawnLine(lawns: MapArea[], areas: MapArea[], fit: Fit) {
  const at = svgAt(fit);
  return cached(lawnLineCache, areas, fitKey(fit), () => rings(joinedOutlines(lawns.map((a) => a.outline)).map((outline) => ({outline})), at));
}

// where a thing's shadow lies in svg units: away from the sun, the lower it is the longer, and drawn from above it can't
// lie meters away from what casts it: at most almost half the thing's size. null for a flat one
export function thingShadow(look: Look, place: {w: number; h: number}, shadow: {x: number; y: number}, m: number) {
  const height = heightOf(look);
  const length = Math.hypot(shadow.x, shadow.y);
  if (!height || !length) return null;
  const r = Math.hypot(place.w, place.h) / 2;
  const reach = Math.max(0.12 * m, Math.min(height * length * 0.35 * m, 0.45 * r));
  return {dx: (shadow.x / length) * reach, dy: (-shadow.y / length) * reach};
}

// the biggest of a thing's places, what its shadow goes by
export const biggest = (places: Place[]) => places.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));

// how much of a crown's or a parasol's circle hides what's under it (of half its place, a rotary dryer's lines nothing),
// the circle round all of it (rim) and how far its middle is off the place's (ahead, of the place, the way it's turned)
const COVERS: Record<string, {r: number; rim?: number; ahead?: number}> = {
  umbrella: {r: 0.92},
  tree: {r: 0.88},
  fruitTree: {r: 0.86},
  palm: {r: 0.75},
  sunSail: {r: 0.55},
  cantilever: {r: 0.96, rim: 1.36, ahead: 0.6},
  cantilever8: {r: 0.96, rim: 1.06, ahead: 0.6},
};

// where the mower is hidden under a crown or a parasol: a circle each (svg units), rim the whole crown's (the plan and
// the track go over that)
export const coversOf = (things: Thing[]) =>
  things.flatMap((t) =>
    t.places
      .filter((pl) => pl.over && COVERS[t.look])
      .map((pl) => {
        const {r, rim = 1, ahead = 0} = COVERS[t.look];
        const a = (pl.deg * Math.PI) / 180;
        return {cx: pl.cx + Math.cos(a) * ahead * pl.w, cy: pl.cy + Math.sin(a) * ahead * pl.w, r: (pl.w / 2) * r, rim: (pl.w / 2) * rim};
      }),
  );

// an area's picture standing in it (a tree, a table ... or several), cut to the area (clip i of GardenDefs) unless it
// reaches over it, faded when the area is off. with a shadow the same once more first, dark and moved away from the sun
// (no filter, it stays while the map moves). part: only what's on the ground (with the shadow of all of it) or only the
// crowns and parasols over it, they go over the mower
export function GardenThing({
  uid,
  thing,
  off,
  shade,
  part,
}: {
  uid: string;
  thing: Thing;
  off: boolean;
  shade?: {dx: number; dy: number} | null;
  part?: 'ground' | 'over';
}) {
  const one = ({cx, cy, deg, w, h, seed}: Place, k: number) => (
    <g key={k} transform={`translate(${cx} ${cy}) rotate(${deg})`}>
      {drawThing(thing.look, {x: -w / 2, y: -h / 2, w, h}, `${uid}t${thing.i}${k ? '_' + k : ''}`, {
        seed: seed ?? thing.id,
        variant: thing.variant,
        m: thing.m,
        // a bed is never turned, its edge only moved to its middle
        edge: thing.edge?.map((q): [number, number] => [q.x - cx, q.y - cy]),
      })}
    </g>
  );
  const group = (ground: boolean, over: boolean) => {
    const inside = ground ? thing.places.map((pl, k) => (pl.over ? null : one(pl, k))) : [];
    return (
      <g className={[styles.gardenThing, off ? styles.gardenOff : ''].filter(Boolean).join(' ')}>
        {inside.some(Boolean) && <g clipPath={`url(#${uid}clip${thing.i})`}>{inside}</g>}
        {over && thing.places.map((pl, k) => (pl.over ? one(pl, k) : null))}
      </g>
    );
  };
  const drawn = group(part !== 'over', part !== 'ground');
  return (
    <>
      {shade && part !== 'over' && (
        <g className={styles.thingShadow} transform={`translate(${shade.dx} ${shade.dy})`}>
          {group(true, true)}
        </g>
      )}
      {drawn}
    </>
  );
}

// a recorded job as useMowHistory has it: position.history.list's entry with the segments position.history gives
export interface LifeJob {
  job_id: string;
  timestamp: number;
  segments: {attributes: {blades?: boolean}; points: [number, number][]}[];
}

// what the life is drawn from, all of it what MapView has: the map's areas, settings.garden and settings.looks, the
// mower's body (sizesBody, null without sizes), the fit and the ids' start of the garden's defs, now in ms, the map's
// place on earth (datum), the weather (useWeather, only with settings.weather), the mower's rain sensor, its position,
// the last jobs newest first, the live trail in pieces of poses (b: blades on), the lawns' real edges as drawn (left out
// they're worked out from the body, null for the outlines) and the layers switched off (MapControls)
export interface LifeInput {
  areas: MapArea[];
  garden?: Partial<GardenLife>;
  looks?: Record<string, string>;
  lookVariants?: Record<string, string>;
  lookSizes?: Record<string, number>;
  lookTurns?: Record<string, number>;
  body?: MowerBody | null;
  fit: Fit;
  uid: string;
  now?: number;
  datum?: {lat: number; lon: number} | null;
  weather?: {code: number; temp: number; raining: boolean} | null;
  rain?: boolean;
  mower?: {x: number; y: number} | null;
  jobs?: LifeJob[] | null;
  track?: readonly {x: number; y: number; b?: boolean}[][] | null;
  edgeLine?: string | null;
  hidden?: Iterable<string> | null;
}

export interface LifeScene {
  parts: GardenLife;
  // with runs to show the lawn not cut lately is long: the active lawns are filled with {uid}long instead of their stripes
  long: boolean;
  defs: ReactNode;
  lawn: ReactNode;
  things: ReactNode;
  stones: ReactNode;
  sky: ReactNode;
  // the crowns and parasols reaching over everything, the mower too, and where they hide it
  canopies: ReactNode;
  covers: {cx: number; cy: number; r: number; rim: number}[];
}

const FAR = {x: -10 * 400, y: -10 * 400, width: 21 * 400, height: 21 * 400};

// the garden's life in MapView's layers, null with none of it switched on. over the areas and their fills in this order:
// lawn (the cuts, frost and snow, leaves or daisies, cut to the lawns), the real lawn in the obstacles, things (each with
// its shadow, here instead of with its area), stones (the mowing edge along the lawns, their real edges' line is left out
// then) and sky
// (wet and the light over all of it), then the plan, the dock, the track and the mower
export function lifeScene(s: LifeInput): LifeScene | null {
  const parts = lifeOf(s.garden);
  if (!parts.sun && !parts.season && !parts.edge && !parts.growth) return null;
  const {fit, uid} = s;
  const m = fit.m;
  const now = s.now ?? Date.now();
  const at = svgAt(fit);
  const square = inSquare(fit);
  const hidden = new Set(s.hidden ?? []);
  const {lawns, obstacles, bySize, along} = lawnsOf(s.areas);
  const key = `${fitKey(fit)}|${along.x},${along.y}`;
  // the lawns without what lies in them, one path to cut the cuts and the season to (even-odd)
  const lawnD = cached(lawnDCache, s.areas, fitKey(fit), () => rings([...lawns, ...obstacles], at));
  const season = seasonOf(s.datum?.lat, new Date(now));
  const place = s.datum ?? SOMEWHERE;
  const sun = parts.sun ? sunPosition(place.lat, place.lon, new Date(now)) : null;

  // the last runs cut into the lawn, oldest first, fading as the grass grows back, and the live trail cut fresh
  const past = parts.growth
    ? [...(s.jobs ?? [])]
        .reverse()
        .map((job) => {
          const cut = cached(jobCache, job, key, () => {
            const stretches = job.segments.filter((g) => g.attributes.blades).map((g) => g.points.map(([x, y]) => ({x, y})));
            return stretches.length ? cutPaths(stretches, along, at) : null;
          });
          return cut && {id: job.job_id, opacity: freshness((now / 1000 - job.timestamp) / 86400), ...cut};
        })
        .filter((r) => r !== null)
    : [];
  let live: {there: string; back: string} | null = null;
  if (parts.growth && s.track?.length) {
    let there = '';
    let back = '';
    for (const piece of s.track) {
      const cut = cached(pieceCache, piece, key, () => {
        const stretches: Point[][] = [];
        let run: Point[] = [];
        for (const p of piece) {
          if (p.b ?? true) run.push(p);
          else {
            if (run.length > 1) stretches.push(run);
            run = [];
          }
        }
        if (run.length > 1) stretches.push(run);
        return cutPaths(stretches, along, at);
      });
      there += cut.there;
      back += cut.back;
    }
    if (there || back) live = {there, back};
  }

  // the season on the lawn with the weather: frost in winter unless it's warmer than 3°, snow while it snows (wmo codes),
  // wet in the rain
  const weather = s.weather;
  const snowing = !!weather && ((weather.code >= 71 && weather.code <= 77) || weather.code === 85 || weather.code === 86);
  const frosty = season === 'winter' && (!weather || weather.temp <= 3);
  const wet = parts.season && (!!s.rain || !!weather?.raining);
  const lawnSprinkles = parts.season ? cached(sprinkleCache, s.areas, season, () => sprinkles(lawns, obstacles, season)) : [];
  const light = sun ? lightOf(sun.elevation) : null;
  const castShadow = shadowOf(sun);
  const mower = s.mower ? square(s.mower) : null;

  // the stones only along the lawns (the obstacles keep their line), none where two lawns meet, nor where a way, an
  // obstacle or an area not mowed lies against them or over them
  const edgeLine = s.edgeLine !== undefined ? s.edgeLine : s.body ? realEdgeLine(s.areas, s.body, fit, false) : null;
  const stonesD = parts.edge ? (edgeLine ?? lawnLine(lawns, s.areas, fit)) : '';
  const besideD = stonesD
    ? rings(
        s.areas.filter((a) => {
          const type = a.properties.type ?? '';
          return a.outline.length > 2 && !hidden.has(type) && (type === 'nav' || type === 'obstacle' || (type === 'mow' && !lawns.includes(a)));
        }),
        at,
      )
    : '';
  const garden = gardenThings(s.areas, s.looks, s.body ?? null, fit, s.lookVariants, s.lookSizes, s.lookTurns);
  // the things reaching over the others and the mower, of the areas shown
  const shown = bySize
    .filter((a) => !hidden.has(a.properties.type ?? ''))
    .map((a) => garden.things.get(a.id))
    .filter((t): t is Thing => !!t && t.places.some((pl) => pl.over));

  return {
    parts,
    long: past.length > 0,
    defs: (
      <defs>
        <LifeDefs uid={uid} m={m} />
        <clipPath id={`${uid}lawnClip`}>
          <path d={lawnD} clipRule="evenodd" />
        </clipPath>
      </defs>
    ),
    lawn: (
      <g className={styles.gardenLife} clipPath={`url(#${uid}lawnClip)`}>
        {/* where the mower cut lately, fading as it grows back, and where it cuts now */}
        {(past.length > 0 || live) && (
          <g className={styles.cuts} strokeWidth={(s.body?.blade || 0.18) * m}>
            {past.map((c) => (
              <g key={c.id} opacity={c.opacity}>
                <path className={styles.cutThere} d={c.there} />
                <path className={styles.cutBack} d={c.back} />
              </g>
            ))}
            {live && (
              <>
                <path className={styles.cutThere} d={live.there} />
                <path className={styles.cutBack} d={live.back} />
              </>
            )}
          </g>
        )}
        {parts.season && (frosty || snowing) && <path d={lawnD} fillRule="evenodd" fill={`url(#${uid}frost)`} />}
        {parts.season && snowing && <path d={lawnD} fillRule="evenodd" fill="rgba(255,255,255,.5)" />}
        {lawnSprinkles.map((sp, i) => drawSprinkle({...sp, ...square(sp)}, m, season, i))}
      </g>
    ),
    things: bySize
      .filter((a) => !hidden.has(a.properties.type ?? ''))
      .map((a) => {
        const thing = garden.things.get(a.id);
        if (!thing) return null;
        const shade = castShadow ? thingShadow(thing.look, biggest(thing.places), castShadow, m) : null;
        return <GardenThing key={'t' + a.id} uid={uid} thing={thing} off={a.properties.active === false} shade={shade} part="ground" />;
      }),
    canopies: shown.map((thing) => (
      <GardenThing key={'c' + thing.id} uid={uid} thing={thing} off={s.areas.find((a) => a.id === thing.id)?.properties.active === false} part="over" />
    )),
    covers: coversOf(shown),
    stones: stonesD ? (
      <>
        {/* a little over the areas lying against the lawn, a stone half on them would show */}
        {besideD && (
          <mask id={`${uid}stones`} maskUnits="userSpaceOnUse" {...FAR}>
            <rect {...FAR} fill="#fff" />
            <path d={besideD} fill="#000" stroke="#000" strokeWidth={0.2 * m} />
          </mask>
        )}
        <g className={styles.stones} mask={besideD ? `url(#${uid}stones)` : undefined}>
          <path d={stonesD} strokeWidth={0.17 * m} strokeDasharray={`${0.26 * m} ${0.04 * m}`} />
          <path className={styles.stoneTop} d={stonesD} strokeWidth={0.11 * m} strokeDasharray={`${0.26 * m} ${0.04 * m}`} />
        </g>
      </>
    ) : null,
    sky: (
      <>
        {wet && <rect className={styles.gardenLight} {...FAR} fill={`url(#${uid}wet)`} />}
        {light && (
          <>
            {light.dark && mower && (
              <mask id={`${uid}night`} maskUnits="userSpaceOnUse" {...FAR}>
                <rect {...FAR} fill="#fff" />
                <circle cx={mower.x} cy={mower.y} r={3.5 * m} fill={`url(#${uid}pool)`} />
              </mask>
            )}
            <rect className={styles.gardenLight} {...FAR} fill={light.color} opacity={light.opacity} mask={light.dark && mower ? `url(#${uid}night)` : undefined} />
          </>
        )}
      </>
    ),
  };
}
