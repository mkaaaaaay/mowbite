import {useSyncExternalStore} from 'react';
import {apiBase} from './mowers';
import {themeChoice} from './theme';

// a port on the mower the app talks to: dockge (OpenMowerOS has it on 5001), the MowBite Updater's page (8083)
const onMower = (port: number) => {
  const base = apiBase();
  return `http://${base ? new URL(base).hostname : window.location.hostname}:${port}`;
};
export const dockgeUrl = () => onMower(5001);
export const updaterPageUrl = () => onMower(8083);
// its link carries the design picked here, so its page looks the same
const updaterPageLink = () => `${updaterPageUrl()}/?theme=${themeChoice()}`;

const noop = () => () => {};
// in the page: only in the browser, the page built ahead has no mower to point to
export const useDockgeUrl = () => useSyncExternalStore(noop, dockgeUrl, () => '');
export const useUpdaterPageUrl = () => useSyncExternalStore(noop, updaterPageUrl, () => '');
export const useUpdaterPageLink = () => useSyncExternalStore(noop, updaterPageLink, () => '');
