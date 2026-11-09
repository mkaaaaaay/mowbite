// app settings (map colors, icons). shared through the mower when the app runs from the docker image
// (docker/settings.cgi), otherwise per device. localStorage is also the cache so they're there
// before the request comes back: the app's under STORAGE_KEY, each mower's own under its id (in a browser MOWER_KEYS,
// in the android app all of them), so a mower without a container keeps its own on this device.

import type {GardenLife} from '@/components/gardenLife';
import {mergeChanges} from './mergeChanges';
import {apiBase, isDemo, leaveRemoved, mowerFetch, selectedMower, selectedMowerId} from './mowers';
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
  // map on the dashboard: only while driving (default) or always; hidden: what the status card leaves out (lib/dashboard)
  dashboard?: {map?: 'auto' | 'always'; hidden?: string[]};
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
// both taken at the first sync and kept until the reload a mower switch makes, a mower taken out of the list meanwhile
// doesn't move them
let urls: {home: string; own: string | null} | null = null;
const target = () => (urls ??= {home: (isApp() ? apiBase() : '') + PATH, own: !isApp() && apiBase() ? apiBase() + PATH : null});
const homeUrl = () => target().home;
const ownUrl = () => target().own;

const NONE: Settings = {};
let current: Settings | null = null;
let shared = false;
const listeners = new Set<() => void>();

// where this device keeps the own settings of the mower looked at, by its id ('' the one the page comes from), taken
// once like the urls
let ownKey: string | null = null;
const ownStorageKey = () => (ownKey ??= `${STORAGE_KEY}:${isApp() ? (selectedMower()?.id ?? '') : selectedMowerId()}`);

function read(key: string): Settings | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// what of the settings is kept by the mower's id: in the app everything is the mower's
const ownPart = (s: Settings) => (isApp() ? s : join({}, s));

function load(): Settings {
  if (current) return current;
  const app = read(STORAGE_KEY) ?? {};
  // a mower with nothing of its own kept yet starts from the app's, with what's the mower's there when it's from before
  // mowers had their own (the first one looked at after the update), else with the defaults for that
  const own = read(ownStorageKey()) ?? app;
  current = isApp() ? own : join(app, own);
  return current;
}

export function applyColors(colors: Settings['colors'] = {}) {
  const root = document.documentElement.style;
  for (const c of COLORS) root.setProperty(`--c-${c.key}`, colors[c.key] ?? c.value);
}

// the demo's settings stay in memory, the ones of this device's mowers are kept as they were
function setLocal(next: Settings) {
  current = next;
  try {
    if (!isDemo()) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(join(next, {})));
      localStorage.setItem(ownStorageKey(), JSON.stringify(ownPart(next)));
    }
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
  // a file that isn't json any more (two saves at once in an older container) counts as empty, the next save mends it
  const data = await res.json().catch(() => ({}));
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
      void saving.then(leaveRemoved);
    } catch {
      // not reached: kept here for now
      again();
    }
  })();
  return syncing;
}

// settings as text with their keys in order, the same for the same settings put together in another order (join)
const sorted = (s: Settings) =>
  JSON.stringify(s, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

// what a save sends where: everything home, or with another mower looked at in a browser the app's settings home and
// that mower's own to it. a part that didn't change isn't sent
async function pushAll(next: Settings) {
  const o = ownUrl();
  if (!o) return push(home, homeUrl(), () => current ?? next, (merged) => merged);
  const homeOf = () => join(current ?? next, home.server);
  if (sorted(homeOf()) !== sorted(home.server)) await push(home, homeUrl(), homeOf, (merged) => join(merged, current ?? {}));
  const ownOf = () => join(own.server, current ?? next);
  if (ownShared && sorted(ownOf()) !== sorted(own.server)) await push(own, o, ownOf, (merged) => join(current ?? {}, merged));
}

// body: what goes there as the settings here are now, a change made while a save was on its way included. shown: the
// settings here once another device's save got put together with these
async function push(k: Kept, url: string, body: () => Settings, shown: (merged: Settings) => Settings) {
  let next = body();
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
    next = mergeChanges(theirs, k.server, body());
    [k.server, k.version] = [theirs, v];
    setLocal(shown(next));
  }
}

// sliders and color pickers fire on every move, only the last state goes to the mower. one save after another
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();
const pushNow = () => {
  saveTimer = undefined;
  saving = saving.then(() => pushAll(load())).catch(() => {});
};
export function saveSettings(next: Settings) {
  setLocal(next);
  if (!shared) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(pushNow, 400);
}

// a save still waiting goes out now, done once it's there (before a reload)
export function flushSettings(): Promise<void> {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    pushNow();
  }
  return saving;
}

// what's kept for an area's picture by its id: which one, its color, size, direction, folded up and the ground under it
export const LOOK_KEYS = ['looks', 'lookVariants', 'lookSizes', 'lookTurns', 'lookClosed', 'lookGrounds'] as const;
export type LookKey = (typeof LOOK_KEYS)[number];

// what belongs to one mower and its map: its sizes, its and its dock's icons, how its map is drawn and the pictures of
// its areas, its leftovers (its container reads them)
export const MOWER_KEYS = ['mower', 'icons', 'keepRectangle', 'autoOutline', 'leftovers', 'mapStyle', 'garden', ...LOOK_KEYS] as const;
// a mower's part of an app's setting: where its aerial imagery is moved to and the values its dashboard leaves out
const MOWER_PARTS = [
  ['imagery', 'offsets'],
  ['dashboard', 'hidden'],
] as const;

// the settings of the app from a, the ones of a mower from b
export function join(a: Settings, b: Settings): Settings {
  const out: Record<string, unknown> = {...a};
  for (const k of MOWER_KEYS) {
    if (b[k] !== undefined) out[k] = b[k];
    else delete out[k];
  }
  for (const [k, part] of MOWER_PARTS) {
    const mine = (b[k] as Record<string, unknown> | undefined)?.[part];
    const v: Record<string, unknown> = {...a[k]};
    if (mine !== undefined) v[part] = mine;
    else delete v[part];
    if (Object.keys(v).length) out[k] = v;
    else delete out[k];
  }
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
export const COLOR_BOOT_SCRIPT = `try{var s=JSON.parse(localStorage.getItem('${STORAGE_KEY}')||'null'),c=(s&&s.colors)||{},d=${JSON.stringify(
  Object.fromEntries(COLORS.map((c) => [c.key, c.value])),
)};for(var k in d)document.documentElement.style.setProperty('--c-'+k,c[k]||d[k])}catch(e){}`;
