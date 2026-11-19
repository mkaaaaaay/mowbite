'use client';

import {parseEvent, type MowerEvent} from '@/lib/events';
import {onTopic} from '@/lib/mqttClient';
import {ACTION, TOPIC} from '@/lib/openmower';
import {TAP_LOCK_MS, useMowerActions} from '@/hooks/useMowerActions';
import {useMowerStateValue} from '@/hooks/useMowerState';
import {useCallback, useEffect, useState} from 'react';

const BLADE_OFF = ACTION.recording('stop_manual_mowing');

// resetting the emergency stop, and why MowBite OS didn't let go the last time (EMERGENCY_RESET_REFUSED): kept while the
// stop lasts, gone when it's tried again. OpenMower doesn't say, there it stays null
export function useEmergencyReset(active: boolean): {refused: MowerEvent | null; reset: () => void} {
  const {hasAction, publishAction} = useMowerActions();
  // mowing by hand in recording mode: OpenMower would run the blade again once released
  const recording = useMowerStateValue((l) => l.state?.current_state === 'AREA_RECORDING');
  const bladeOn = recording && hasAction(BLADE_OFF);
  const [refused, setRefused] = useState<MowerEvent | null>(null);
  // a new emergency stop starts without the refusal of the one before
  const [was, setWas] = useState(active);
  if (was !== active) {
    setWas(active);
    setRefused(null);
  }
  useEffect(() => {
    if (!active) return;
    return onTopic(TOPIC.events, (payload) => {
      const e = parseEvent(payload.toString());
      if (e?.type === 'EMERGENCY_RESET_REFUSED') setRefused(e);
    });
  }, [active]);
  // the blade goes off first: both are actions on OpenMower, sent on one topic they arrive in this order
  const reset = useCallback(() => {
    setRefused(null);
    if (bladeOn) publishAction(BLADE_OFF);
    publishAction(ACTION.resetEmergency);
  }, [bladeOn, publishAction]);
  return {refused: active ? refused : null, reset};
}

// true for a moment after the emergency stop ended: what sets the mower off takes the reset button's place under the
// finger, a second tap meant for the reset mustn't hit it
export function useJustReset(active: boolean): boolean {
  return useJustTurned(!active);
}

// true for a moment after the emergency stop came: its reset button takes the place of what was under the finger (the
// stick), a tap meant for that mustn't reset it
export function useJustStopped(active: boolean): boolean {
  return useJustTurned(active);
}

// true for TAP_LOCK_MS after on turned true
function useJustTurned(on: boolean): boolean {
  const [was, setWas] = useState(on);
  const [just, setJust] = useState(false);
  if (was !== on) {
    setWas(on);
    setJust(on);
  }
  useEffect(() => {
    if (!just) return;
    const t = setTimeout(() => setJust(false), TAP_LOCK_MS);
    return () => clearTimeout(t);
  }, [just]);
  return just;
}
