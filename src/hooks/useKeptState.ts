'use client';

import {useCallback, useRef, useState, type SetStateAction} from 'react';

// like useState, but the value outlives the page while the app runs (until a reload), e.g. edits that
// shouldn't be gone after a look at another tab. kept as it's set, also when the page is gone by then (a save that
// ends after a tap on another tab)
const kept = new Map<string, unknown>();

export function useKeptState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => (kept.has(key) ? (kept.get(key) as T) : initial));
  const first = useRef(initial);
  const set = useCallback(
    (next: SetStateAction<T>) => {
      const prev = (kept.has(key) ? kept.get(key) : first.current) as T;
      const v = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
      kept.set(key, v);
      setValue(v);
    },
    [key],
  );
  return [value, set] as const;
}
