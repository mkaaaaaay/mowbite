'use client';

import {getMqttClient, unprefix, withPrefix} from '@/lib/mqttClient';
import {callRpc} from '@/lib/rpc';
import {useEffect, useState} from 'react';
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
    // per area overrides, missing = the mower's global setting
    outline_count?: number;
    outline_overlap_count?: number;
    outline_offset?: number;
    angle?: number; // rad
    // rad, the final angle (offset and increment included) stays within, bouncing back at the ends. needs an
    // openmower that knows it
    angle_min?: number;
    angle_max?: number;
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

// module level cache, map/json is retained and won't come again on remount
let cachedMap: MowerMap | null = null;

export function useMowerMap(): MowerMap | null {
  const [map, setMap] = useState<MowerMap | null>(cachedMap);

  useEffect(() => {
    const c = getMqttClient();

    const onConnect = () => c.subscribe(withPrefix(TOPIC.map));
    const onMessage = (topic: string, payload: Buffer) => {
      if (unprefix(topic) !== TOPIC.map) return;
      try {
        cachedMap = openRings(JSON.parse(payload.toString()));
        setMap(cachedMap);
      } catch {
        // ignore malformed payloads
      }
    };

    c.on('connect', onConnect);
    c.on('message', onMessage);
    if (c.connected) onConnect();

    return () => {
      c.off('connect', onConnect);
      c.off('message', onMessage);
    };
  }, []);

  return map;
}

// map.replace takes the same shape as map/json, outlines closed like the mower records them
export function saveMap(map: MowerMap): Promise<unknown> {
  return callRpc(RPC.replaceMap, [closedRings(map)]);
}
