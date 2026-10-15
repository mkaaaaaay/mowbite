import {useEffect, useSyncExternalStore} from 'react';
import FEATURES from './containerFeatures.json';
import {apiBase, mowerFetch} from './mowers';

// Looks on github for a newer release. Off by default (it tells github your ip), switched on per
// device in the settings, then once a day. "check now" works either way.

const REPO = 'mkaaaaaay/mowbite';
const ENABLED_KEY = 'updateCheck';
const INFO_KEY = 'updateInfo';
const DISMISSED_KEY = 'updateDismissed';
const BEHIND_KEY = 'mowerBehindDismissed';
const BEHIND_NEVER_KEY = 'mowerBehindNever';
const DAY = 24 * 3600e3;

export const APP_VERSION = process.env.APP_VERSION ?? '0.0.0';
// built for google play (STORE=play): the store updates the app there, no word about a newer apk
export const FROM_STORE = process.env.APP_STORE === 'play';

export interface Release {
  version: string;
  url: string; // release page
  apk?: string;
}

// -1 when a is older than b. a pre-release (1.1.0-dev.3) comes before its release (1.1.0)
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, '').split('-', 2);
    return {nums: core.split('.').map((n) => Number(n) || 0), pre};
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre && !y.pre) return -1;
  if (!x.pre && y.pre) return 1;
  if (x.pre && y.pre) return x.pre.localeCompare(y.pre, undefined, {numeric: true});
  return 0;
}

export const isNewer = (release: string, current: string) => compareVersions(release, current) > 0;

// what MowBite's container on the mower has from which level on (its version.json, scripts/version.mjs). with an older
// one the app tells what doesn't work yet: a new entry, one level up, for each change there the app relies on
export const CONTAINER_LEVEL = Math.max(0, ...FEATURES.map((f) => f.level));

// whether the container has it, false while its level is unknown
export function containerHas(level: number | null, key: string): boolean {
  const f = FEATURES.find((x) => x.key === key);
  return !!f && level !== null && level >= f.level;
}

// what the app knows and the container doesn't have yet, nothing while unknown
export const missingOnMower = (level: number | null): string[] =>
  level === null ? [] : FEATURES.filter((f) => f.level > level).map((f) => f.what);

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

interface State {
  enabled: boolean;
  latest: Release | null;
  checkedAt: number | null;
  checking: boolean;
  failed: boolean;
  dismissed: string | null;
  // the version the mower's container runs, when known
  mower: string | null;
  // and its level, 0 for one from before there were levels
  level: number | null;
  // the dashboard's note about an older container was waved away: its version and the level the app knew
  behindDismissed: string | null;
  // or isn't wanted at all on this device
  behindNever: boolean;
}

const EMPTY: State = {
  enabled: false,
  latest: null,
  checkedAt: null,
  checking: false,
  failed: false,
  dismissed: null,
  mower: null,
  level: null,
  behindDismissed: null,
  behindNever: false,
};
let state: State | null = null;
const listeners = new Set<() => void>();

function current(): State {
  if (!state) {
    const info = read<{latest: Release; at: number}>(INFO_KEY);
    state = {
      ...EMPTY,
      enabled: read<boolean>(ENABLED_KEY) === true,
      latest: info?.latest ?? null,
      checkedAt: info?.at ?? null,
      dismissed: read<string>(DISMISSED_KEY),
      behindDismissed: read<string>(BEHIND_KEY),
      behindNever: read<boolean>(BEHIND_NEVER_KEY) === true,
    };
  }
  return state;
}

function set(patch: Partial<State>) {
  state = {...current(), ...patch};
  listeners.forEach((l) => l());
}

export async function checkNow(): Promise<void> {
  set({checking: true, failed: false});
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {cache: 'no-store'});
    if (!res.ok) throw new Error(String(res.status));
    const r = (await res.json()) as {tag_name: string; html_url: string; assets?: {name: string; browser_download_url: string}[]};
    const latest: Release = {
      version: r.tag_name.replace(/^v/, ''),
      url: r.html_url,
      apk: r.assets?.find((a) => a.name.endsWith('.apk'))?.browser_download_url,
    };
    const at = Date.now();
    write(INFO_KEY, {latest, at});
    set({latest, checkedAt: at, checking: false});
  } catch {
    set({checking: false, failed: true});
  }
}

export function setUpdateCheck(on: boolean) {
  write(ENABLED_KEY, on || null);
  set({enabled: on});
  if (on) void checkNow();
}

export function dismissUpdate(version: string) {
  write(DISMISSED_KEY, version);
  set({dismissed: version});
}

// the note stays away until the container or what the app relies on changes
export const behindKey = (mower: string | null) => `${mower} ${CONTAINER_LEVEL}`;

export function dismissBehind(key: string) {
  write(BEHIND_KEY, key);
  set({behindDismissed: key});
}

export function setBehindNote(on: boolean) {
  write(BEHIND_NEVER_KEY, on ? null : true);
  set({behindNever: !on});
}

type Version = {version?: string; level?: number};

// the mower's version once, asked again next time when it didn't answer. the app runs on another origin and can't read
// version.json, the cgi allows it. a container from before that cgi still answers the system one: older, level 0
let asked: Promise<void> | null = null;
function askMower(): Promise<void> {
  const base = apiBase();
  const version = () =>
    mowerFetch(`${base}/cgi-bin/version`, {cache: 'no-store'})
      .then((res) => (res.ok ? (res.json() as Promise<Version>) : null))
      .catch(() => null);
  asked ??= (async () => {
    let v = await version();
    if (!v) {
      const res = await mowerFetch(`${base}/cgi-bin/system`, {cache: 'no-store'});
      if (!res.ok) throw new Error(String(res.status));
      // once more, the first one may have got lost on the way
      v = (await version()) ?? {};
    }
    set({mower: v.version ?? null, level: v.level ?? 0});
  })().catch(() => {
    asked = null;
  });
  return asked;
}

// whether the mower's container has it (containerFeatures.json), false when it can't tell
export async function mowerHas(key: string): Promise<boolean> {
  await askMower();
  return containerHas(current().level, key);
}

let started = false;

// the update state, starts the daily check (if switched on) and asks the mower for its version
export function useUpdates(): State {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    current,
    () => EMPTY,
  );
  useEffect(() => {
    void askMower();
    if (started) return;
    started = true;
    const c = current();
    if (c.enabled && (!c.checkedAt || Date.now() - c.checkedAt > DAY)) void checkNow();
  }, []);
  return s;
}
