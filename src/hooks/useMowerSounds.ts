'use client';

import {useOpenMower} from '@/lib/mowerOs';
import {OM_SOUNDS_SHOWN, runningSounds, type RunningSounds} from '@/lib/openMowerSounds';
import {RPC} from '@/lib/openmower';
import {useMemo} from 'react';
import {useMowerParams} from './useMowerParams';
import {useRpcMethods} from './useRpcMethods';

export type MowerSounds = {kind: 'os'} | {kind: 'openmower'; running: RunningSounds} | null;

// MowBite OS's sounds by situation (lib/sound)
export const useOsSounds = () => !!useRpcMethods()?.has(RPC.soundList);

// the mower's sounds: MowBite OS's (lib/sound) or OpenMower's own as it runs with them (1.5.0 on, OM_SOUNDS_SHOWN), null
// without
export function useMowerSounds(): MowerSounds {
  const params = useMowerParams();
  const openMower = useOpenMower();
  const os = useOsSounds();
  const running = useMemo(() => (OM_SOUNDS_SHOWN && openMower && !os ? runningSounds(params) : null), [params, openMower, os]);
  return useMemo(() => (os ? {kind: 'os'} : running ? {kind: 'openmower', running} : null), [os, running]);
}
