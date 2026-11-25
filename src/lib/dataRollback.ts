import {useSyncExternalStore} from 'react';
import {parseEvent} from './events';
import {onTopic} from './mqttClient';
import {RPC, TOPIC} from './openmower';
import {askUntilAnswered, callRpc, methodsUnknown, onMethodsChanged, rpcMethods} from './rpc';

// MowBite OS started on an older backup of its data (system.info data_rollback, api 58): the schemas before and after,
// the folder that keeps the data from before, when the backup was made and when the way back was (unix s). confirm:
// the map changed since the update, nothing mows by itself until data.rollback.confirm. Read once, again when the
// methods change, the connection was lost or the mower says DATA_ROLLBACK, never in a rhythm. null without one
export interface DataRollback {
  from: number;
  to: number;
  backup: string;
  backup_of: number;
  t: number;
  confirm: boolean;
}

function rollbackOf(v: unknown): DataRollback | null {
  const r = v as Partial<DataRollback> | null;
  return r && typeof r === 'object' && typeof r.backup_of === 'number' && typeof r.confirm === 'boolean' ? (r as DataRollback) : null;
}

let now: DataRollback | null = null;
const listeners = new Set<() => void>();
function set(next: DataRollback | null) {
  if (next === now) return;
  now = next;
  listeners.forEach((l) => l());
}

// an answer only counts while it's the last one asked for
let reading = 0;
function clear() {
  reading++;
  set(null);
}
// false while the mower couldn't say (its methods timed out, system.info failed): the first read goes on until it could
async function read(): Promise<boolean> {
  const n = ++reading;
  const methods = await rpcMethods();
  if (!methods && methodsUnknown()) return false;
  if (!methods?.has(RPC.dataRollbackConfirm)) {
    if (n === reading) set(null);
    return true;
  }
  try {
    const info = await callRpc<{data_rollback?: unknown}>(RPC.systemInfo);
    if (n === reading) set(rollbackOf(info?.data_rollback));
    return true;
  } catch {
    // kept as it was
    return false;
  }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  askUntilAnswered(read, () => undefined, (done) => !done);
  onTopic(TOPIC.events, (payload) => {
    const text = payload.toString();
    if (!text.includes('DATA_ROLLBACK')) return;
    const e = parseEvent(text);
    if (e?.type === 'DATA_ROLLBACK' && e.what === 'confirmed') clear();
    else void read();
  });
  onMethodsChanged(() => void read());
}

// the map is checked: the note goes and mowing by itself is free again. throws what the mower answered
export async function confirmRollback(): Promise<void> {
  await callRpc(RPC.dataRollbackConfirm, {});
  clear();
}

export const rollbackNow = () => now;
// who shows it hears every change, the first one has it read
export function subscribeRollback(l: () => void): () => void {
  start();
  listeners.add(l);
  return () => void listeners.delete(l);
}
export const useDataRollback = (): DataRollback | null => useSyncExternalStore(subscribeRollback, rollbackNow, () => null);
