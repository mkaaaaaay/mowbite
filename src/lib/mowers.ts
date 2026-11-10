import {leaveFirst} from './leaving';
import {isApp} from './native';
import {settingsStore, type OtherMower} from './settings';

// which mower this device looks at: '' is the one the app is served from. switching reloads the
// app, so every connection, cache and page starts clean on the other mower
const KEY = 'mower';
// in the app the list is kept on the phone, there is no mower of its own to keep it on
const APP_KEY = 'appMowers';
// a mower made up inside the app (lib/demo), to look around without one
export const DEMO_ID = 'demo';
const DEMO: OtherMower = {id: DEMO_ID, name: 'Demo', host: ''};
export const isDemo = () => typeof window !== 'undefined' && selectedMowerId() === DEMO_ID;

// a host as it can be typed: a name, an IPv4 address or an IPv6 one in brackets
const HOST = /^(?:[a-z0-9_-]+(?:\.[a-z0-9_-]+)*|\[[0-9a-f.]*:[0-9a-f:.]*\])$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

// a mower's address as typed: the host, and MowBite's port when one is typed after it (http:// and a path left out).
// null when it isn't an address
export function parseAddress(input: string): {host: string; port: number | null} | null {
  const m = /^(?:https?:\/\/)?(\[[^\]]*\]|[^/:]*)(?::(\d{1,5}))?/i.exec(input.trim());
  const host = (m?.[1] ?? '').toLowerCase();
  // (only digits and dots is an IPv4 address)
  const ip = /^[\d.]+$/.test(host);
  if (!HOST.test(host) || (ip && !(IPV4.test(host) && host.split('.').every((n) => Number(n) < 256)))) return null;
  const port = Number(m?.[2]);
  return {host, port: port > 0 && port < 65536 ? port : null};
}

export function appMowers(): OtherMower[] {
  try {
    return JSON.parse(localStorage.getItem(APP_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveAppMowers(list: OtherMower[]) {
  try {
    localStorage.setItem(APP_KEY, JSON.stringify(list));
  } catch {}
}

// the mowers there are to switch to: the phone's list in the app, the shared one on a mower
export function mowerList(): OtherMower[] {
  return isApp() ? appMowers() : (settingsStore.snapshot().mowers ?? []);
}

// the mower this page looks at, taken at its first use and kept until the page reloads: another tab picking another one
// or leaving the demo doesn't move it. its entry is taken on its own, it needs the list (in a browser from the settings)
let viewedId: string | null = null;
let viewed: OtherMower | null | undefined;

export function selectedMowerId(): string {
  try {
    return (viewedId ??= localStorage.getItem(KEY) ?? '');
  } catch {
    return '';
  }
}

export function selectedMower(): OtherMower | null {
  if (viewed === undefined) viewed = lookedAt();
  return viewed;
}

function lookedAt(): OtherMower | null {
  const id = selectedMowerId();
  if (id === DEMO_ID) return DEMO;
  const list = mowerList();
  // the app always talks to one of its mowers, the first one if none is picked
  if (isApp()) return list.find((m) => m.id === id) ?? list[0] ?? null;
  return id ? (list.find((m) => m.id === id) ?? null) : null;
}

export function selectMower(id: string) {
  // something unsaved asks first, and only then the choice is written: until the reload everything still talks to this one
  const wait = leaveFirst();
  if (wait === false) return;
  setTimeout(() => {
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {}
    window.location.reload();
  }, wait);
}

// a browser whose mower was taken out of the list (on another device too) goes back to the one the page comes from
export function leaveRemoved() {
  const id = selectedMowerId();
  if (!isApp() && id && id !== DEMO_ID && !mowerList().some((m) => m.id === id)) selectMower('');
}

// a key in this device's storage for what's kept for the mower looked at, the key alone for the one the page comes from
export function mowerKey(key: string): string {
  const id = selectedMower()?.id;
  return id ? `${key} ${id}` : key;
}

// json kept in this device's storage, null when there's none or it can't be read
export function readStored<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

// null takes it out
export function writeStored(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// the same for what's kept for the mower looked at (mowerKey)
export const readMower = <T>(key: string) => readStored<T>(mowerKey(key));
export const writeMower = (key: string, value: unknown) => writeStored(mowerKey(key), value);

// where a mower's MowBite answers
export const mowerBase = (m: Pick<OtherMower, 'host' | 'appPort'>) => `http://${m.host}:${m.appPort ?? 8082}`;
// the same MowBite: the same host and port
export const sameMowBite = (a: Pick<OtherMower, 'host' | 'appPort'>, b: Pick<OtherMower, 'host' | 'appPort'>) =>
  mowerBase(a).toLowerCase() === mowerBase(b).toLowerCase();

// where the selected mower's MowBite answers (sensor history, backups, schedule)
export function apiBase(): string {
  if (typeof window === 'undefined') return '';
  const m = selectedMower();
  return m && m.id !== DEMO_ID ? mowerBase(m) : '';
}

// a request to the selected mower's MowBite, the demo mower answers it itself
export async function mowerFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isDemo()) return (await import('./demo/api')).demoFetch(url, init);
  return fetch(url, init);
}
