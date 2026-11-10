import {useEffect, useSyncExternalStore} from 'react';
import FEATURES from './containerFeatures.json';
import {apiBase, mowerFetch, readMower, readStored, writeMower, writeStored} from './mowers';
import {isMowbiteOs, systemInfo} from './mowerOs';
import {isApp} from './native';

// Looks on github for a newer release, only when "Check now" is tapped (it tells github your ip).

const REPO = 'mkaaaaaay/mowbite';
const INFO_KEY = 'updateInfo';
const DISMISSED_KEY = 'updateDismissed';
const BEHIND_KEY = 'mowerBehindDismissed';

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
    const s = v.replace(/^v/, '');
    const dash = s.indexOf('-');
    // all after the first dash, a dev build's suffix too (1.4.0-beta.19-dev.42)
    const pre = dash < 0 ? undefined : s.slice(dash + 1);
    return {nums: (dash < 0 ? s : s.slice(0, dash)).split('.').map((n) => Number(n) || 0), pre};
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

interface State {
  latest: Release | null;
  checking: boolean;
  failed: boolean;
  dismissed: string | null;
  // the version the mower's container runs, when known
  mower: string | null;
  // and its level, 0 for one from before there were levels
  level: number | null;
  // the dashboard's note about an older container was waved away: its version and the level the app knew
  behindDismissed: string | null;
  // there's no MowBite container on this mower (askMower), nothing asks its cgi-bin then
  none: boolean;
}

const EMPTY: State = {
  latest: null,
  checking: false,
  failed: false,
  dismissed: null,
  mower: null,
  level: null,
  behindDismissed: null,
  none: false,
};
let state: State | null = null;
const listeners = new Set<() => void>();

function current(): State {
  if (!state) {
    const info = readStored<{latest: Release}>(INFO_KEY);
    state = {
      ...EMPTY,
      latest: info?.latest ?? null,
      dismissed: readStored<string>(DISMISSED_KEY),
      behindDismissed: readMower<string>(BEHIND_KEY),
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
    writeStored(INFO_KEY, {latest});
    set({latest, checking: false});
  } catch {
    set({checking: false, failed: true});
  }
}

export function dismissUpdate(version: string) {
  writeStored(DISMISSED_KEY, version);
  set({dismissed: version});
}

// the note stays away until the container or what the app relies on changes
export const behindKey = (mower: string | null) => `${mower} ${CONTAINER_LEVEL}`;

export function dismissBehind(key: string) {
  writeMower(BEHIND_KEY, key);
  set({behindDismissed: key});
}

type Version = {version?: string; level?: number};

// the mower's version once, asked again next time when it didn't answer. the app runs on another origin and can't read
// version.json, the cgi allows it. a container from before that cgi still answers the system one: older, level 0.
// 404 on both is no container for good where the mower runs MowBite OS or the page came from that server itself
// (masterplan 3.5 (4)), on OpenMower otherwise it stays unknown and is asked again
let asked: Promise<void> | null = null;
// 404 on both from another mower that runs OpenMower: another 404 doesn't tell more, containerFetch leaves it
let openMower404 = false;
const askVersion = (base: string) =>
  mowerFetch(`${base}/cgi-bin/version`, {cache: 'no-store'})
    .then(async (res) => ({v: res.ok ? ((await res.json()) as Version) : null, status: res.status}))
    .catch(() => ({v: null, status: 0}));
const versionAt = (base: string) => askVersion(base).then((a) => a.v);
function askMower(): Promise<void> {
  const base = apiBase();
  asked ??= (async () => {
    const first = await askVersion(base);
    let v = first.v;
    if (!v) {
      const res = await mowerFetch(`${base}/cgi-bin/system`, {cache: 'no-store'});
      if (!res.ok) {
        if (first.status === 404 && res.status === 404) {
          const own = !base && !isApp();
          const info = own ? null : await systemInfo();
          if (own || isMowbiteOs(info)) return set({none: true});
          openMower404 = info === null;
        }
        throw new Error(String(res.status));
      }
      // once more, the first one may have got lost on the way
      v = (await versionAt(base)) ?? {};
    }
    set({mower: v.version ?? null, level: v.level ?? 0});
  })().catch(() => {
    asked = null;
  });
  return asked;
}

// a request to the container's cgi-bin, null once it's clear there's none (askMower): what asks every so often stops
// then. a 404 has askMower clear that up
export async function containerFetch(url: string, init?: RequestInit): Promise<Response | null> {
  if (current().none) return null;
  const res = await mowerFetch(url, init);
  if (res.status === 404 && !openMower404) void askMower();
  return res;
}

// whether the mower's container has it (containerFeatures.json), false when it can't tell
export async function mowerHas(key: string): Promise<boolean> {
  await askMower();
  return containerHas(current().level, key);
}

// whether the container of the mower at base has it, false when it can't tell (an older one, out of reach)
export async function mowerAtHas(base: string, key: string): Promise<boolean> {
  if (base === apiBase()) return mowerHas(key);
  const v = await versionAt(base);
  return containerHas(v ? (v.level ?? 0) : null, key);
}

// the update state, asks the mower for its version. GitHub only when "Check now" is tapped
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
  }, []);
  return s;
}
