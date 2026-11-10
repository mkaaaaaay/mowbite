'use client';

import {askUntilAnswered, knownMethods, rpcMethods} from '@/lib/rpc';
import {useEffect, useState} from 'react';

// what rpc.methods said: undefined until it answered (asked again after a timeout), null for a mower that can't tell
export function useRpcMethods(): Set<string> | null | undefined {
  const [m, setM] = useState(knownMethods);
  useEffect(() => askUntilAnswered(rpcMethods, setM), []);
  return m;
}
