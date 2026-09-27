import {settingsStore, type OtherMower} from './settings';

// which mower this device looks at: '' is the one the app is served from. switching reloads the
// app, so every connection, cache and page starts clean on the other mower
const KEY = 'mower';

export function selectedMowerId(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function selectedMower(): OtherMower | null {
  const id = selectedMowerId();
  return id ? (settingsStore.snapshot().mowers?.find((m) => m.id === id) ?? null) : null;
}

export function selectMower(id: string) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {}
  window.location.reload();
}

// where the selected mower's MowBite answers (sensor history, backups, schedule)
export function apiBase(): string {
  if (typeof window === 'undefined') return '';
  const m = selectedMower();
  return m ? `http://${m.host}:${m.appPort ?? 8082}` : '';
}
