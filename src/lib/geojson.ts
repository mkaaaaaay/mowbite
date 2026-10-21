import type {DockingStation, MapArea, MowerMap, Point} from '@/hooks/useMowerMap';
import type {Datum} from './imagery';
import {generateId} from './splitPolygon';
import {toUtm, utmZone} from './utm';

// The map as GeoJSON in longitude and latitude, for QGIS, geojson.io and other map apps, and back. Areas are polygons
// with their properties and id, docking stations points. Read back, an area replaces the one with its id, any other
// comes in as a new one, a draft unless the file says what it is. Holes in a polygon become obstacles.

// 1e-8 degrees, about a millimeter
const round = (v: number) => Math.round(v * 1e8) / 1e8;

// the area properties read from a file, with what each has to be. styles other apps add (stroke, fill) stay out
const KNOWN: Record<string, 'string' | 'boolean' | 'number' | 'object'> = {
  name: 'string',
  type: 'string',
  active: 'boolean',
  mowable: 'boolean',
  mow_around: 'boolean',
  outline_count: 'number',
  outline_overlap_count: 'number',
  outline_offset: 'number',
  angle: 'number',
  angle_min: 'number',
  angle_max: 'number',
  planner: 'object',
  margin: 'number',
};
const TYPES = ['mow', 'nav', 'obstacle', 'draft'];
// farther from the datum than this a file is for another place (or has latitude and longitude swapped)
const FAR = 2000; // m

// local map meters and WGS84, the mower's map frame is utm around its datum (lib/utm)
function frame(datum: Datum) {
  const zone = utmZone(datum.lat, datum.lon);
  const d = toUtm(datum.lat, datum.lon, zone);
  const toLocal = (lon: number, lat: number): Point => {
    const u = toUtm(lat, lon, zone);
    return {x: u.e - d.e, y: u.n - d.n};
  };
  // newton steps on toUtm from the datum, a garden lies a few meters off it, two or three are plenty
  const toLonLat = (p: Point): [number, number] => {
    let [lat, lon] = [datum.lat, datum.lon];
    for (let i = 0; i < 8; i++) {
      const u = toUtm(lat, lon, zone);
      const [de, dn] = [d.e + p.x - u.e, d.n + p.y - u.n];
      if (Math.abs(de) < 1e-5 && Math.abs(dn) < 1e-5) break;
      const h = 1e-6;
      const a = toUtm(lat + h, lon, zone);
      const b = toUtm(lat, lon + h, zone);
      const [ea, eb, na, nb] = [(a.e - u.e) / h, (b.e - u.e) / h, (a.n - u.n) / h, (b.n - u.n) / h];
      const det = ea * nb - eb * na;
      lat += (nb * de - eb * dn) / det;
      lon += (ea * dn - na * de) / det;
    }
    return [round(lon), round(lat)];
  };
  return {toLocal, toLonLat};
}

export function mapToGeoJson(map: MowerMap, datum: Datum) {
  const {toLonLat} = frame(datum);
  // geojson rings are closed, first point repeated at the end
  const ring = (o: Point[]) => [...o, o[0]].map(toLonLat);
  return {
    type: 'FeatureCollection',
    features: [
      ...map.areas.map((a) => ({
        type: 'Feature',
        id: a.id,
        properties: {id: a.id, ...a.properties},
        geometry: {type: 'Polygon', coordinates: [ring(a.outline)]},
      })),
      ...map.docking_stations.map((d) => ({
        type: 'Feature',
        id: d.id,
        properties: {id: d.id, type: 'docking_station', heading: d.heading},
        geometry: {type: 'Point', coordinates: toLonLat(d.position)},
      })),
    ],
  };
}

// what's wrong with a file, the message is for the user
export class GeoJsonError extends Error {}

export const isGeoJson = (json: unknown) =>
  !!json && typeof json === 'object' && ['FeatureCollection', 'Feature'].includes((json as {type?: string}).type ?? '');

interface Feature {
  id?: unknown;
  properties?: Record<string, unknown> | null;
  geometry?: {type?: string; coordinates?: unknown} | null;
}

const isPosition = (c: unknown): c is [number, number] =>
  Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]);
// projected coordinates (utm and the like) are meters, far outside of this
const isLonLat = ([lon, lat]: [number, number]) => Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
// what moves less than this (rounding on the way there and back) stays as it is
const SAME = 0.001; // m
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < SAME;
const sameOutline = (a: Point[], b: Point[]) => a.length === b.length && a.every((p, i) => near(p, b[i]));

// What a geojson file gives the map: base with the file's areas and docking stations in it, what didn't change keeps
// its object. Throws a GeoJsonError when there's nothing to take or it lies somewhere else
export function mapFromGeoJson(json: unknown, datum: Datum, base: MowerMap | null): {map: MowerMap; changed: number; added: number} {
  const {toLocal} = frame(datum);
  const features: Feature[] = (json as {type?: string}).type === 'Feature' ? [json as Feature] : ((json as {features?: Feature[]}).features ?? []);
  const areas = [...(base?.areas ?? [])];
  const docks = [...(base?.docking_stations ?? [])];
  let [changed, added, found, far, projected] = [0, 0, 0, 0, 0];
  const ringOf = (r: unknown): Point[] | null => {
    if (!Array.isArray(r) || !r.every(isPosition)) return null;
    if (!r.every(isLonLat)) {
      projected++;
      return null;
    }
    const o = r.map(([lon, lat]) => toLocal(lon, lat));
    // geojson closes its rings, the editor's outlines are open
    const last = o[o.length - 1];
    const open = o.length > 1 && Math.hypot(o[0].x - last.x, o[0].y - last.y) < 1e-6 ? o.slice(0, -1) : o;
    if (open.some((p) => Math.hypot(p.x, p.y) > FAR)) far++;
    return open.length >= 3 ? open : null;
  };
  const props = (from: Record<string, unknown> | null | undefined) => {
    const out: Record<string, unknown> = {};
    for (const [k, kind] of Object.entries(KNOWN)) {
      const v = from?.[k];
      if (typeof v === kind && v !== null && !Array.isArray(v) && !(kind === 'number' && !Number.isFinite(v))) out[k] = v;
    }
    if (typeof out.type === 'string' && !TYPES.includes(out.type)) delete out.type;
    return out as MapArea['properties'];
  };
  const put = (id: string | null, properties: MapArea['properties'], outline: Point[]) => {
    found++;
    const i = id ? areas.findIndex((a) => a.id === id) : -1;
    if (i >= 0) {
      const was = areas[i];
      const merged = {...was.properties, ...properties};
      const sameProps = JSON.stringify(merged) === JSON.stringify(was.properties);
      const sameShape = sameOutline(outline, was.outline);
      if (sameProps && sameShape) return;
      areas[i] = {...was, properties: sameProps ? was.properties : merged, outline: sameShape ? was.outline : outline};
      changed++;
    } else {
      areas.push({id: id ?? generateId(), properties: {type: 'draft', ...properties}, outline});
      added++;
    }
  };

  for (const f of features) {
    const g = f.geometry;
    const id = typeof f.id === 'string' && f.id ? f.id : typeof f.properties?.id === 'string' && f.properties.id ? f.properties.id : null;
    if (g?.type === 'Point' && isPosition(g.coordinates)) {
      if (f.properties?.type !== 'docking_station') continue;
      if (!isLonLat(g.coordinates)) {
        projected++;
        continue;
      }
      const [lon, lat] = g.coordinates;
      const heading = typeof f.properties.heading === 'number' && Number.isFinite(f.properties.heading) ? f.properties.heading : 0;
      const dock: DockingStation = {id: id ?? generateId(), position: toLocal(lon, lat), heading};
      if (Math.hypot(dock.position.x, dock.position.y) > FAR) far++;
      const i = docks.findIndex((d) => d.id === dock.id);
      if (i < 0) {
        docks.push(dock);
        added++;
      } else if (!near(dock.position, docks[i].position) || dock.heading !== docks[i].heading) {
        docks[i] = dock;
        changed++;
      }
      continue;
    }
    const polygons = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' && Array.isArray(g.coordinates) ? g.coordinates : [];
    polygons.forEach((rings, k) => {
      if (!Array.isArray(rings)) return;
      const outline = ringOf(rings[0]);
      if (!outline) return;
      const p = props(f.properties);
      // the first polygon is the area with the id, more of the same feature come in as new ones
      put(k === 0 ? id : null, p, outline);
      for (const hole of rings.slice(1)) {
        const o = ringOf(hole);
        if (o) put(null, {type: 'obstacle'}, o);
      }
    });
  }
  if (projected) throw new GeoJsonError("The file's coordinates aren't longitude and latitude, it's likely in a projected system like UTM. Save it in WGS84 (EPSG:4326).");
  if (far) throw new GeoJsonError("The file's areas lie more than 2 km from the mower's map, it's likely for another place.");
  if (!found) throw new GeoJsonError('No areas in the file.');
  return {map: {...(base ?? {areas: [], docking_stations: []}), areas, docking_stations: docks}, changed, added};
}
