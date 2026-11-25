'use client';

import {useRpcMethods} from '@/hooks/useRpcMethods';
import {loadSetup, offersSetup, setupNow, subscribeSetup, type Setup} from '@/lib/setup';
import {useEffect, useSyncExternalStore} from 'react';

// MowBite OS's setup program: null where the mower doesn't list it, undefined until it's known and read
export function useSetup(): Setup | null | undefined {
  const methods = useRpcMethods();
  const offered = offersSetup(methods);
  const setup = useSyncExternalStore(subscribeSetup, setupNow, () => null);
  useEffect(() => {
    if (offered && !setupNow()) loadSetup().catch(() => {});
  }, [offered]);
  if (methods === undefined) return undefined;
  if (!offered) return null;
  return setup ?? undefined;
}
