import {plannerEstimate, type PlannerEstimate, type PlannerEstimateInput} from './plannerEstimate';

// works the estimate out off the page's thread: the map stays smooth while it takes a moment (a phone, a big area).
// The loops only change with the area, not with the angle: the same ones as last time aren't sent again (sameLoops)
let lastLoops: PlannerEstimate['loops'] | null = null;

self.onmessage = (e: MessageEvent<{id: number; input: PlannerEstimateInput}>) => {
  let result: PlannerEstimate | null = null;
  try {
    result = plannerEstimate(e.data.input);
  } catch {
    // a broken outline: no estimate
  }
  const same = !!result && result.loops === lastLoops;
  if (result) lastLoops = result.loops;
  self.postMessage({id: e.data.id, result: same && result ? {...result, loops: []} : result, sameLoops: same});
};
