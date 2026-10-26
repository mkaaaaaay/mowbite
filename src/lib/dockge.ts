import {useSyncExternalStore} from 'react';
import {apiBase} from './mowers';

// dockge on the mower the app talks to (OpenMowerOS has it on port 5001)
export function dockgeUrl(): string {
  const base = apiBase();
  return `http://${base ? new URL(base).hostname : window.location.hostname}:5001`;
}

const noop = () => () => {};
// in the page: only in the browser, the page built ahead has no mower to point to
export const useDockgeUrl = () => useSyncExternalStore(noop, dockgeUrl, () => '');
