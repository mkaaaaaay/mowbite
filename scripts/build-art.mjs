// builds mowbite-art.js for the home assistant card: the map's pictures (mower and dock icons, the garden style, the
// mower's body and the real edges) as plain functions that return svg strings. the app's own sources are compiled with
// its typescript, art-runtime.js turns their jsx into strings, art-exports.js is what the card calls (ART_API counts up
// when a signature changes). the container serves the file next to the app, version.json then says "art": ART_API
//
//   node scripts/build-art.mjs [dir]   after the build, dir is out/ by default

import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..');
const dir = path.resolve(process.argv[2] ?? path.join(app, 'out'));
const ts = createRequire(path.join(app, 'package.json'))('typescript');

// the app's modules the pictures need, by the name they're imported with
const MODULES = {
  '@/components/mapIcons': 'src/components/mapIcons.tsx',
  '@/components/openmowerArt': 'src/components/openmowerArt.ts',
  '@/components/gardenPictures': 'src/components/gardenPictures.tsx',
  '@/components/gardenLook': 'src/components/gardenLook.tsx',
  '@/components/gardenLife': 'src/components/gardenLife.tsx',
  '@/lib/geometry': 'src/lib/geometry.ts',
  '@/lib/mowStripes': 'src/lib/mowStripes.ts',
  '@/lib/mowerBody': 'src/lib/mowerBody.ts',
  '@/lib/sun': 'src/lib/sun.ts',
  // the real edges' polygon clipping (Boost Software License)
  'clipper-lib': 'node_modules/clipper-lib/clipper.js',
};

// what they import that only the app's pages use
const STUBS = {
  react: 'module.exports = {useId, useEffect() {}, useMemo: (f) => f(), useState: (v) => [v, () => {}]};',
  'react-dom': 'module.exports = {createPortal: () => null};',
  '@/lib/i18n': 'module.exports = {tr: (s) => s};',
  '@/hooks/useMowerMap': 'module.exports = {};',
  // what mowerBody needs only for asking the planner and keeping the app's settings
  '@/lib/mowers': 'module.exports = {apiBase: () => ""};',
  '@/lib/openmower': 'module.exports = {RPC: {}};',
  '@/lib/rpc': 'module.exports = {callRpc: async () => null, isMissingMethod: () => true, rpcMethods: async () => []};',
  '@/lib/settings': 'module.exports = {saveSettings() {}, syncSettings() {}, settingsStore: {get: () => ({}), subscribe: () => () => {}}};',
  '@/lib/areaPlan': 'module.exports = {};',
  // a css module's class names as they are (import styles from: its default)
  css: 'const names = new Proxy({}, {get: (_, k) => (k === "default" ? names : String(k))}); module.exports = names;',
};

function resolve(from, spec) {
  if (spec.endsWith('.css')) return 'css';
  if (STUBS[spec]) return spec;
  let name = spec;
  if (spec.startsWith('.')) name = path.posix.join(path.posix.dirname(MODULES[from].replace(/^src\//, '@/')), spec);
  if (STUBS[name]) return name;
  if (!MODULES[name]) throw new Error(`${from} imports ${spec}, add it to MODULES or STUBS in scripts/build-art.mjs`);
  return name;
}

const define = (name, code) => `define(${JSON.stringify(name)}, function (module, exports, require) {\n${code}\n});\n`;
let body = '';
for (const [name, file] of Object.entries(MODULES)) {
  const source = fs.readFileSync(path.join(app, file), 'utf8');
  const js = file.endsWith('.js')
    ? source
    : ts.transpileModule(source, {
        fileName: file,
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          jsx: ts.JsxEmit.React,
          jsxFactory: '__jsx',
          jsxFragmentFactory: '__Fragment',
          esModuleInterop: false,
          removeComments: true,
        },
      }).outputText;
  body += define(name, js.replace(/require\("([^"]+)"\)/g, (_, spec) => `require(${JSON.stringify(resolve(name, spec))})`));
}
for (const [name, code] of Object.entries(STUBS)) body += define(name, code);

// the version from the build's version.json (no git in the container build)
const versionFile = path.join(dir, 'version.json');
const info = fs.existsSync(versionFile) ? JSON.parse(fs.readFileSync(versionFile, 'utf8')) : {};
const version = info.version ?? JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version;
const exportsSource = fs.readFileSync(path.join(here, 'art-exports.js'), 'utf8');
const api = Number(/export const ART_API = (\d+);/.exec(exportsSource)?.[1]);
if (!api) throw new Error('art-exports.js has no ART_API');

const file = path.join(dir, 'mowbite-art.js');
fs.writeFileSync(
  file,
  `// mowbite-art.js from MowBite ${version} (GPL-3.0), built by scripts/build-art.mjs from src/components/mapIcons.tsx,
// gardenPictures.tsx, gardenLook.tsx, gardenLife.tsx, openmowerArt.ts, src/lib/geometry.ts, mowStripes.ts, mowerBody.ts,
// sun.ts. Don't edit.
/* eslint-disable */
${fs.readFileSync(path.join(here, 'art-runtime.js'), 'utf8')}
${body}
${exportsSource}`,
);

// the garden's life with every part on: an autumn evening (sun low, leaves, shadows) and a winter night in the snow
function lifeScenes(art, square) {
  const lawn = square.map(({x, y}) => ({x: x * 2, y: y * 2}));
  const areas = [
    {id: 'lawn', properties: {type: 'mow', name: 'Lawn'}, outline: lawn},
    {id: 'tree', properties: {type: 'obstacle', name: 'Tree'}, outline: [[6, 3], [9, 3], [9, 6], [6, 6]].map(([x, y]) => ({x, y}))},
  ];
  const job = {job_id: 'j', timestamp: 0, segments: [{attributes: {blades: true}, points: [[1, 1], [14, 1], [14, 2], [1, 2]]}]};
  const base = {
    areas,
    garden: {sun: true, season: true, growth: true, edge: true},
    body: art.sizesBody({width: 0.4, front: 0.4, rear: 0.15}),
    fit: {minX: 0, minY: 0, m: 20, padX: 20, padY: 20},
    uid: 't',
    datum: {lat: 52.4, lon: 9.7},
    mower: {x: 3, y: 3},
    track: [[{x: 2, y: 4, b: true}, {x: 10, y: 4, b: true}, {x: 10, y: 5, b: false}]],
  };
  const autumn = Date.UTC(2026, 9, 19, 15, 40);
  const winter = Date.UTC(2026, 11, 20, 21, 0);
  const scenes = [
    art.gardenLife({...base, now: autumn, jobs: [{...job, timestamp: autumn / 1000 - 86400}]}),
    art.gardenLife({...base, now: winter, jobs: [{...job, timestamp: winter / 1000 - 3 * 86400}], weather: {code: 73, temp: -2, raining: false}, edgeLine: null}),
  ];
  const [evening, night] = scenes;
  const has = (svg, what) => {
    if (!svg.includes(what)) throw new Error(`the garden's life misses ${what}: ${svg.slice(0, 300)}`);
  };
  has(evening.lawn, 'cutThere');
  has(evening.lawn, 'rotate(');
  has(evening.things, 'thingShadow');
  has(evening.stones, 'stoneTop');
  has(evening.sky, '#ff9a4d');
  has(night.lawn, 'url(#tfrost)');
  has(night.sky, 'url(#tnight)');
  if (!evening.long || art.gardenLife({...base, garden: {}}) !== null) throw new Error("the garden's life is on when it shouldn't be");
  return scenes.flatMap((s) => [s.defs, s.lawn, s.things, s.stones, s.sky]);
}

// every picture drawn once: nothing may throw, and nothing that home assistant strips from its svgs or that shows a bug.
// a file that fails goes again, the container is then built without it
let drawn;
try {
  // as a data url: node takes it as a module without a package.json saying so
  const art = await import('data:text/javascript;base64,' + fs.readFileSync(file).toString('base64'));
  const square = [[0, 0], [8, 0], [8, 5], [0, 5]].map(([x, y]) => ({x, y}));
  drawn = [
    ...art.MOWER_KEYS.flatMap((key) => [
      art.mowerIcon(key).draw({speed: 0.5, blades: true}),
      art.mowerIcon(key).draw({emergency: true}),
    ]),
    ...art.DOCK_KEYS.map((key) => art.dockIcon(key).draw()),
    ...art.PICTURE_KEYS.filter(art.isThing).map((look) => art.drawThing(look, {x: -4, y: -3, w: 8, h: 6})),
    ...art.PICTURE_KEYS.filter(art.isThing).map((look) => art.drawThing(look, {x: -40, y: -30, w: 80, h: 60}, 'm', 'a', undefined, 20)),
    art.gardenDefs('t', 20, [0.4], ['0,0 160,0 160,100']),
    art.lifeDefs('t', 20),
    art.drawSprinkle({x: 10, y: 10, turn: 30, color: '#c8642a'}, 20, 'autumn'),
    ...lifeScenes(art, square),
  ];
  // an empty class is a css module's name that didn't come through
  const wrong = drawn.findIndex((svg) => typeof svg !== 'string' || !svg.startsWith('<') || /<script|<foreignObject|\son[a-z]+=|NaN|\[object|class=""/i.test(svg));
  if (wrong >= 0) throw new Error(`picture ${wrong} came out wrong: ${String(drawn[wrong]).slice(0, 200)}`);
  art.placeThing('table', square);
  if (art.placeThings('bush', square, 1, 'a').length < 2) throw new Error('placeThings put one bush into a big bed');
  art.realEdges([{id: 'a', properties: {type: 'mow'}, outline: square}], art.sizesBody({width: 0.4, front: 0.4, rear: 0.15}));
} catch (e) {
  fs.rmSync(file);
  throw e;
}

if (fs.existsSync(versionFile)) fs.writeFileSync(versionFile, JSON.stringify({...info, art: api}) + '\n');
console.log(`${path.relative(process.cwd(), file)}: ${(fs.statSync(file).size / 1024).toFixed(0)} KB, ${drawn.length} pictures, art ${api}`);
