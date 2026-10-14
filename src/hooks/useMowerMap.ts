'use client';

import {topicStore} from '@/lib/mqttClient';
import {callRpc} from '@/lib/rpc';
import {useSyncExternalStore} from 'react';
import {RPC, TOPIC} from '@/lib/openmower';
import {closedRings, openRings} from '@/lib/rings';

export interface Point {
  x: number;
  y: number;
}

export interface MapArea {
  id: string;
  properties: {
    name?: string;
    type?: string;
    active?: boolean;
    // drivable but left out when mowing, needs an openmower that knows it (older ones drop it when saving)
    // false: drivable but not mowed, like a navigation area
    mowable?: boolean;
    // with mowable false: the mowing areas it lies in plan around it instead of across, needs an openmower that knows it
    mow_around?: boolean;
    // per area overrides, missing = the mower's global setting
    outline_count?: number;
    outline_overlap_count?: number;
    outline_offset?: number;
    angle?: number; // rad
    // rad, the final angle (offset and increment included) stays within, bouncing back at the ends. needs an
    // openmower that knows it
    angle_min?: number;
    angle_max?: number;
    // MowBite Planner settings for this area only (pattern, turns...), on top of the ones for all areas. Only the
    // MowBite Planner reads it, and only a mower_map that keeps properties it doesn't know saves it
    planner?: Record<string, unknown>;
    // m, how far the mower's body keeps off this obstacle, a mowing area not mowed or an inactive one (MowBite Planner),
    // in place of its obstacle_margin. Saved only by a mower_map that keeps properties it doesn't know
    margin?: number;
  };
  outline: Point[];
}

export interface DockingStation {
  id: string;
  position: Point;
  heading: number;
}

export interface MowerMap {
  areas: MapArea[];
  docking_stations: DockingStation[];
}

// kept for the whole run. map/json is retained, it comes again with every reconnect (a phone back from standby): the
// same map stays the same object then, plans and everything else worked out from it stay as they are
let lastPayload: string | null = null;
const store = topicStore<MowerMap | null>(TOPIC.map, null, (payload, prev) => {
  const text = payload.toString();
  if (text === lastPayload && prev) return prev;
  const map = openRings(JSON.parse(text));
  lastPayload = text;
  return map;
});

export function useMowerMap(): MowerMap | null {
  return useSyncExternalStore(store.subscribe, store.get, store.initial);
}

// map.replace takes the same shape as map/json, outlines closed like the mower records them
export function saveMap(map: MowerMap): Promise<unknown> {
  return callRpc(RPC.replaceMap, [closedRings(map)]);
}
