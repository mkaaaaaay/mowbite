'use client';

import {askUntilAnswered, knownMethods, onMethodsChanged, rpcMethods} from '@/lib/rpc';
import {useEffect, useState} from 'react';

// what rpc.methods said: undefined until it answered (asked again after a timeout), null for a mower that can't tell.
// a change on MowBite OS comes in by itself
export function useRpcMethods(): Set<string> | null | undefined {
  const [m, setM] = useState(knownMethods);
  useEffect(() => {
    const stop = askUntilAnswered(rpcMethods, setM);
    const off = onMethodsChanged(setM);
    return () => {
      stop();
      off();
    };
  }, []);
  return m;
}
