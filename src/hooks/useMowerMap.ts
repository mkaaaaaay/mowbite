'use client';

import {isObj} from '@/lib/mergeChanges';
import {topicStore} from '@/lib/mqttClient';
import {isMowbiteOs, knownSystemInfo} from '@/lib/mowerOs';
import {callRpc, mapChanged} from '@/lib/rpc';
import {sha256Hex} from '@/lib/sha256';
import {useSyncExternalStore} from 'react';
import {MAP_CHECK_API, RPC, TOPIC} from '@/lib/openmower';
import {closedRings, openRings} from '@/lib/rings';
import {sameContent} from '@/lib/sameMap';

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
    // mm, MowBite OS (map.area_properties lists it): the cutting height for this area while the blade cuts in it
    mow_height_mm?: number;
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
    // decoration only: a picture standing by itself on the map (a pin), its outline a small square round where it
    // stands (app/map/editing pinSquare). Saved only by a mower_map that keeps properties it doesn't know
    pin?: boolean;
    // the ring was drawn or reshaped by hand, a hard edge. missing: recorded by driving, the path of the mower's middle
    // (map contract, the MowBite Planner reads it). never false
    drawn?: boolean;
    // the body that recorded the ring by driving (map contract, MowBite OS writes it), gone once it's reshaped by hand
    recorded_body?: Record<string, unknown>;
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
  const map = openRings(mapFromMower(JSON.parse(text)));
  lastPayload = text;
  return map;
});

// map/json in the shape the app relies on: what's missing empty, an area, a point or a dock that isn't an object left
// out. throws for one that isn't a map at all, the one before stays then
export function mapFromMower(m: unknown): MowerMap {
  if (!isObj(m)) throw new Error('not a map');
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);
  return {
    ...m,
    areas: list(m.areas).map((a) => ({...a, properties: isObj(a.properties) ? a.properties : {}, outline: list(a.outline)}) as unknown as MapArea),
    docking_stations: list(m.docking_stations).filter((d) => isObj(d.position)) as unknown as DockingStation[],
  };
}

export function useMowerMap(): MowerMap | null {
  return useSyncExternalStore(store.subscribe, store.get, store.initial);
}

// f once the mower's map has the content of map, at once when it has it already. outside react, so also while the page
// asking is hidden behind another one (its effects stop there). what it returns calls it off
export function whenMowerHas(map: MowerMap, f: () => void): () => void {
  const has = () => {
    const now = store.get();
    return !!now && sameContent(now, map);
  };
  if (has()) {
    f();
    return () => {};
  }
  const off = store.subscribe(() => {
    if (!has()) return;
    off();
    f();
  });
  return off;
}

// map.replace takes the same shape as map/json, outlines closed like the mower records them. it can take the mower a
// while (its planner plans the areas again after a change), so it's waited for a minute. MowBite OS also gets the SHA-256
// of the map last read and turns the map down (-32001) when another one came meanwhile
export async function saveMap(map: MowerMap): Promise<unknown> {
  const info = knownSystemInfo();
  const read = lastPayload;
  const check = read !== null && isMowbiteOs(info) && (info!.api ?? 0) >= MAP_CHECK_API;
  const params = check ? [closedRings(map), {expected_sha256: await sha256Hex(new TextEncoder().encode(read))}] : [closedRings(map)];
  try {
    return await callRpc(RPC.replaceMap, params, 60_000);
  } catch (e) {
    if (!(check && mapChanged(e) && (await mowerHasSoon(map)))) throw e;
    // sent again after the connection dropped, the first one stored it already
    return 'stored';
  }
}

// the mower's map comes again after a reconnect, the answer to a call can be there first
const SAME_MAP_WAIT_MS = 5000;
function mowerHasSoon(map: MowerMap): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, SAME_MAP_WAIT_MS);
    const off = whenMowerHas(map, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
