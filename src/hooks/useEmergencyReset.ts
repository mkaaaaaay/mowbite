'use client';

import {parseEvent, type MowerEvent} from '@/lib/events';
import {onTopic} from '@/lib/mqttClient';
import {ACTION, TOPIC} from '@/lib/openmower';
import {TAP_LOCK_MS} from '@/hooks/useMowerActions';
import {useCallback, useEffect, useState} from 'react';

// resetting the emergency stop, and why MowBite OS didn't let go the last time (EMERGENCY_RESET_REFUSED): kept while the
// stop lasts, gone when it's tried again. OpenMower doesn't say, there it stays null
export function useEmergencyReset(active: boolean, publishAction: (id: string) => void): {refused: MowerEvent | null; reset: () => void} {
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
  const reset = useCallback(() => {
    setRefused(null);
    publishAction(ACTION.resetEmergency);
  }, [publishAction]);
  return {refused: active ? refused : null, reset};
}

// true for a moment after the emergency stop ended: what sets the mower off takes the reset button's place under the
// finger, a second tap meant for the reset mustn't hit it
export function useJustReset(active: boolean): boolean {
  const [was, setWas] = useState(active);
  const [just, setJust] = useState(false);
  if (was !== active) {
    setWas(active);
    setJust(!active);
  }
  useEffect(() => {
    if (!just) return;
    const t = setTimeout(() => setJust(false), TAP_LOCK_MS);
    return () => clearTimeout(t);
  }, [just]);
  return just;
}
