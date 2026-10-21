'use client';

import {onTopic} from '@/lib/mqttClient';
import {useSyncExternalStore} from 'react';
import {TOPIC} from '@/lib/openmower';
import {createEaser, type Easer} from '@/lib/poseEaser';

export interface Position {
  x: number;
  y: number;
  heading: number;
}

// position/json comes ~7x a second, robot_state only once, so the marker glides instead of jumping. A mower standing
// still (in the dock) wobbles by a centimetre with the gps: that's no news, the pages would draw the map again and
// again for nothing
const MOVED = 0.02; // m
const TURNED = (2 * Math.PI) / 180;
let position: Position | null = null;
let started = false;
const listeners = new Set<() => void>();
// every pose with the time it came, for the map's glide: the small moves left out above, or a page drawing the map a
// moment after the pose came, made the mower stop and jump now and then. handedOut: the poses the store gave the pages
const glide = createEaser();
const handedOut = new WeakSet<Position>();
// a mower that stayed within MOVED and TURNED of where it was for a second stands: the glide keeps that pose, the gps
// and the heading drifting in the dock turned the marker a little every frame and the whole map was drawn again for it
const STANDS = 1000; // ms
let anchor: {pose: Position; at: number} | null = null;

export function glidePose(p: Position, now: number): Position {
  if (!anchor || !near(p, anchor.pose)) {
    // only turned on the spot: it still stands, a heading drifting on goes on in steps of TURNED
    const turned = !!anchor && Math.hypot(p.x - anchor.pose.x, p.y - anchor.pose.y) < MOVED;
    anchor = {pose: p, at: turned ? anchor!.at : now};
    return p;
  }
  return now - anchor.at >= STANDS ? {...anchor.pose} : p;
}

function near(p: Position, q: Position) {
  return Math.hypot(p.x - q.x, p.y - q.y) < MOVED && Math.abs(Math.atan2(Math.sin(p.heading - q.heading), Math.cos(p.heading - q.heading))) < TURNED;
}

function start() {
  if (started) return;
  started = true;
  onTopic(TOPIC.position, (payload) => {
    let p: Position;
    try {
      const raw = JSON.parse(payload.toString());
      if (typeof raw.x !== 'number' || typeof raw.y !== 'number') return;
      p = {x: raw.x, y: raw.y, heading: raw.heading ?? 0};
    } catch {
      return;
    }
    const now = performance.now();
    glide.push(glidePose(p, now), now);
    if (position && near(p, position)) return;
    position = p;
    handedOut.add(p);
    listeners.forEach((l) => l());
  });
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// null if the mower doesn't publish position/json (older setups), use robot_state's pose then
export function useMowerPosition(): Position | null {
  return useSyncExternalStore(
    subscribe,
    () => position,
    () => null,
  );
}

// the glide along every live pose, for a map showing one the store handed out; null for any other pose (robot_state's)
export function liveGlide(p: Position | null | undefined): Easer | null {
  return p && handedOut.has(p) ? glide : null;
}
