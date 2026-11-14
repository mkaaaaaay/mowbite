'use client';

import {useRpcMethods} from '@/hooks/useRpcMethods';
import {loadCameras, sortCameras, streamChanged, withChange, type Camera} from '@/lib/camera';
import {parseEvent} from '@/lib/events';
import {readMower, writeMower} from '@/lib/mowers';
import {onTopic} from '@/lib/mqttClient';
import {RPC, TOPIC} from '@/lib/openmower';
import {onMethodsChanged} from '@/lib/rpc';
import {rpcErrorText} from '@/lib/rpcText';
import {useEffect, useSyncExternalStore} from 'react';

// the mower's cameras for all who show them: read once, again when one changes (CAMERA_CHANGED), when the methods
// change or the connection was lost, never in a rhythm. changes counts the CAMERA_CHANGED of each camera that end its
// streams, a stream is opened anew after each. without camera.* in the methods (their process gone) the list goes,
// it's read again once they're back
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
  // (a failure from before isn't shown while it's read anew)
  if (now.failed) set({failed: undefined});
  loadCameras().then(
    (list) => n === reading && set({list: sortCameras(Array.isArray(list) ? list : [])}),
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
    const e = parseEvent(text);
    if (e?.type !== 'CAMERA_CHANGED') return;
    // what it says about its camera right away, the whole list after it (one the list doesn't have yet comes with that)
    const list = now.list && withChange(now.list, e);
    if (list) {
      const id = e.camera_id!;
      const reopen = streamChanged(now.list!.find((c) => c.id === id)!, list.find((c) => c.id === id)!);
      set({list, changes: reopen ? {...now.changes, [id]: (now.changes[id] ?? 0) + 1} : now.changes});
    }
    read();
  });
  onMethodsChanged((m) => {
    if (m && !m.has(RPC.cameraList)) {
      reading++;
      set({list: undefined, failed: undefined});
    } else read();
  });
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
