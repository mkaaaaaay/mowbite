// app settings (map colors, icons). shared through the mower when the app runs from the docker image
// (docker/settings.cgi), otherwise per device. localStorage is also the cache so they're there
// before the request comes back.

import type {GardenLife} from '@/components/gardenLife';
import {mergeChanges} from './mergeChanges';
import {apiBase, isDemo, mowerFetch} from './mowers';
import {isApp} from './native';

export const COLORS = [
  {key: 'mower', label: 'Mower', value: '#ff1fa3'},
  {key: 'dock', label: 'Docking station', value: '#2196f3'},
  {key: 'track', label: 'Track', value: '#ff1fa3'},
  {key: 'transit', label: 'Driving without blades', value: '#ff1fa3'},
  {key: 'mow', label: 'Mowing area', value: '#4caf50'},
  {key: 'unmowed', label: 'Mowing area, not mowed', value: '#ffb300'},
  {key: 'nav', label: 'Navigation area', value: '#29b6f6'},
  {key: 'obstacle', label: 'Obstacle', value: '#ef5350'},
  {key: 'decor', label: 'Decoration', value: '#a1887f'},
  {key: 'draft', label: 'Draft', value: '#888888'},
  {key: 'selected', label: 'Selected area', value: '#ff1fa3'},
  {key: 'vertex', label: 'Outline points', value: '#2196f3'},
  {key: 'stripes', label: 'Mowing plan', value: '#ff1fa3'},
  {key: 'body', label: 'Mower outline', value: '#ff1fa3'},
  {key: 'swath', label: 'Cut width', value: '#ffffff'},
  {key: 'edge', label: 'Real edges', value: '#c5e1a5'},
] as const;

export type ColorKey = (typeof COLORS)[number]['key'];

// another mower running MowBite, the app can switch to it
export interface OtherMower {
  id: string;
  name: string;
  host: string; // name or ip in the local network
  appPort?: number; // MowBite, 8082
  wsPort?: number; // OpenMower's mqtt websocket, 9001
  prefix?: string;
}

export interface Settings {
  colors?: Partial<Record<ColorKey, string>>;
  // sizes are factors, 1 = default
  icons?: {mower?: string; dock?: string; mowerSize?: number; dockSize?: number; mowerRealSize?: boolean};
  // map on the dashboard: only while driving (default) or always
  dashboard?: {map?: 'auto' | 'always'};
  // weather on the dashboard from open-meteo, off unless switched on (it sends the rough position there)
  weather?: boolean;
  // the strip of grass along the bottom, on unless switched off
  grass?: boolean;
  // leaves drifting down in autumn, on unless switched off
  leaves?: boolean;
  // name of the mower this app runs on, and the other ones to switch to
  thisName?: string;
  mowers?: OtherMower[];
  // own aerial imagery source, xyz tile url, and the user's own ArcGIS key for Esri World Imagery. offsets: [east, north] in m
  // a source's pictures are moved by, where they don't line up with the map
  imagery?: {url?: string; attribution?: string; esriKey?: string; offsets?: Record<string, [number, number]>};
  // how the maps are drawn: plain colored areas (default) or garden, from above like the guides (components/gardenLook)
  mapStyle?: 'garden';
  // the garden style's picture of a way or an obstacle by area id, picked under the map (else from its name)
  looks?: Record<string, string>;
  // the color picked for an area's picture that comes in several (a parasol's fabric, a roof), by area id
  lookVariants?: Record<string, string>;
  // how big an area's tree, parasol or bushes are drawn in meters (across), by area id
  lookSizes?: Record<string, number>;
  // which way an area's picture lies or a cantilever parasol reaches, degrees on the map drawing (0 east, 90 south), by
  // area id
  lookTurns?: Record<string, number>;
  // an area's parasol folded up, by area id
  lookClosed?: Record<string, boolean>;
  // the ground under and round an area's picture (gardenPictures' GROUND_KEYS), by area id, else the picture's own
  lookGrounds?: Record<string, string>;
  // what makes the garden style come alive (components/gardenLife), each off unless switched on
  garden?: Partial<GardenLife>;
  // the mower's sizes in meters for its outline and the strip its blade cuts on the map (lib/mowerBody)
  // outline: the body's real contour from above, [ahead, left] in meters around the same point, the rectangle without it
  mower?: {width?: number; front?: number; rear?: number; blade?: number; bladeAhead?: number; bladeOffset?: number; outline?: [number, number][]};
  // sizes that are exactly a model's with a measured outline take that outline on their own (lib/mowerBody): keepRectangle
  // stays with the rectangle instead, autoOutline is the model whose outline the app gave the MowBite Planner by itself
  keepRectangle?: boolean;
  autoOutline?: string;
  // after every finished mow the container asks the MowBite Planner what the track left unmowed and mows that right
  // away when it's at least min m² (docker/scheduler.sh), off unless switched on
  // tz and pos: the time zone and the place for "not in the dark", for the container without a schedule saved
  leftovers?: {auto?: boolean; min?: number; tz?: string; pos?: string};
}

const STORAGE_KEY = 'appSettings';
const PATH = '/cgi-bin/settings';
// where the settings are kept: with the mower looked at in the android app (it has no mower of its own), with the one
// the page comes from in a browser. a browser looking at another mower keeps that one's own settings (MOWER_KEYS)
// there, ownUrl, the app's (design, colors, the list of mowers) stay home
const homeUrl = () => (isApp() ? apiBase() : '') + PATH;
const ownUrl = () => (!isApp() && apiBase() ? apiBase() + PATH : null);

const NONE: Settings = {};
let current: Settings | null = null;
let shared = false;
const listeners = new Set<() => void>();

function load(): Settings {
  if (current) return current;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // colors used to be stored on their own
    const old = localStorage.getItem('mapColors');
    current = raw ? JSON.parse(raw) : old ? {colors: JSON.parse(old)} : {};
  } catch {
    current = {};
  }
  return current ?? NONE;
}

export function applyColors(colors: Settings['colors'] = {}) {
  const root = document.documentElement.style;
  for (const c of COLORS) root.setProperty(`--c-${c.key}`, colors[c.key] ?? c.value);
}

// the demo's settings stay in memory, the ones of this device's mowers are kept as they were
function setLocal(next: Settings) {
  current = next;
  try {
    if (!isDemo()) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  applyColors(next.colors);
  listeners.forEach((l) => l());
}

// for useSyncExternalStore, the prerendered page has no saved settings (serverSnapshot)
export const settingsStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  snapshot: () => load(),
  serverSnapshot: () => NONE,
};

export function sharedSettings() {
  return shared;
}

// the settings as a container has them, and its version of them (null from an older container). a save says which
// version it started from, when another device saved in between the container answers 409 with its settings and the
// change made here goes on top of those (docker/settings.cgi)
interface Kept {
  server: Settings;
  version: string | null;
}
const home: Kept = {server: {}, version: null};
// the mower looked at, in a browser when it's another one than the page's: reached once its settings came
const own: Kept = {server: {}, version: null};
let ownShared = false;

// asked once, everyone asking waits for the same answer. a mower that couldn't be reached (or its container failed) is
// asked again a while later, and what was changed here meanwhile goes on top of what it has
let syncing: Promise<void> | null = null;
// the settings here when it was first asked: what differs from them later was changed on this device
let before: Settings | null = null;
const again = () =>
  setTimeout(() => {
    syncing = null;
    void syncSettings();
  }, 30000);
// a container's settings and their version, null when none answers there (the page isn't served by one)
async function fetchKept(url: string): Promise<Kept | null> {
  const res = await mowerFetch(url, {cache: 'no-store'});
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) {
    // (no container behind it answers that way for good)
    if (res.status >= 500) throw new Error(`settings ${res.status}`);
    return null;
  }
  const data = await res.json();
  return {server: data && typeof data === 'object' ? data : {}, version: res.headers.get('X-Settings-Version') || null};
}
export function syncSettings(): Promise<void> {
  before ??= load();
  syncing ??= (async () => {
    try {
      const got = await fetchKept(homeUrl());
      if (!got) return;
      Object.assign(home, got);
      shared = true;
      const o = ownUrl();
      const gotOwn = o ? await fetchKept(o).catch(() => null) : null;
      if (gotOwn) {
        Object.assign(own, gotOwn);
        ownShared = true;
      }
      // the other mower's own settings as kept here while it can't be reached, it's asked again a while later
      if (o && !gotOwn) again();
      const server = o ? join(home.server, gotOwn ? own.server : load()) : home.server;
      const mine = load();
      if (mine === before) setLocal(server);
      else {
        const next = mergeChanges(server, before ?? {}, mine);
        setLocal(next);
        saving = saving.then(() => pushAll(next)).catch(() => {});
      }
      // what's changed from now on is this device's
      before = load();
    } catch {
      // not reached: kept here for now
      again();
    }
  })();
  return syncing;
}

// what a save sends where: everything home, or with another mower looked at in a browser the app's settings home and
// that mower's own to it. a part that didn't change isn't sent
async function pushAll(next: Settings) {
  const o = ownUrl();
  if (!o) return push(home, homeUrl(), next, (merged) => merged);
  const homeNext = join(next, home.server);
  if (JSON.stringify(homeNext) !== JSON.stringify(home.server)) await push(home, homeUrl(), homeNext, (merged) => join(merged, current ?? {}));
  const ownNext = join(own.server, next);
  if (ownShared && JSON.stringify(ownNext) !== JSON.stringify(own.server)) await push(own, o, ownNext, (merged) => join(current ?? {}, merged));
}

// shown: the settings here once another device's save got put together with this one
async function push(k: Kept, url: string, next: Settings, shown: (merged: Settings) => Settings) {
  for (let tries = 0; tries < 3; tries++) {
    const res = await mowerFetch(url + (k.version ? `?v=${encodeURIComponent(k.version)}` : ''), {
      method: 'POST',
      body: JSON.stringify(next),
    });
    const v = res.headers.get('X-Settings-Version') || null;
    if (res.status !== 409) {
      if (res.ok) [k.server, k.version] = [next, v];
      return;
    }
    const theirs: Settings = await res.json();
    next = mergeChanges(theirs, k.server, next);
    [k.server, k.version] = [theirs, v];
    setLocal(shown(next));
  }
}

// sliders and color pickers fire on every move, only the last state goes to the mower. one save after another
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();
export function saveSettings(next: Settings) {
  setLocal(next);
  if (!shared) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saving = saving.then(() => pushAll(current ?? next)).catch(() => {});
  }, 400);
}

// what's kept for an area's picture by its id: which one, its color, size, direction, folded up and the ground under it
export const LOOK_KEYS = ['looks', 'lookVariants', 'lookSizes', 'lookTurns', 'lookClosed', 'lookGrounds'] as const;
export type LookKey = (typeof LOOK_KEYS)[number];

// what belongs to one mower and its map: its sizes, the pictures of its areas, its leftovers (its container reads them)
// and where its aerial imagery is moved to (imagery's offsets, the rest of imagery is the app's)
export const MOWER_KEYS = ['mower', 'keepRectangle', 'autoOutline', 'leftovers', ...LOOK_KEYS] as const;

// the settings of the app from a, the ones of a mower from b
export function join(a: Settings, b: Settings): Settings {
  const out: Record<string, unknown> = {...a};
  for (const k of MOWER_KEYS) {
    if (b[k] !== undefined) out[k] = b[k];
    else delete out[k];
  }
  const imagery = {...a.imagery, ...(b.imagery?.offsets ? {offsets: b.imagery.offsets} : {})};
  if (!b.imagery?.offsets) delete imagery.offsets;
  if (Object.keys(imagery).length) out.imagery = imagery;
  else delete out.imagery;
  return out as Settings;
}
// what's kept for some areas' pictures, by area id, a setting not there when there's none
export type KeptLooks = Record<string, {[K in LookKey]?: NonNullable<Settings[K]>[string]}>;

// what's kept for these areas' pictures, to put back later with withLooks
export function looksOf(s: Settings, ids: readonly string[]): KeptLooks {
  const of = (id: string) => Object.fromEntries(LOOK_KEYS.flatMap((k) => (s[k]?.[id] !== undefined ? [[k, s[k]?.[id]]] : [])));
  return Object.fromEntries(ids.map((id) => [id, of(id)]));
}

// the settings with these areas' pictures as kept, a setting that wasn't there taken out. the same settings when
// nothing changes. one emptied stays {}, another device's saved meanwhile is put together with it by area id
export function withLooks(s: Settings, kept: KeptLooks): Settings {
  let out = s;
  for (const k of LOOK_KEYS) {
    let next: Record<string, unknown> | undefined;
    for (const [id, was] of Object.entries(kept)) {
      if (s[k]?.[id] === was[k]) continue;
      next ??= {...s[k]};
      if (was[k] === undefined) delete next[id];
      else next[id] = was[k];
    }
    if (next) out = {...out, [k]: next};
  }
  return out;
}

// the settings with nothing kept for these areas' pictures
export const withoutLooks = (s: Settings, ids: readonly string[]) => withLooks(s, Object.fromEntries(ids.map((id) => [id, {}])));

// these areas' pictures back as kept (looksOf), saved only when that changes anything
export function restoreLooks(kept: KeptLooks) {
  const now = load();
  const next = withLooks(now, kept);
  if (next !== now) saveSettings(next);
}

// what's kept for these areas' pictures taken out (areas deleted), saved only when there was any
export function dropLooks(ids: readonly string[]) {
  const now = load();
  const next = withoutLooks(now, ids);
  if (next !== now) saveSettings(next);
}

// inline in <head>: sets the color variables before anything is drawn, so saved colors don't flash
export const COLOR_BOOT_SCRIPT = `try{var s=JSON.parse(localStorage.getItem('${STORAGE_KEY}')||'null'),c=(s&&s.colors)||JSON.parse(localStorage.getItem('mapColors')||'{}'),d=${JSON.stringify(
  Object.fromEntries(COLORS.map((c) => [c.key, c.value])),
)};for(var k in d)document.documentElement.style.setProperty('--c-'+k,c[k]||d[k])}catch(e){}`;
