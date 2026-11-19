import {useSyncExternalStore} from 'react';
import {isReasonCode, reasonSentence, reasonText} from './events';
import {tr} from './i18n';
import {topicStore} from './mqttClient';
import {RPC, TOPIC} from './openmower';
import {callRpc, RpcError} from './rpc';
import {answerError} from './rpcText';

// MowBite OS as its host sees it (mowbite/host/status, retained; masterplan 3.5): whether it runs, why it stays off, and
// starting it again. The host answers while MowBite OS is off too. Only on a mower with MowBite OS, no other has the topic

export type OsState = 'starting' | 'running' | 'stopped' | 'down' | 'halted' | 'updating';
export interface HostOs {
  state: OsState;
  // CRASH_LOOP when down, why it halted before its start when halted (HOST_OS in the reasons), else null
  reason: string | null;
  since: number;
  // crashes since its last stable run
  restarts: number;
  last_crash: number | null;
  revision: string | null;
}
export interface HostStatus {
  // false is the host's last will: nothing is known about MowBite OS then
  online: boolean;
  // what the host answers itself
  methods: string[];
  os: HostOs | null;
}

export function parseHost(text: string): HostStatus {
  const s = JSON.parse(text);
  const online = s.online === true;
  return {
    online,
    methods: online && Array.isArray(s.methods) ? s.methods : [],
    os: online && typeof s.os?.state === 'string' ? s.os : null,
  };
}

// undefined until the host or its last will was heard
const host = topicStore<HostStatus | undefined>(TOPIC.hostStatus, undefined, (payload) => parseHost(payload.toString()));
export const useHost = () => useSyncExternalStore(host.subscribe, host.get, host.initial);
export const useHostOnline = () => useSyncExternalStore(host.subscribe, () => host.get()?.online, () => undefined);

const OFF: OsState[] = ['stopped', 'down', 'halted'];
// MowBite OS doesn't run and won't by itself: stopped, off after crashes or halted before its start
export const osOff = (h: HostStatus | undefined): HostOs | null => (h?.os && OFF.includes(h.os.state) ? h.os : null);

// that in words, with the reason the host gives
export function offText(os: HostOs): string {
  if (os.state === 'stopped') return tr('MowBite OS is stopped.');
  const why = os.reason && reasonText({id: '', t: 0, type: 'HOST_OS', reason: os.reason, ...(os.restarts > 0 && {restarts: os.restarts})});
  return why ? `${tr("MowBite OS isn't running")}: ${why}.` : `${tr("MowBite OS isn't running")}.`;
}

// the mower as far as the restart looks at it
export interface Mower {
  live: boolean;
  state?: string;
  emergency: boolean;
}

// how a restart is offered: 'off' at once while MowBite OS is off, 'idle' after asking while it runs idle without an
// emergency stop, null not at all (anything else, during an update, or a host that doesn't list it). The method is in
// the mower's list or, with MowBite OS off and its list with it, in the host's own
export function restartWay(h: HostStatus | undefined, methods: Set<string> | null | undefined, mower: Mower, updating: boolean): 'off' | 'idle' | null {
  if (!h?.os || updating) return null;
  if (!methods?.has(RPC.hostRestartOs) && !h.methods.includes(RPC.hostRestartOs)) return null;
  if (osOff(h)) return 'off';
  return h.os.state === 'running' && mower.live && mower.state === 'IDLE' && !mower.emergency ? 'idle' : null;
}

// answers with MowBite OS as the host sees it after the start
export const restartOs = () => callRpc<HostOs>(RPC.hostRestartOs, {});

// a restart the host turned down (-32600, data {event: UPDATE_REFUSED, reason, message}) by its reason (BUSY: not idle,
// EMERGENCY: an emergency stop or the restart hold, INTERNAL: the start failed; HOLD during an update as everywhere),
// not as an update refused; anything else as it came
export function restartError(e: unknown): string {
  const d = e instanceof RpcError && e.code === -32600 ? e.data : undefined;
  const reason = d && d.reason !== 'HOLD' ? d.reason : undefined;
  return typeof reason === 'string' && isReasonCode(reason) ? reasonSentence(reason, 'UPDATE_REFUSED') : answerError(e);
}
