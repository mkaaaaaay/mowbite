'use client';

import {useRpcMethods} from '@/hooks/useRpcMethods';
import {loadCameras, sortCameras, type Camera} from '@/lib/camera';
import {readMower, writeMower} from '@/lib/mowers';
import {onTopic} from '@/lib/mqttClient';
import {RPC, TOPIC} from '@/lib/openmower';
import {onMethodsChanged} from '@/lib/rpc';
import {rpcErrorText} from '@/lib/rpcText';
import {useEffect, useSyncExternalStore} from 'react';

// the mower's cameras for all who show them: read once, again when one changes (CAMERA_CHANGED), when the methods
// change or the connection was lost, never in a rhythm. changes counts the CAMERA_CHANGED of each camera, a stream
// is opened anew after each
interface Cameras {
  list?: Camera[];
  failed?: string;
  changes: Record<string, number>;
  // the one picked last on this device for this mower
  chosen: string;
}

const CHOSEN_KEY = 'camera';
let now: Cameras = {changes: {}, chosen: ''};
const listeners = new Set<() => void>();
const set = (next: Partial<Cameras>) => {
  now = {...now, ...next};
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

let reading = 0;
function read() {
  const n = ++reading;
  loadCameras().then(
    (list) => n === reading && set({list: sortCameras(Array.isArray(list) ? list : []), failed: undefined}),
    (e) => n === reading && set({failed: rpcErrorText(e)}),
  );
}

let started = false;
function start() {
  if (started) return;
  started = true;
  set({chosen: readMower<string>(CHOSEN_KEY) ?? ''});
  onTopic(TOPIC.events, (payload) => {
    const text = payload.toString();
    if (!text.includes('CAMERA_CHANGED')) return;
    let e: {type?: string; id?: string; camera_id?: string; camera?: string; available?: boolean; reason?: string};
    try {
      e = JSON.parse(text);
    } catch {
      return;
    }
    if (e.type !== 'CAMERA_CHANGED') return;
    // which one: an event's id is its own on MowBite OS, so the camera's is taken from whichever field names one in the
    // list. none: each is connected anew
    const ids = new Set(now.list?.map((c) => c.id));
    const id = [e.camera_id, e.camera, e.id].find((v) => typeof v === 'string' && ids.has(v));
    const list = now.list?.map((c) => (c.id === id && typeof e.available === 'boolean' ? {...c, available: e.available, reason: e.reason} : c));
    const changes = {...now.changes};
    for (const c of now.list ?? []) if (!id || c.id === id) changes[c.id] = (changes[c.id] ?? 0) + 1;
    // what it says right away, the whole list after it
    set({list, changes});
    read();
  });
  onMethodsChanged(read);
  read();
}

export function chooseCamera(id: string) {
  set({chosen: id});
  writeMower(CHOSEN_KEY, id);
}

// on: the mower has cameras (camera.* in rpc.methods). camera: the one picked, else the first
export function useCameras() {
  const methods = useRpcMethods();
  const on = !!methods?.has(RPC.cameraList) && methods.has(RPC.cameraStream);
  const s = useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );
  useEffect(() => {
    if (on) start();
  }, [on]);
  const camera = s.list?.find((c) => c.id === s.chosen) ?? s.list?.[0];
  return {on, list: s.list, failed: s.failed, camera, changes: s.changes};
}
