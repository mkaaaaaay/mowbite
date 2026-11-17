'use client';

import {dockFootprint, loadGeometry, type Geometry, type Outline} from '@/lib/mowerBody';
import {RPC} from '@/lib/openmower';
import {robotShape, type ShapePart} from '@/lib/setup';
import {useEffect, useState} from 'react';
import {useRpcMethods} from './useRpcMethods';

// asked once for all maps on the page, again after an answer that didn't come
let asked: Promise<Geometry> | null = null;

// a value of robot.geometry, null on a mower without it, without the value and until it's read
function useGeometryValue<T>(pick: (g: Geometry) => T | null): T | null {
  const offered = !!useRpcMethods()?.has(RPC.geometry);
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (!offered) return;
    let on = true;
    asked ??= loadGeometry();
    asked.then(
      (g) => on && setValue(pick(g)),
      () => (asked = null),
    );
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pick is the same for each caller
  }, [offered]);
  return offered ? value : null;
}

// the docking station's footprint for the map
export const useDockFootprint = (): Outline | null => useGeometryValue(dockFootprint);

// how the mower looks from above, where it gives that
export const useRobotShape = (): ShapePart[] | null => useGeometryValue((g) => robotShape(g.settings.robot_shape?.value));
