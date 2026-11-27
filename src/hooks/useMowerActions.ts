'use client';

import {describe, reasonSentence, reasonText} from '@/lib/events';
import {tr} from '@/lib/i18n';
import {getMqttClient, topicStore, withPrefix} from '@/lib/mqttClient';
import {useCallback, useEffect, useState, useSyncExternalStore} from 'react';
import {ACTION, COMMAND, omActionId, ownActionId, OWN_NAMES_API, RPC, TOPIC} from '@/lib/openmower';
import {knownSystemInfo, isMowbiteOs} from '@/lib/mowerOs';
import {runningMisfit} from '@/lib/osUpdate';
import {callCommand, knownMethods, RpcError} from '@/lib/rpc';
import {refusalEvent, rpcErrorText} from '@/lib/rpcText';
import {liveNow} from './useMowerState';

interface ActionInfo {
  action_id: string;
  action_name: string;
  // 1/0, not a bool
  enabled: boolean | 0 | 1;
}

// kept for the whole run, actions/json is retained and comes only once
const store = topicStore<Record<string, boolean>>(TOPIC.actions, {}, (payload) => {
  const list: ActionInfo[] = JSON.parse(payload.toString());
  return Object.fromEntries(list.map((a) => [omActionId(a.action_id), !!a.enabled]));
});

// what the mower answered to the last command sent as a call (MowBite OS): why it turned it down, no answer in time, or
// one that came late. event and eventId when the refusal also went out as that event, a page that shows it doesn't
// need this line too
export interface CommandNote {
  at: number;
  text: string;
  warn: boolean;
  event?: string;
  eventId?: string;
}
let note: CommandNote | null = null;
export const commandNote = () => note;
const noteListeners = new Set<() => void>();
function setNote(n: CommandNote | null) {
  note = n;
  noteListeners.forEach((l) => l());
}
const NOTE_MS = 15000;
const COMMAND_MS = 10000;

// the refusal in the words of its event (data.event, COMMAND_REFUSED for those that only come in the answer)
function refusalNote(e: RpcError): CommandNote {
  const ev = refusalEvent(e);
  if (!ev) return {at: Date.now(), text: rpcErrorText(e), warn: true};
  const said = describe(ev, undefined, true);
  // a continue turned down comes as MOWING_REFUSED like a start
  const why = e.method === COMMAND[ACTION.resume].method && ev.type === 'MOWING_REFUSED' ? reasonText(ev) : '';
  // home from idle turned down comes as DRIVE_REFUSED like a drive to a point
  const home = e.method === RPC.dockingStart && ev.type === 'DRIVE_REFUSED' ? reasonText(ev) : '';
  const text = why ? tr('Not continued: {reason}', {reason: why}) : home ? tr('Not heading home: {reason}', {reason: home}) : said.text;
  return {at: Date.now(), text, warn: said.severity !== 'info', event: ev.type, eventId: ev.id || undefined};
}

// a tap on a command button holds back for a while the same button, pause and continue for each other (they swap under
// the finger) and what sets the mower off. stopping, pausing and going home are never held back by a tap on another
export const TAP_LOCK_MS = 1000;
const SWAPS: string[] = [ACTION.pause, ACTION.resume];
// (home from idle is a call without an action, its button goes by the call's name)
const SETS_OFF: string[] = [ACTION.startMowing, ACTION.resume, ACTION.startRecording, RPC.dockingStart];
export const setsOff = (id: string) => SETS_OFF.includes(id);
export const lockedAfter = (tapped: string, id: string) =>
  id === tapped || setsOff(id) || (SWAPS.includes(tapped) && SWAPS.includes(id));

// a change of the buttons this long after a tap came of it (the state the tap asked for), the lock starts again then
export const ROW_AFTER_TAP_MS = 10000;

// until when the button tapped (at) is held back: TAP_LOCK_MS, and again TAP_LOCK_MS once the buttons changed (rowAt)
// shortly after the tap, another one may be under the finger then
export function heldUntil(tapAt: number, rowAt: number): number {
  const changed = rowAt > tapAt && rowAt - tapAt < ROW_AFTER_TAP_MS;
  return Math.max(tapAt, changed ? rowAt : 0) + TAP_LOCK_MS;
}

// the command button tapped last while heldUntil holds it: what lockedAfter holds back meanwhile. row: the buttons shown
export function useTapLock(row = ''): [string | null, (id: string) => void] {
  const [tap, setTap] = useState<{id: string; at: number} | null>(null);
  const [rowAt, setRowAt] = useState(0);
  const [held, setHeld] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setRowAt(Date.now()));
    return () => clearTimeout(t);
  }, [row]);
  useEffect(() => {
    if (!tap) return;
    const until = heldUntil(tap.at, rowAt);
    const on = setTimeout(() => setHeld(Date.now() < until ? tap.id : null));
    const off = setTimeout(() => setHeld(null), until - Date.now());
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [tap, rowAt]);
  const tapped = (id: string) => {
    setTap({id, at: Date.now()});
    setHeld(id);
  };
  return [held, tapped];
}

// what sets the mower or its blade off, or lets go of the emergency stop: only sent while the state is current, an old
// picture or a dead connection could send it into what the user can't see, and to a MowBite OS whose interface this app
// speaks (masterplan 3, api-Stand). stopping always goes
const NEEDS_LIVE: string[] = [...SETS_OFF, ACTION.resetEmergency, ACTION.recording('start_manual_mowing')];
const NEEDS_LIVE_CALLS = new Set<string>([...NEEDS_LIVE.flatMap((id) => COMMAND[id]?.method ?? []), RPC.dockingTest, RPC.dockingStart]);
export function heldBack(): CommandNote | null {
  const note = (text: string) => ({at: Date.now(), text, warn: true});
  if (!liveNow()) return note(getMqttClient().connected ? tr("Not sent, the mower hasn't reported for a while.") : tr('Not sent, no connection to the mower.'));
  const misfit = runningMisfit();
  return misfit ? note(tr('Not sent. {why}', {why: reasonSentence(misfit, 'UPDATE')})) : null;
}

// counts the commands sent: an answer only speaks while its command is the last one, a late one of an earlier command
// would read like the answer to the newer
let sent = 0;

// sends what the action does: as its call where the mower names it in rpc.methods, else the action as ever (OpenMower,
// MowBite OS before the calls, a list that hasn't come yet). seen: the area and path the tap was meant for, a skip
// doesn't hit the next one then. never sent again by itself
export function sendCommand(id: string, seen?: {area?: number; path?: number}) {
  const cmd = COMMAND[id];
  if (!cmd || !knownMethods()?.has(cmd.method)) {
    ++sent;
    const held = NEEDS_LIVE.includes(id) && heldBack();
    if (held) return setNote(held);
    setNote(null);
    // plain text, not json. offline it's dropped, not kept for later
    if (!getMqttClient().connected) setNote({at: Date.now(), text: tr('Not sent, no connection to the mower.'), warn: true});
    getMqttClient().publish(withPrefix(TOPIC.action), actionName(id));
    return;
  }
  const params: Record<string, unknown> = {...cmd.params};
  if (cmd.method === 'mowing.skip_area' && typeof seen?.area === 'number') params.area = seen.area;
  if (cmd.method === 'mowing.skip_path' && typeof seen?.path === 'number') params.path = seen.path;
  sendCall(cmd.method, params);
}

// the action as the mower takes it: MowBite OS's own id from that api on
function actionName(id: string): string {
  const i = knownSystemInfo();
  return isMowbiteOs(i) && (i!.api ?? 0) >= OWN_NAMES_API ? ownActionId(id) : id;
}

// a command that is only a call (no action behind it), answered like the others
export function sendCall(method: string, extra: Record<string, unknown> = {}) {
  const mine = ++sent;
  const held = NEEDS_LIVE_CALLS.has(method) && heldBack();
  if (held) return setNote(held);
  setNote(null);
  const params = {client: 'app', ...extra};
  const say = (n: CommandNote) => mine === sent && setNote(n);
  const late = (a: unknown) =>
    say(a instanceof RpcError ? refusalNote(a) : {at: Date.now(), text: tr('The mower answered late: done after all.'), warn: false});
  callCommand(method, params, COMMAND_MS, late).catch((e) =>
    say(
      e instanceof RpcError && e.code === 'timeout'
        ? {at: Date.now(), text: e.message === 'offline' ? tr('Not sent, no connection to the mower.') : tr("The mower didn't answer (yet)."), warn: true}
        : e instanceof RpcError
          ? refusalNote(e)
          : {at: Date.now(), text: String(e), warn: true},
    ),
  );
}

// the last note while it's fresh, left out when the page shows its event anyway (shown: those event types)
export function useCommandNote(shown: readonly string[] = []): CommandNote | null {
  const n = useSyncExternalStore(
    (l) => {
      noteListeners.add(l);
      return () => noteListeners.delete(l);
    },
    commandNote,
    () => null,
  );
  const [, tick] = useState(0);
  useEffect(() => {
    if (!n) return;
    const t = setTimeout(() => tick((x) => x + 1), Math.max(0, n.at + NOTE_MS - Date.now()));
    return () => clearTimeout(t);
  }, [n]);
  // eslint-disable-next-line react-hooks/purity -- the timer above draws it again when it's over
  if (!n || Date.now() - n.at >= NOTE_MS) return null;
  return n.eventId && n.event && shown.includes(n.event) ? null : n;
}

export function useMowerActions(): {
  hasAction: (id: string) => boolean;
  // the mower has it, enabled right now or not
  knowsAction: (id: string) => boolean;
  publishAction: (id: string, seen?: {area?: number; path?: number}) => void;
} {
  const actions = useSyncExternalStore(store.subscribe, store.get, store.initial);

  const hasAction = useCallback((id: string) => !!actions[id], [actions]);
  const knowsAction = useCallback((id: string) => id in actions, [actions]);

  return {hasAction, knowsAction, publishAction: sendCommand};
}
