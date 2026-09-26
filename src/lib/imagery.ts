import {toUtm, utmZone} from './utm';

export type ImagerySource = 'esri' | 'lgln';

export const IMAGERY: Record<ImagerySource, {label: string; attribution: string}> = {
  esri: {label: 'Esri World Imagery', attribution: 'Esri, Vantor, Earthstar Geographics, GIS User Community'},
  lgln: {label: 'Niedersachsen DOP20', attribution: `LGLN (${new Date().getFullYear()}) CC BY 4.0`},
};

export interface Datum {
  lat: number;
  lon: number;
}

// lgln only covers lower saxony and serves utm zone 32 directly
export function availableSources(datum: Datum): ImagerySource[] {
  const inNds = datum.lat > 51.2 && datum.lat < 54.2 && datum.lon > 6.6 && datum.lon < 11.7;
  return inNds && utmZone(datum.lat, datum.lon) === 32 ? ['lgln', 'esri'] : ['esri'];
}

// one image on the map, local meters are turned into svg units by the caller
export interface ImageryTile {
  href: string;
  // local map coords of the tile's top left, top right and bottom left corner
  corners: [{x: number; y: number}, {x: number; y: number}, {x: number; y: number}];
}

interface View {
  left: number;
  right: number;
  bottom: number;
  top: number;
  metersPerPixel: number;
}

const MAX_TILES = 120;

// wms tiles on a grid in utm space, so they line up exactly with the map and get cached by the browser
function lglnTiles(datum: Datum, v: View): ImageryTile[] {
  const zone = utmZone(datum.lat, datum.lon);
  const d = toUtm(datum.lat, datum.lon, zone);
  const res = 2 ** Math.max(-3, Math.min(5, Math.floor(Math.log2(v.metersPerPixel))));
  const span = 256 * res;
  const x0 = Math.floor((d.e + v.left) / span);
  const x1 = Math.floor((d.e + v.right) / span);
  const y0 = Math.floor((d.n + v.bottom) / span);
  const y1 = Math.floor((d.n + v.top) / span);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return [];

  const tiles: ImageryTile[] = [];
  for (let ix = x0; ix <= x1; ix++) {
    for (let iy = y0; iy <= y1; iy++) {
      const e = ix * span;
      const n = iy * span;
      const href =
        'https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
        `&LAYERS=ni_dop20&STYLES=&CRS=EPSG:25832&BBOX=${e},${n},${e + span},${n + span}` +
        '&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg';
      const x = e - d.e;
      const y = n - d.n;
      tiles.push({
        href,
        corners: [
          {x, y: y + span},
          {x: x + span, y: y + span},
          {x, y},
        ],
      });
    }
  }
  return tiles;
}

const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

// web mercator tiles, each one placed by its corners in utm so the slight rotation is right
function esriTiles(datum: Datum, v: View): ImageryTile[] {
  const zone = utmZone(datum.lat, datum.lon);
  const d = toUtm(datum.lat, datum.lon, zone);
  const cosLat = Math.cos((datum.lat * Math.PI) / 180);
  const z = Math.max(3, Math.min(19, Math.round(Math.log2((156543.03 * cosLat) / v.metersPerPixel))));

  // rough lat/lon of the view, only used to pick tiles, one tile of margin covers the error
  const toLat = (y: number) => datum.lat + y / 111320;
  const toLon = (x: number) => datum.lon + x / (111320 * cosLat);
  const tx = (lon: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const ty = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  };
  const x0 = tx(toLon(v.left)) - 1;
  const x1 = tx(toLon(v.right)) + 1;
  const y0 = ty(toLat(v.top)) - 1;
  const y1 = ty(toLat(v.bottom)) + 1;
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return [];

  const local = (lat: number, lon: number) => {
    const u = toUtm(lat, lon, zone);
    return {x: u.e - d.e, y: u.n - d.n};
  };
  const tiles: ImageryTile[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      tiles.push({
        href: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
        corners: [
          local(tileLat(y, z), tileLon(x, z)),
          local(tileLat(y, z), tileLon(x + 1, z)),
          local(tileLat(y + 1, z), tileLon(x, z)),
        ],
      });
    }
  }
  return tiles;
}

export function imageryTiles(source: ImagerySource, datum: Datum, v: View): ImageryTile[] {
  return source === 'lgln' ? lglnTiles(datum, v) : esriTiles(datum, v);
}
