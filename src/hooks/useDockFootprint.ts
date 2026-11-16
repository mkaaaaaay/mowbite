'use client';

import {dockFootprint, loadGeometry, type Outline} from '@/lib/mowerBody';
import {RPC} from '@/lib/openmower';
import {useEffect, useState} from 'react';
import {useRpcMethods} from './useRpcMethods';

// asked once for all maps on the page, again after an answer that didn't come
let asked: Promise<Outline | null> | null = null;

// the docking station's footprint for the map, null on a mower without robot.geometry, without one and until it's read
export function useDockFootprint(): Outline | null {
  const offered = !!useRpcMethods()?.has(RPC.geometry);
  const [footprint, setFootprint] = useState<Outline | null>(null);
  useEffect(() => {
    if (!offered) return;
    let on = true;
    asked ??= loadGeometry().then(dockFootprint);
    asked.then(
      (f) => on && setFootprint(f),
      () => (asked = null),
    );
    return () => {
      on = false;
    };
  }, [offered]);
  return offered ? footprint : null;
}
