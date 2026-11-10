'use client';

import {useEffect, useRef, useState} from 'react';
import {plannerEstimate, type PlannerEstimate, type PlannerEstimateInput} from './plannerEstimate';

// The planner's estimate for the input, worked out in a worker (the newest input next, the ones in between left out)
// or right here where there's no worker. What it was worked out for comes along: an older answer while the newest
// is on its way, for the caller to decide whether that still fits.
export function usePlannerEstimate(input: PlannerEstimateInput | null): {input: PlannerEstimateInput; estimate: PlannerEstimate | null} | null {
  const [answer, setAnswer] = useState<{input: PlannerEstimateInput; estimate: PlannerEstimate | null} | null>(null);
  const worker = useRef<Worker | null | undefined>(undefined);
  const busy = useRef<{id: number; input: PlannerEstimateInput} | null>(null);
  const waiting = useRef<PlannerEstimateInput | null>(null);
  const count = useRef(0);
  const loops = useRef<PlannerEstimate['loops'] | null>(null);

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = undefined;
    },
    [],
  );

  useEffect(() => {
    if (!input) return;
    if (worker.current === undefined) {
      try {
        worker.current = new Worker(new URL('./plannerEstimate.worker.ts', import.meta.url));
        worker.current.onmessage = (e: MessageEvent<{id: number; result: PlannerEstimate | null; sameLoops?: boolean}>) => {
          const done = busy.current;
          busy.current = null;
          let estimate = e.data.result;
          // the loops as before (the worker sends them once per area)
          if (estimate && e.data.sameLoops && loops.current) estimate = {...estimate, loops: loops.current};
          if (estimate) loops.current = estimate.loops;
          if (done && done.id === e.data.id) setAnswer({input: done.input, estimate});
          const queued = waiting.current;
          waiting.current = null;
          if (queued) post(queued);
        };
        worker.current.onerror = () => {
          // no worker after all: right here from now on
          worker.current?.terminate();
          worker.current = null;
          const lost = busy.current?.input ?? waiting.current;
          busy.current = null;
          waiting.current = null;
          if (lost) setAnswer({input: lost, estimate: plannerEstimate(lost)});
        };
      } catch {
        worker.current = null;
      }
    }
    function post(next: PlannerEstimateInput) {
      if (!worker.current) return;
      busy.current = {id: ++count.current, input: next};
      worker.current.postMessage(busy.current);
    }
    if (!worker.current) {
      setAnswer({input, estimate: plannerEstimate(input)});
      return;
    }
    if (busy.current) waiting.current = input;
    else post(input);
  }, [input]);

  return answer;
}
