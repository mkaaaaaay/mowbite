'use client';

import type {ImagerySource} from '@/lib/imagery';
import {readMower, writeMower} from '@/lib/mowers';
import {useSyncExternalStore} from 'react';
import type {Coverage, Layer, PlanStyle} from './MapControls';

function read<T>(key: string, parse: (v: string | null) => T, fallback: T): T {
  try {
    return parse(localStorage.getItem(key));
  } catch {
    return fallback;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

const COVERAGE_KEY = 'mapCoverage';

interface MapPrefs {
  // off by default, it sends the map area to the imagery provider
  imagery: ImagerySource | null;
  // the source picked last, kept while the imagery is off so switching it on brings it back
  lastImagery: ImagerySource | null;
  showGrid: boolean;
  hidden: Set<Layer>;
  planStyle: PlanStyle;
  // each mower's own, its container keeps the gps log
  coverage: Coverage;
}

function load(): MapPrefs {
  const imagery = read('mapImagery', (v) => (v as ImagerySource | null) || null, null);
  const coverage = readMower<Coverage>(COVERAGE_KEY);
  return {
    imagery,
    lastImagery: read('mapImageryLast', (v) => (v as ImagerySource | null) || null, null) ?? imagery,
    showGrid: read('mapGrid', (v) => v !== 'off', true),
    hidden: read('mapHidden', (v) => new Set<Layer>(JSON.parse(v ?? '[]')), new Set<Layer>()),
    planStyle: read<PlanStyle>('planStyle', (v) => (v === 'solid' || v === 'dots' ? v : 'dashed'), 'dashed'),
    coverage: coverage === 'gps' || coverage === 'wifi' ? coverage : 'off',
  };
}

// one for every map of the page, what one switches the others show (the editor stays drawn behind the dashboard)
let prefs: MapPrefs | null = null;
const listeners = new Set<() => void>();
const snapshot = () => (prefs ??= load());
function set(change: Partial<MapPrefs>) {
  prefs = {...snapshot(), ...change};
  listeners.forEach((l) => l());
}

// the layers switched off in the map's menu on this device
export const hiddenLayers = () => snapshot().hidden;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// How the map is shown on this device: aerial imagery, the grid, the layers switched off in the menu, the style of
// what's left of a plan and the coverage. Each change goes on from what's there now and is kept at once.
export const mapPrefs = snapshot;
export const changeMapPrefs = {
  setCoverage: (c: Coverage) => {
    set({coverage: c});
    writeMower(COVERAGE_KEY, c === 'off' ? null : c);
  },
  setImagery: (next: ImagerySource | null) => {
    set(next ? {imagery: next, lastImagery: next} : {imagery: null});
    write('mapImagery', next);
    if (next) write('mapImageryLast', next);
  },
  toggleGrid: () => {
    const showGrid = !snapshot().showGrid;
    set({showGrid});
    write('mapGrid', showGrid ? 'on' : 'off');
  },
  toggleLayer: (l: Layer) => {
    const hidden = new Set(snapshot().hidden);
    if (hidden.has(l)) hidden.delete(l);
    else hidden.add(l);
    set({hidden});
    write('mapHidden', JSON.stringify([...hidden]));
  },
  setPlanStyle: (planStyle: PlanStyle) => {
    set({planStyle});
    write('planStyle', planStyle);
  },
};

// only used once the map arrived, client side, so localStorage is there
export function useMapPrefs() {
  return {...useSyncExternalStore(subscribe, snapshot, snapshot), ...changeMapPrefs};
}
