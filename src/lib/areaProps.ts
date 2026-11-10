import {useEffect, useState} from 'react';
import {RPC} from './openmower';
import {askUntilAnswered, callRpc, methodsUnknown, rpcMethods} from './rpc';

// The area settings the mower keeps in its map (map.area_properties), newer ones are only offered when it does.
// Mowers without that rpc can't tell: one with mowing.plan knows mowable too (merged the same night), older ones none
// of the new settings, and with the MowBite Planner the ones it reads from the map itself.
let known: Promise<Set<string>> | null = null;

export function areaProperties(): Promise<Set<string>> {
  known ??= (async () => {
    const methods = await rpcMethods();
    // no answer yet, the next one asking tries again
    if (methodsUnknown()) known = null;
    if (methods?.has(RPC.areaProperties)) {
      try {
        const list = await callRpc<string[]>(RPC.areaProperties);
        if (Array.isArray(list)) return new Set(list);
      } catch {
        // no answer this time, the next one asking tries again
        known = null;
      }
    }
    return new Set([
      ...(methods?.has(RPC.areaPlan) ? ['mowable'] : []),
      // the MowBite Planner reads these from the map itself, OpenMower's mower_map keeps them for it (#364)
      ...(methods?.has(RPC.plannerSettings) ? ['mow_around', 'angle_min', 'angle_max'] : []),
    ]);
  })();
  return known;
}

// asked again while the mower hasn't told its methods or didn't answer the call, a page kept open would go without them
export const askAreaProperties = (got: (props: Set<string>) => void) => askUntilAnswered(areaProperties, got, () => known === null);

export function useAreaProperties(): Set<string> {
  const [props, setProps] = useState<Set<string>>(() => new Set());
  useEffect(() => askAreaProperties(setProps), []);
  return props;
}
