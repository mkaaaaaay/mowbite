'use client';

import {describe, type MowerEvent} from '@/lib/events';
import {tr} from '@/lib/i18n';
import {getMqttClient, topicStore, withPrefix} from '@/lib/mqttClient';
import {useCallback, useEffect, useState, useSyncExternalStore} from 'react';
import {COMMAND, TOPIC} from '@/lib/openmower';
import {callCommand, knownMethods, RpcError} from '@/lib/rpc';
import {rpcErrorText} from '@/lib/rpcText';

interface ActionInfo {
  action_id: string;
  action_name: string;
  // 1/0, not a bool
  enabled: boolean | 0 | 1;
}

// kept for the whole run, actions/json is retained and comes only once
const store = topicStore<Record<string, boolean>>(TOPIC.actions, {}, (payload) => {
  const list: ActionInfo[] = JSON.parse(payload.toString());
  return Object.fromEntries(list.map((a) => [a.action_id, !!a.enabled]));
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
  const d = e.data ?? {};
  if (e.code !== -32600 || typeof d.event !== 'string') return {at: Date.now(), text: rpcErrorText(e), warn: true};
  const ev = {...d, id: typeof d.event_id === 'string' ? d.event_id : '', t: Date.now() / 1000, type: d.event} as MowerEvent;
  const said = describe(ev, undefined, true);
  return {at: Date.now(), text: said.text, warn: said.severity !== 'info', event: d.event, eventId: ev.id || undefined};
}

// sends what the action does: as its call where the mower names it in rpc.methods, else the action as ever (OpenMower,
// MowBite OS before the calls, a list that hasn't come yet). seen: the area and path the tap was meant for, a skip
// doesn't hit the next one then. never sent again by itself
export function sendCommand(id: string, seen?: {area?: number; path?: number}) {
  const cmd = COMMAND[id];
  if (!cmd || !knownMethods()?.has(cmd.method)) {
    // plain text, not json
    getMqttClient().publish(withPrefix(TOPIC.action), id);
    return;
  }
  const params: Record<string, unknown> = {client: 'app', ...cmd.params};
  if (cmd.method === 'mowing.skip_area' && typeof seen?.area === 'number') params.area = seen.area;
  if (cmd.method === 'mowing.skip_path' && typeof seen?.path === 'number') params.path = seen.path;
  setNote(null);
  const late = (a: unknown) =>
    setNote(a instanceof RpcError ? refusalNote(a) : {at: Date.now(), text: tr('The mower answered late: done after all.'), warn: false});
  callCommand(cmd.method, params, COMMAND_MS, late).catch((e) =>
    setNote(
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
