// app settings (map colors, icons). shared through the mower when the app runs from the docker image
// (docker/settings.cgi), otherwise per device. localStorage is also the cache so they're there
// before the request comes back.

export const COLORS = [
  {key: 'mower', label: 'Mower', value: '#ff1fa3'},
  {key: 'dock', label: 'Docking station', value: '#2196f3'},
  {key: 'track', label: 'Track', value: '#ff1fa3'},
  {key: 'transit', label: 'Driving without blades', value: '#ff1fa3'},
  {key: 'mow', label: 'Mowing area', value: '#4caf50'},
  {key: 'nav', label: 'Navigation area', value: '#29b6f6'},
  {key: 'obstacle', label: 'Obstacle', value: '#ef5350'},
  {key: 'draft', label: 'Draft', value: '#888888'},
  {key: 'selected', label: 'Selected area', value: '#ff1fa3'},
  {key: 'vertex', label: 'Outline points', value: '#2196f3'},
  {key: 'stripes', label: 'Mowing direction', value: '#ff1fa3'},
] as const;

export type ColorKey = (typeof COLORS)[number]['key'];

export interface Settings {
  colors?: Partial<Record<ColorKey, string>>;
  // sizes are factors, 1 = default
  icons?: {mower?: string; dock?: string; mowerSize?: number; dockSize?: number; mowerRealSize?: boolean};
  // map on the dashboard: only while driving (default) or always
  dashboard?: {map?: 'auto' | 'always'};
  // own aerial imagery source, xyz tile url
  imagery?: {url?: string; attribution?: string};
}

const STORAGE_KEY = 'appSettings';
const SETTINGS_URL = '/cgi-bin/settings';

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

function setLocal(next: Settings) {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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

let synced = false;
export async function syncSettings() {
  if (synced) return;
  synced = true;
  try {
    const res = await fetch(SETTINGS_URL, {cache: 'no-store'});
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return;
    const data = await res.json();
    shared = true;
    setLocal(data && typeof data === 'object' ? data : {});
  } catch {
    // not served by the container, keep it local
  }
}

// sliders and color pickers fire on every move, only the last state goes to the mower
let saveTimer: ReturnType<typeof setTimeout> | undefined;
export function saveSettings(next: Settings) {
  setLocal(next);
  if (!shared) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void fetch(SETTINGS_URL, {method: 'POST', body: JSON.stringify(next)}).catch(() => {}), 400);
}

// inline in <head>: sets the color variables before anything is drawn, so saved colors don't flash
export const COLOR_BOOT_SCRIPT = `try{var s=JSON.parse(localStorage.getItem('${STORAGE_KEY}')||'null'),c=(s&&s.colors)||JSON.parse(localStorage.getItem('mapColors')||'{}'),d=${JSON.stringify(
  Object.fromEntries(COLORS.map((c) => [c.key, c.value])),
)};for(var k in d)document.documentElement.style.setProperty('--c-'+k,c[k]||d[k])}catch(e){}`;
