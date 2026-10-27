// the editor's map worked out ahead while another page is open: the real edges, the garden's things placed and the
// lines along the edges, as the editor's MapView keeps them (they go by the same map, body and fit). a piece at a time
// while the page idles, the map opens without most of that work then
import {useEffect, useSyncExternalStore} from 'react';
import type {MowerMap} from '@/hooks/useMowerMap';
import {angleOffsetOf, useMowerParams} from '@/hooks/useMowerParams';
import {realEdges, realInsides, useMowerBody} from '@/lib/mowerBody';
import {settingsStore} from '@/lib/settings';
import {layerOn} from './MapControls';
import {hiddenLayers} from './useMapPrefs';
import {boundsOf, fitIn} from './mapFrame';
import {gardenThings} from './gardenLook';
import {edgePaths} from './gardenLife';

export function useMapAhead(map: MowerMap | null) {
  const body = useMowerBody();
  const params = useMowerParams();
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  useEffect(() => {
    const bounds = map && boundsOf(map);
    if (!map || !bounds) return;
    const {scale, padX, padY} = fitIn(bounds);
    const fit = {minX: bounds.minX, minY: bounds.minY, m: scale, padX, padY};
    const garden = settings.mapStyle === 'garden';
    const hidden = hiddenLayers();
    const edgesOn = !!body && layerOn(hidden, 'edges');
    const own = {
      variants: settings.lookVariants,
      sizes: settings.lookSizes,
      turns: settings.lookTurns,
      closed: settings.lookClosed,
      grounds: settings.lookGrounds,
      ...angleOffsetOf(params),
    };
    const steps = [
      () => edgesOn && body && realEdges(map.areas, body),
      () => garden && body && realInsides(map.areas, body),
      () => garden && gardenThings(map.areas, settings.looks, body, fit, own),
      () => edgesOn && body && edgePaths(map.areas, body, fit, !hidden.has('obstacle')),
    ];
    let stop = false;
    const idle = (f: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(f, {timeout: 10000}) : setTimeout(f, 300));
    const next = () => {
      if (stop) return;
      steps.shift()?.();
      if (steps.length) idle(next);
    };
    idle(next);
    return () => {
      stop = true;
    };
  }, [map, body, settings, params]);
}
