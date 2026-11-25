'use client';

import {answerTo, loadUpdate} from '@/lib/autoUpdate';
import {useEffect, useRef, useState} from 'react';

// the updater's status every few seconds while active, more often while the request asked (its line before) has no
// answer; status null without an updater, loaded once it answered
export function useUpdaterStatus(key: 'calib' | 'sound', asked: string | null, active = true) {
  const [status, setStatus] = useState<Record<string, string> | null>();
  const [tick, setTick] = useState(0);
  const last = useRef(0);
  const answer = answerTo(status?.[key], asked);
  const fast = asked !== null && !(answer && answer.what !== 'waiting');
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const t = setTimeout(
      () =>
        void loadUpdate()
          .then((s) => !stop && setStatus(s?.status ?? null))
          .catch(() => {})
          .finally(() => {
            last.current = Date.now();
            if (!stop) setTick((n) => n + 1);
          }),
      Math.max(0, last.current + (fast ? 3000 : 10000) - Date.now()),
    );
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [tick, fast, active]);
  // again: asked right away, then on the usual interval
  const again = () => {
    last.current = 0;
    setTick((n) => n + 1);
  };
  return {status: status ?? null, loaded: status !== undefined, again};
}
