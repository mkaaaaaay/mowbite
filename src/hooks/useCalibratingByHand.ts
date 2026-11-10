'use client';

import {calibByHand, calibProgress, canCalibrate} from '@/lib/calibration';
import {useMowbiteOs} from '@/lib/mowerOs';
import {useSyncExternalStore} from 'react';
import {useRpcMethods} from './useRpcMethods';

// a calibration drive by hand going on in recording mode, only where the planner says so
export function useCalibratingByHand(recording: boolean) {
  const progress = useSyncExternalStore(calibProgress.subscribe, calibProgress.get, calibProgress.initial);
  const can = canCalibrate(useRpcMethods(), useMowbiteOs());
  return recording && can && calibByHand(progress);
}
