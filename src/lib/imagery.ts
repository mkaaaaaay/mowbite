import {toUtm, utmZone} from './utm';

// Official orthophotos of the German states, all open data (checked 2026-09). Saarland isn't here, it
// needs a contract for use in other apps. Anything else the user adds as an xyz tile url in the
// settings and is responsible for its terms.
const YEAR = new Date().getFullYear();

interface WmsSource {
  label: string;
  url: string;
  layer: string;
  // rough lat/lon box of the state, [south, north, west, east]
  box: [number, number, number, number];
  attribution: string;
}

export const STATE_IMAGERY: Record<string, WmsSource> = {
  ni: {
    label: 'Niedersachsen DOP20',
    url: 'https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms',
    layer: 'ni_dop20',
    box: [51.29, 53.9, 6.65, 11.6],
    attribution: `LGLN (${YEAR}) CC BY 4.0`,
  },
  nw: {
    label: 'NRW DOP',
    url: 'https://www.wms.nrw.de/geobasis/wms_nw_dop',
    layer: 'nw_dop_rgb',
    box: [50.32, 52.53, 5.86, 9.46],
    attribution: 'Land NRW, dl-de/zero-2-0',
  },
  by: {
    label: 'Bayern DOP40',
    url: 'https://geoservices.bayern.de/od/wms/dop/v1/dop40',
    layer: 'by_dop40c',
    box: [47.27, 50.57, 8.97, 13.84],
    attribution: 'Bayerische Vermessungsverwaltung, CC BY 4.0',
  },
  be: {
    label: 'Berlin TrueDOP',
    url: 'https://gdi.berlin.de/services/wms/truedop_2024',
    layer: 'truedop_2024',
    box: [52.33, 52.68, 13.08, 13.77],
    attribution: 'Geoportal Berlin, dl-de/zero-2-0',
  },
  bb: {
    label: 'Brandenburg DOP20',
    url: 'https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms',
    layer: 'bebb_dop20c',
    box: [51.36, 53.56, 11.26, 14.77],
    attribution: 'GeoBasis-DE/LGB, dl-de/by-2-0',
  },
  hh: {
    label: 'Hamburg DOP',
    url: 'https://geodienste.hamburg.de/wms_dop_zeitreihe_unbelaubt',
    layer: 'dop_zeitreihe_unbelaubt',
    box: [53.39, 53.74, 9.73, 10.33],
    attribution: 'FHH, LGV, dl-de/by-2-0',
  },
  sn: {
    label: 'Sachsen DOP20',
    url: 'https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest',
    layer: 'sn_dop_020',
    box: [50.17, 51.69, 11.87, 15.04],
    attribution: 'GeoSN, dl-de/by-2-0',
  },
  th: {
    label: 'Thüringen DOP20',
    url: 'https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP20',
    layer: 'th_dop',
    box: [50.2, 51.65, 9.87, 12.65],
    attribution: 'GDI-Th, CC BY 4.0',
  },
  he: {
    label: 'Hessen DOP20',
    url: 'https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows',
    layer: 'he_dop20_rgb',
    box: [49.39, 51.66, 7.77, 10.24],
    attribution: 'HVBG, dl-de/zero-2-0',
  },
  st: {
    label: 'Sachsen-Anhalt DOP20',
    url: 'https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest',
    layer: 'lsa_lvermgeo_dop20_2',
    box: [50.94, 53.05, 10.56, 13.19],
    attribution: 'GeoBasis-DE / LVermGeo ST, dl-de/by-2-0',
  },
  sh: {
    label: 'Schleswig-Holstein DOP20',
    url: 'https://service.gdi-sh.de/WMS_SH_DOP20col_OpenGBD',
    layer: 'sh_dop20_rgb',
    box: [53.36, 55.06, 7.86, 11.32],
    attribution: 'GeoBasis-DE/LVermGeo SH/CC BY 4.0',
  },
  mv: {
    label: 'Mecklenburg-Vorpommern DOP',
    url: 'https://www.geodaten-mv.de/dienste/adv_dop',
    layer: 'mv_dop',
    box: [53.11, 54.69, 10.59, 14.41],
    attribution: `GeoBasis-DE/M-V ${YEAR}`,
  },
  rp: {
    label: 'Rheinland-Pfalz DOP20',
    url: 'https://geo4.service24.rlp.de/wms/rp_dop20.fcgi',
    layer: 'rp_dop20',
    box: [48.97, 50.94, 6.11, 8.51],
    attribution: `GeoBasis-DE / LVermGeoRP (${YEAR}), dl-de/by-2-0`,
  },
  hb: {
    label: 'Bremen DOP20',
    url: 'https://geodienste.bremen.de/wms_dop20_2023',
    layer: 'DOP20_2023_HB',
    box: [53.01, 53.61, 8.48, 8.99],
    attribution: 'Landesamt GeoInformation Bremen, CC BY',
  },
  bw: {
    label: 'Baden-Württemberg DOP20',
    url: 'https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C',
    layer: 'IMAGES_DOP_20_RGB',
    box: [47.53, 49.79, 7.51, 10.5],
    attribution: `LGL-BW (${YEAR}) dl-de/by-2-0`,
  },
};

// a state key from STATE_IMAGERY, or the user's own xyz source
export type ImagerySource = string;

export interface CustomImagery {
  url?: string;
  attribution?: string;
}

// needs the three placeholders, http(s) only
export function isTileUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//.test(url) && ['{z}', '{x}', '{y}'].every((p) => url.includes(p));
}

export function imageryInfo(source: ImagerySource, custom?: CustomImagery): {label: string; attribution: string} {
  const state = STATE_IMAGERY[source];
  if (state) return {label: state.label, attribution: state.attribution};
  let host = '';
  try {
    host = new URL(custom?.url ?? '').host;
  } catch {}
  return {label: 'Own source', attribution: custom?.attribution?.trim() || host};
}

export interface Datum {
  lat: number;
  lon: number;
}

// the states whose box contains the mower (neighbours overlap a bit), then the own source.
// the wms tiles are requested in the map's utm zone, the services only offer 32 and 33
export function availableSources(datum: Datum, custom?: CustomImagery): ImagerySource[] {
  const out: ImagerySource[] = [];
  const zone = utmZone(datum.lat, datum.lon);
  if (zone === 32 || zone === 33) {
    for (const [key, st] of Object.entries(STATE_IMAGERY)) {
      const [s, n, w, e] = st.box;
      if (datum.lat >= s && datum.lat <= n && datum.lon >= w && datum.lon <= e) out.push(key);
    }
  }
  if (isTileUrl(custom?.url)) out.push('custom');
  return out;
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
function wmsTiles(src: WmsSource, datum: Datum, v: View): ImageryTile[] {
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
        `${src.url}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${src.layer}&STYLES=` +
        `&CRS=EPSG:258${zone}&BBOX=${e},${n},${e + span},${n + span}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg`;
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

// web mercator xyz tiles, each one placed by its corners in utm so the slight rotation is right
function xyzTiles(template: string, datum: Datum, v: View): ImageryTile[] {
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
        href: template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)),
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

export function imageryTiles(source: ImagerySource, datum: Datum, v: View, custom?: CustomImagery): ImageryTile[] {
  const state = STATE_IMAGERY[source];
  if (state) return wmsTiles(state, datum, v);
  return source === 'custom' && isTileUrl(custom?.url) ? xyzTiles(custom.url, datum, v) : [];
}
