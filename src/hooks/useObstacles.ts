'use client';

import {DRIVING, useMowerStateValue} from '@/hooks/useMowerState';
import {useRpcMethods} from '@/hooks/useRpcMethods';
import {parseEvent} from '@/lib/events';
import {onTopic} from '@/lib/mqttClient';
import {loadObstacles, mergeObstacles, sameObstacles, sinceOf, withoutObstacle, type Obstacle, type ObstacleList} from '@/lib/obstacles';
import {RPC, TOPIC} from '@/lib/openmower';
import {onMethodsChanged} from '@/lib/rpc';
import {useEffect, useSyncExternalStore} from 'react';

// the obstacles the mower's sensors saw, for all who show them: the whole list once, then the ones seen since at each
// OBSTACLE_SEEN and every 10 s while the mower drives (a missed event), cleared at OBSTACLES_CLEARED. a circle it
// drives around ends without an event: while one is shown, at OBSTACLE_AVOIDED and when it stops driving, the whole
// list. without vision.obstacles.* in the methods the list goes, it's read again once they're back
type Head = Omit<ObstacleList, 'obstacles'>;
interface State {
  obstacles?: Obstacle[];
  head?: Head;
}

const POLL_MS = 10000;
let now: State = {};
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  now = {...now, ...next};
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

// a whole read or a clear makes older answers stale: one asked before it could bring back what's gone
let generation = 0;
const circles = () => !!now.obstacles?.some((o) => o.keep_out_r);
function read(whole = !now.obstacles || circles()) {
  const n = whole ? ++generation : generation;
  loadObstacles(whole ? undefined : sinceOf(now.obstacles!)).then(
    ({obstacles, ...head}) => {
      if (n !== generation) return;
      const list = mergeObstacles(whole ? [] : now.obstacles!, Array.isArray(obstacles) ? obstacles : []);
      // (each answer to since has the newest again: the same list and head draw nothing anew)
      const same = now.obstacles && sameObstacles(now.obstacles, list) && JSON.stringify(now.head) === JSON.stringify(head);
      if (!same) set({head, obstacles: list});
    },
    () => {},
  );
}

// gone on the mower: from here too, whoever cleared it
export function forget(id: number | null) {
  generation++;
  if (now.obstacles) set({obstacles: withoutObstacle(now.obstacles, id)});
}

let started = false;
function start() {
  if (started) return;
  started = true;
  onTopic(TOPIC.events, (payload) => {
    const text = payload.toString();
    if (!text.includes('OBSTACLE')) return;
    const e = parseEvent(text);
    if (e?.type === 'OBSTACLE_SEEN') read();
    else if (e?.type === 'OBSTACLE_AVOIDED') read(true);
    else if (e?.type === 'OBSTACLES_CLEARED') forget(e.obstacle_id ?? null);
    else if (e?.type === 'OBSTACLE_SIGHT' && now.head) set({head: {...now.head, sight: {ok: !!e.ok, reason: e.ok ? null : (e.reason ?? null)}}});
  });
  onMethodsChanged((m) => {
    if (m && !m.has(RPC.obstaclesList)) {
      generation++;
      set({obstacles: undefined, head: undefined});
    } else read(true);
  });
  read(true);
}

// one timer for all that show them while the mower drives
let pollers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
function poll() {
  if (pollers++ === 0) timer = setInterval(() => read(), POLL_MS);
  return () => {
    if (--pollers > 0) return;
    clearInterval(timer);
    if (circles()) read(true);
  };
}

// on: the mower has an obstacle sensor (vision.obstacles.* in rpc.methods)
export function useObstacles() {
  const methods = useRpcMethods();
  const driving = useMowerStateValue((l) => DRIVING.has(l.state?.current_state ?? ''));
  const on = !!methods?.has(RPC.obstaclesList);
  const s = useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );
  useEffect(() => {
    if (on) start();
  }, [on]);
  useEffect(() => (on && driving ? poll() : undefined), [on, driving]);
  return {on, obstacles: on ? s.obstacles : undefined, head: on ? s.head : undefined};
}
