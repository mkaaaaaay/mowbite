import {describe, emergencyText, readable, reasonText} from './events';
import {tr} from './i18n';
import {RPC} from './openmower';
import {callRpc} from './rpc';

// MowBite OS's stop book (stats.stops, api 65): stops without a command by ISO week, and the last stops, standstills
// and marks. class cause: an event says why; symptom: it only names what ended or what fell silent
export type StopClass = 'cause' | 'symptom';
export type StopReason = {reason: string; class: StopClass; count: number};

export interface StopWeek {
  week: string; // 2026-W48
  start: number; // its Monday 00:00 UTC, unix s
  stops: number;
  unexplained: number;
  standstills: number;
  blade_h: number;
  reasons: StopReason[]; // most first
}

export interface StopEntry {
  t: number;
  activity: string;
  kind: 'stop' | 'standstill' | 'mark';
  reason: string; // TYPE/REASON, EMERGENCY/BIT, UNKNOWN, STANDSTILL or MARK
  class: StopClass;
  explained: boolean;
  incident: string; // empty for none
}

export interface Stops {
  schema: number;
  weeks: StopWeek[]; // oldest first
  last: StopEntry[]; // newest first
}

export const loadStops = () => callRpc<Stops>(RPC.statsStops, {client: 'app'});

// stops per hour of the blade turning, null for a week it didn't mow
export const perBladeHour = (w: StopWeek) => (w.blade_h > 0 ? w.stops / w.blade_h : null);

// the reasons of all weeks added up, most first
export function reasonsOf(weeks: readonly StopWeek[]) {
  const sum = new Map<string, StopReason>();
  for (const w of weeks)
    for (const r of w.reasons) {
      const s = sum.get(r.reason);
      if (s) s.count += r.count;
      else sum.set(r.reason, {...r});
    }
  return [...sum.values()].sort((a, b) => b.count - a.count);
}

// what the mower did when it stopped
export const ACTIVITIES: Record<string, string> = {
  MOWING: 'while mowing',
  UNDOCKING: 'while leaving the dock',
  DOCKING: 'while docking',
  DRIVING: 'on a drive',
  CALIBRATING: 'on a calibration drive',
  IDLE: 'while idle',
};

export const activityText = (a: string) => (ACTIVITIES[a] ? tr(ACTIVITIES[a]) : readable(a));

// a reason of the book in words: the reason of the event it names, an emergency by its bit, an event without one by
// its name in the activity
export function stopReasonText(reason: string): string {
  if (reason === 'UNKNOWN') return tr('no event told why');
  if (reason === 'STANDSTILL') return tr('stood still while busy');
  if (reason === 'MARK') return reasonText({id: '', t: 0, type: 'INCIDENT', reason});
  const [type, why = ''] = reason.split('/');
  if (type === 'EMERGENCY') {
    const bit = why && emergencyText([why]);
    return bit ? `${tr('emergency stop')}: ${bit}` : tr('emergency stop');
  }
  if (why) return reasonText({id: '', t: 0, type, reason: why});
  const text = describe({id: '', t: 0, type}).text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}
