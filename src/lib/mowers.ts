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

export function selectedMowerId(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function selectedMower(): OtherMower | null {
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

// where the selected mower's MowBite answers (sensor history, backups, schedule)
export function apiBase(): string {
  if (typeof window === 'undefined') return '';
  const m = selectedMower();
  return m && m.id !== DEMO_ID ? `http://${m.host}:${m.appPort ?? 8082}` : '';
}

// a request to the selected mower's MowBite, the demo mower answers it itself
export async function mowerFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isDemo()) return (await import('./demo/api')).demoFetch(url, init);
  return fetch(url, init);
}
