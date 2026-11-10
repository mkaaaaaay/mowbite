import {useSyncExternalStore} from 'react';
import {tr} from './i18n';
import {guardLeaving} from './leaving';

// unsaved changes in the map editor. they're kept while the app runs, so another tab and back loses
// nothing: the map tab shows a dot, and reloading, closing or switching mowers asks first
let unsaved = false;
const listeners = new Set<() => void>();

export function setUnsavedMap(v: boolean) {
  if (v === unsaved) return;
  unsaved = v;
  guardLeaving('map', v ? {text: () => tr("Switching mowers loses the map changes that aren't saved yet.")} : null);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useUnsavedMap(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => unsaved,
    () => false,
  );
}
