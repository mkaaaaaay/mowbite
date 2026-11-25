'use client';

import {parseEvent, type MowerEvent} from '@/lib/events';
import {onTopic} from '@/lib/mqttClient';
import {TOPIC} from '@/lib/openmower';
import {osCalibAbort, phaseOf, STOP_CONFIRM_MS, type PhaseSaid} from '@/lib/osCalibration';
import {useEffect, useState} from 'react';

// The stop of MowBite OS's calibration drive: sent at every tap, never held back. sent until the mower leaves the
// drive, unconfirmed when it hasn't after STOP_CONFIRM_MS or the call failed: only the mower's state tells that it
// stopped
export function useCalibStop(running: boolean): {stop: () => void; said: 'sent' | 'unconfirmed' | null} {
  const [said, setSaid] = useState<'sent' | 'unconfirmed' | null>(null);
  const [taps, setTaps] = useState(0);
  if (!running && said) setSaid(null);
  useEffect(() => {
    if (said !== 'sent') return;
    const timer = setTimeout(() => setSaid('unconfirmed'), STOP_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [said, taps]);
  const stop = () => {
    setSaid('sent');
    setTaps((n) => n + 1);
    osCalibAbort().catch(() => setSaid((s) => s && 'unconfirmed'));
  };
  return {stop, said};
}

// What the drive's events said while the page is open: the phase it's in, and how the last one ended (CALIBRATED or
// CALIBRATION_FAILED) until the next one starts
export function useCalibEvents(on: boolean): {phase: PhaseSaid | null; ended: MowerEvent | null} {
  const [phase, setPhase] = useState<PhaseSaid | null>(null);
  const [ended, setEnded] = useState<MowerEvent | null>(null);
  useEffect(() => {
    if (!on) return;
    return onTopic(TOPIC.events, (payload) => {
      const text = payload.toString();
      if (!text.includes('CALIBRAT')) return;
      const e = parseEvent(text);
      const p = phaseOf(e);
      if (p) {
        // (the drive's rounds and time come with its start only)
        setPhase((was) => (p.phase === 'end' ? null : p.phase === 'start' || !was ? p : {...p, rounds: was.rounds, seconds: was.seconds}));
        if (p.phase === 'start') setEnded(null);
      } else if (e?.type === 'CALIBRATED' || e?.type === 'CALIBRATION_FAILED') setEnded(e);
    });
  }, [on]);
  return {phase, ended};
}
