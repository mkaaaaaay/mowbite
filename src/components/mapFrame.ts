import type {MowerMap, Point} from '@/hooks/useMowerMap';

// The map is drawn into a square of WIDTH by HEIGHT svg units, fitted with PADDING round it
export const WIDTH = 400;
export const HEIGHT = 400;
export const PADDING = 20;
// m, the mower's icon at real size without its sizes known
export const MOWER_SIZE = 0.4;

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// the bounds of the areas' outlines and the points of a line being drawn, null for none
export function boundsOf(map: MowerMap): Bounds | null {
  const points = map.areas.flatMap((a) => a.outline);
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys)};
}

// square viewBox window, in svg units
export interface View {
  x: number;
  y: number;
  size: number;
}

export type Fit = {scale: number; padX: number; padY: number; minX: number; minY: number};
// bounds in the square: svg units per meter and the margins round them, whatever doesn't fill the square centered
export function fitIn({minX, maxX, minY, maxY}: Bounds) {
  const scaleX = (WIDTH - 2 * PADDING) / (maxX - minX || 1);
  const scaleY = (HEIGHT - 2 * PADDING) / (maxY - minY || 1);
  const scale = Math.min(scaleX, scaleY);
  return {scale, padX: PADDING + (WIDTH - 2 * PADDING - (maxX - minX) * scale) / 2, padY: PADDING + (HEIGHT - 2 * PADDING - (maxY - minY) * scale) / 2};
}

// lines in meters as an svg path in the units of the fit
export const pathOf = (lines: readonly (readonly Point[])[], f: Fit, close = false) =>
  lines
    .map((o) => o.map((p, i) => `${i ? 'L' : 'M'}${(p.x - f.minX) * f.scale + f.padX} ${HEIGHT - ((p.y - f.minY) * f.scale + f.padY)}`).join('') + (close ? 'Z' : ''))
    .join('');

export type Meters = {x: number; y: number; span: number};

// a view (center and width in meters) in svg units and back, for the map fitted as given
export function viewFromMeters(m: Meters, f: Fit): View {
  const size = m.span * f.scale;
  return {x: (m.x - f.minX) * f.scale + f.padX - size / 2, y: HEIGHT - ((m.y - f.minY) * f.scale + f.padY) - size / 2, size};
}

export function viewToMeters(v: View, f: Fit): Meters {
  return {x: (v.x + v.size / 2 - f.padX) / f.scale + f.minX, y: (HEIGHT - v.y - v.size / 2 - f.padY) / f.scale + f.minY, span: v.size / f.scale};
}
