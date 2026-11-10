import {useCallback, useSyncExternalStore} from 'react';

// whether a media query matches, following it as it changes (false in the page built ahead)
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (on: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', on);
      return () => m.removeEventListener('change', on);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
