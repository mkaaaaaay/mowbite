import {useSyncExternalStore} from 'react';
import {THEME_KEY as KEY} from './themeBoot';

// the design per device, frost unless picked otherwise. 'auto' follows the device, the css reads data-theme on <html>.
// frost is dark with milky glass cards, aurora goes from violet to petrol, lighter than frost and darker than light,
// sunny a summer sky over a meadow, openmower nearly black with OpenMower's green like its website
export type ThemeChoice = 'auto' | 'light' | 'dark' | 'frost' | 'aurora' | 'sunny' | 'openmower';

const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'auto' || v === 'dark' || v === 'frost' || v === 'aurora' || v === 'sunny' || v === 'openmower') return v;
  } catch {}
  return 'frost';
}

let choice: ThemeChoice | null = null;
// the design picked on this device (the updater's page takes it over with its link)
export const themeChoice = () => (choice ??= read());

export function setThemeChoice(c: ThemeChoice) {
  choice = c;
  try {
    localStorage.setItem(KEY, c);
  } catch {}
  if (c === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = c;
  listeners.forEach((l) => l());
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (choice ??= read()),
    () => 'frost',
  );
}
