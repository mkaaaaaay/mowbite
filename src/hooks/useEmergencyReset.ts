'use client';

import {parseEvent, type MowerEvent} from '@/lib/events';
import {onTopic} from '@/lib/mqttClient';
import {ACTION, TOPIC} from '@/lib/openmower';
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
