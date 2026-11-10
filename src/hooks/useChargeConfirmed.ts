import {chargeConfirmed, type MowerEvent, type Run} from '@/lib/events';
import {useEffect, useRef, useState} from 'react';

// off the contacts this long counts as having left them, MowBite OS doesn't count a shorter one either (CHARGING_LOST)
const LEFT_AFTER = 10000; // ms

// whether it charges in the dock, on MowBite OS from api 4 on (DOCKED once the current came, masterplan 3.1a O9): true
// charging, false on the contacts without that, null when the events at hand don't tell. undefined elsewhere, there
// the contacts are enough. on: on the contacts, undefined while the state isn't known
export function useChargeConfirmed(api: number, on: boolean | undefined, today?: MowerEvent[], latest?: Run[]): boolean | null | undefined {
  // seen leaving the contacts: the newest event then, by the mower's clock (the phone's may differ)
  const [left, setLeft] = useState<number>();
  const newest = useRef(-Infinity);
  useEffect(() => {
    newest.current = Math.max(...(today ?? []).map((e) => e.t));
  });
  useEffect(() => {
    if (on !== false || api < 4) return;
    const off = newest.current;
    const t = setTimeout(() => setLeft(off), LEFT_AFTER);
    return () => clearTimeout(t);
  }, [on, api]);
  if (api < 4) return undefined;
  const found = chargeConfirmed(today ?? [], left);
  if (found !== null) return found;
  for (const run of latest ?? []) {
    const r = chargeConfirmed(run.events);
    if (r !== null) return r;
  }
  return null;
}
