import {useSyncExternalStore} from 'react';
import {numericDay} from './dates';
import {tr} from './i18n';
import {onTopic, topicStore} from './mqttClient';
import {RPC, TOPIC, UPDATE_GATED} from './openmower';
import {callRpc, RpcError} from './rpc';
import {APP_VERSION, isNewer} from './updates';

// MowBite OS's own updater (its host, masterplan 3.5): each part with what runs, what's new and where the way back goes,
// the update going on and how the last one ended. The same as the answer of every update.* and retained on its topic.
// Only on a mower that lists update.status

export interface Version {
  revision: string;
  // when it was built, unix s
  date: number | null;
  // null for MowBite OS, it has no number
  version: string | null;
}
// not installed by itself: why, and how the try that ended so went (none: it doesn't fit this mower)
export interface Blocked {
  reason: string;
  result?: 'rolled_back' | 'failed';
  t: number | null;
}
export interface Available extends Version {
  // the oldest app it works with
  min_app: string | null;
  blocked: Blocked | null;
}
export interface Component {
  // os, planner, app, host, or one a newer MowBite OS adds
  id: string;
  name: string;
  running: Version | null;
  available: Available | null;
  // where going back leads, null without one
  previous: Version | null;
  installed_at: number | null;
  crashes_since_install: number;
  auto: boolean;
  // planner and app: their own installation, or the one MowBite OS brings along
  source?: 'own' | 'bundled';
  own_skipped?: {revision: string; reason: string} | null;
}
export type Phase = 'idle' | 'verifying' | 'unpacking' | 'waiting_gate' | 'switching' | 'checking';
export type Step = Exclude<Phase, 'idle'>;
export interface Last {
  result: 'installed' | 'rolled_back' | 'refused' | 'aborted' | 'failed';
  reason: string | null;
  message: string;
  revision: string | null;
  component: string;
  t: number;
}
export interface Auto {
  enabled: boolean;
  // the night's window, HH:MM in the mower's time
  from: string;
  to: string;
}
export interface UpdateStatus {
  phase: Phase;
  component: string | null;
  revision: string | null;
  // why the gate waits
  reason: string | null;
  components: Component[];
  auto: Auto;
  last: Last | null;
}

// the mower lists update.status. Kept once seen: the host's methods leave the list while it restarts for its own update
let offered = false;
export const osUpdatesOffered = (methods: Set<string> | null | undefined) => (offered ||= !!methods?.has(RPC.updateStatus));

// what the updater said last and when it came in
export type Seen = {status: UpdateStatus; at: number};
let seen: Seen | null = null;
let listening = false;
const listeners = new Set<() => void>();

function take(status: unknown) {
  const s = status as UpdateStatus | null;
  if (!s || typeof s.phase !== 'string' || !Array.isArray(s.components) || !s.auto) return;
  seen = {status: s, at: Date.now() / 1000};
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  if (!listening) {
    listening = true;
    onTopic(TOPIC.updateStatus, (payload) => {
      try {
        take(JSON.parse(payload.toString()));
      } catch {}
    });
  }
  listeners.add(l);
  return () => void listeners.delete(l);
}

export const useUpdateStatus = (): Seen | null => useSyncExternalStore(subscribe, () => seen, () => null);

// the host says online while it answers, its last will says false: undefined until either came
const hostOnline = topicStore<boolean | undefined>(TOPIC.hostStatus, undefined, (payload) => JSON.parse(payload.toString()).online === true);
export const useHostOnline = () => useSyncExternalStore(hostOnline.subscribe, hostOnline.get, hostOnline.initial);

// every call names the app's version: the automatic update leaves out what needs a newer app than the one seen last
const call = (method: string, params: object = {}) =>
  callRpc<UpdateStatus>(method, {...params, app_version: APP_VERSION}).then((s) => {
    take(s);
    return s;
  });

// when the last result came as an update was started from here (null: none yet), undefined before the first
let startedAfter: number | null | undefined;
const started = (s: UpdateStatus) => {
  startedAfter = s.last?.t ?? null;
  return s;
};
// the update going on was started from this app, not by the automatic one: no newer result has come since
const startedHere = (s: UpdateStatus) => startedAfter !== undefined && (s.last?.t ?? null) === startedAfter;

export const askUpdateStatus = () => call(RPC.updateStatus);
export const checkUpdates = () => call(RPC.updateCheck);
// the newest version of a part, or the one named. reset_jobs (planner only): not waiting for an open mowing job
export const startUpdate = (component: string, opts: {revision?: string; reset_jobs?: boolean} = {}) =>
  call(RPC.updateStart, {component, ...opts}).then(started);
export const abortUpdate = () => call(RPC.updateAbort);
export const rollBack = (component: string, resetJobs = false) =>
  call(RPC.updateRollback, {component, ...(resetJobs && {reset_jobs: true})}).then(started);
export const setAutoUpdate = (auto: Partial<Auto>) => call(RPC.updateSetAuto, auto);

// the part the update going on is for
export const updating = (s: UpdateStatus) => (s.phase === 'idle' ? undefined : s.components.find((c) => c.id === s.component));

// the update going on leads back to the version before, not on to a new one
export const goingBack = (s: UpdateStatus) => !!s.revision && updating(s)?.previous?.revision === s.revision;

// the version the update going on leads to
export function runTarget(s: UpdateStatus): Version | undefined {
  const c = updating(s);
  return [c?.available, c?.previous].find((v) => v?.revision === s.revision) ?? undefined;
}

// the last one went back by hand: that ends as installed too, the version left is then the one held back
export const wentBackByHand = (s: UpdateStatus) =>
  s.last?.result === 'installed' && s.components.find((c) => c.id === s.last!.component)?.available?.blocked?.reason === 'ROLLED_BACK_BY_HAND';

const IDLE_MS = 10000;
// the updater is done with what it was at (an accepted abort ends a moment after its answer)
const idle = () =>
  new Promise<void>((resolve, reject) => {
    const look = () => {
      if (seen?.status.phase !== 'idle') return;
      clearTimeout(timer);
      listeners.delete(look);
      resolve();
    };
    const timer = setTimeout(() => {
      listeners.delete(look);
      reject(new RpcError(RPC.updateAbort, 'timeout', 'still updating'));
    }, IDLE_MS);
    listeners.add(look);
    look();
  });

// a planner update waiting for an open mowing job, started again without that wait: aborted first (nothing has changed
// before the switch), then the same once more with reset_jobs
export async function withoutJobWait(s: UpdateStatus) {
  const c = updating(s);
  if (!c || !s.revision) return;
  const back = goingBack(s);
  await abortUpdate();
  await idle();
  await (back ? rollBack(c.id, true) : startUpdate(c.id, {revision: s.revision, reset_jobs: true}));
}

// the steps of the update going on and the one it's at. Going back has nothing to check or unpack
export function runSteps(s: UpdateStatus): {steps: Step[]; now: number} {
  // (a part this app doesn't know counts as gated once it waits with a reason)
  const gated = UPDATE_GATED.includes(s.component ?? '') || (s.phase === 'waiting_gate' && !!s.reason);
  const steps: Step[] = [...(goingBack(s) ? [] : (['verifying', 'unpacking'] as const)), ...(gated ? (['waiting_gate'] as const) : []), 'switching', 'checking'];
  // (the others pass the gate without a wait)
  const at = s.phase === 'waiting_gate' && !gated ? 'switching' : s.phase;
  return {steps, now: Math.max(0, steps.indexOf(at as Step))};
}

// this app is older than the version needs
export const appTooOld = (a: Available | null) => !!a?.min_app && isNewer(a.min_app, APP_VERSION);

// the order the automatic update takes the parts in (masterplan 3.5)
const AUTO_ORDER = ['host', 'app', 'planner', 'os'];
// what the automatic update installs next, undefined when nothing is left for it
export const nextByItself = (s: UpdateStatus): Component | undefined =>
  AUTO_ORDER.flatMap((id) => s.components.filter((c) => c.id === id)).find((c) => c.available && !c.available.blocked && !appTooOld(c.available));

// within the night's window, by this device's clock (one that ends before it starts goes over midnight)
export function inWindow(auto: Auto, now = new Date()): boolean {
  const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const [from, to, at] = [minutes(auto.from), minutes(auto.to), now.getHours() * 60 + now.getMinutes()];
  return from <= to ? at >= from && at < to : at >= from || at < to;
}

// the automatic update started the one going on: on, within its window, and not started from here
export const runsByItself = (s: UpdateStatus, now = new Date()) => !startedHere(s) && s.auto.enabled && inWindow(s.auto, now);

// the short form of a revision (a commit)
export const shortRevision = (revision: string) => revision.slice(0, 7);

// a version in words: its number and the day it was built, MowBite OS only has the day, one without either its revision
export function versionLabel(v: Version): string {
  if (v.version && v.date) return tr('{v} of {day}', {v: v.version, day: numericDay(v.date)});
  if (v.version) return v.version;
  return v.date ? tr('Version of {day}', {day: numericDay(v.date)}) : shortRevision(v.revision);
}
// the same in short, for a button or a heading
export const versionName = (v: Version): string => v.version ?? (v.date ? numericDay(v.date) : shortRevision(v.revision));
