// The pictures of the garden map style, from above with the light from the top left like the guides. A thing is drawn
// into a box in its area (svg units, y down) about as big as it really is, cut to the area's outline by the map unless it
// reaches over it (a crown, a parasol), with a ground around it.
// Its gradients and clips get ids starting with p, every drawing its own, and p varies it a little: two trees on a map
// aren't the same tree. A ground is a texture in meters, it grows and shrinks with the map.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Group = 'trees' | 'plants' | 'beds' | 'water' | 'play' | 'buildings' | 'outdoor' | 'other' | 'ways' | 'ground';
export const GROUPS: {key: Group; label: string}[] = [
  {key: 'trees', label: 'Trees and shrubs'},
  {key: 'plants', label: 'Perennials and grasses'},
  {key: 'beds', label: 'Beds'},
  {key: 'water', label: 'Water'},
  {key: 'play', label: 'Play'},
  {key: 'buildings', label: 'Buildings'},
  {key: 'outdoor', label: 'Sitting and fire'},
  {key: 'other', label: 'Other'},
  {key: 'ways', label: 'Steps and paths'},
  {key: 'ground', label: 'Ground'},
];

// a texture: w by h meters on a base color, what's on it drawn with m svg units per meter
interface Tile {
  w: number;
  h: number;
  base: string;
  draw: (m: number) => React.ReactNode;
}
// how a thing is drawn: seed varies it (the area's id, the same tree every time), variant is a color picked for it
export interface ThingOptions {
  seed: string;
  variant?: string;
  // svg units per meter, for what has a size of its own (a step, a chair), else worked out from the box
  m?: number;
  // a bed's real edge in the box's units, for a border along it
  edge?: [number, number][];
  // a parasol folded up
  closed?: boolean;
  // a bed drawn as one tile of a pattern repeating it: its plants run round the tile's edges, no border. border: only a
  // bed's border along its edge
  tile?: boolean;
  border?: boolean;
}
export interface Picture {
  label: string;
  group: Group;
  // a thing: drawn into the box with ids starting with p, with this ground around it. long: drawn along the area's long
  // side into the box that fits in it, else into the biggest circle that fits in it
  thing?: (b: Box, p: string, o: ThingOptions) => React.ReactNode;
  // the colors it comes in, picked per area (settings.lookVariants), else one by its seed
  variants?: {key: string; label: string}[];
  around?: string;
  long?: boolean;
  // how big it really is in meters, from to: across, a long one along. in a bigger area it's drawn no bigger, the
  // ground round it. deep: at most so deep across a long one
  size?: [number, number];
  deep?: number;
  // reaches over its area like a crown or a parasol (the area is just its foot): drawn at least size[0] across round the
  // area's middle and not cut to it
  over?: boolean;
  // a bigger area gets several of them (bushes, trees, planters)
  many?: boolean;
  // a way can be drawn as it too (steps, a bridge), any other thing only an obstacle
  way?: boolean;
  // fills its whole area like a ground, but planted anew for every area (a bed). span: the meters before it repeats
  fill?: boolean;
  span?: number;
  // faces a way: turned by the place (settings.lookTurns, else towards what it belongs to)
  turn?: boolean;
  // looks the same turned any way (a crown, a round pool): nothing to turn
  round?: boolean;
  // a parasol: it can be folded up (settings.lookClosed)
  folds?: boolean;
  // a bed with a border along its real edge (ThingOptions.edge)
  edged?: boolean;
  // a ground: the texture
  tile?: Tile;
}

type Pt = [number, number];
type Dot = [number, number, number];

const PI = Math.PI;
// short numbers for paths and points
const n2 = (v: number) => Math.round(v * 100) / 100;

// a color lighter (t up to 1, towards white) or darker (t down to -1, towards black)
export function tone(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t)));
  return '#' + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

// the same random numbers between 0 and 1 for the same seed
export function random(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let s = ((h >>> 0) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const middle = (b: Box) => ({cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.min(b.w, b.h) / 2});
const inset = (b: Box, f: number): Box => {
  const d = Math.min(b.w, b.h) * f;
  return {x: b.x + d, y: b.y + d, w: b.w - 2 * d, h: b.h - 2 * d};
};
// drawn lying along the longer side of the box: l long, d deep, around 0,0
const along = (b: Box, draw: (l: number, d: number) => React.ReactNode) => (
  <g transform={`translate(${n2(b.x + b.w / 2)} ${n2(b.y + b.h / 2)})${b.w >= b.h ? '' : ' rotate(90)'}`}>{draw(Math.max(b.w, b.h), Math.min(b.w, b.h))}</g>
);

// circles as one path: many leaves or pebbles are one element
const circles = (list: Dot[]) =>
  list.map(([x, y, r]) => `M${n2(x - r)} ${n2(y)}a${n2(r)} ${n2(r)} 0 1 0 ${n2(2 * r)} 0a${n2(r)} ${n2(r)} 0 1 0 ${n2(-2 * r)} 0`).join('');
const poly = (pts: Pt[]) => pts.map(([x, y]) => `${n2(x)},${n2(y)}`).join(' ');

// a closed smooth line through the points
function smooth(pts: Pt[]): string {
  const n = pts.length;
  let d = `M${n2(pts[0][0])} ${n2(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const [a, b, c, e] = [pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]];
    d += `C${n2(b[0] + (c[0] - a[0]) / 6)} ${n2(b[1] + (c[1] - a[1]) / 6)} ${n2(c[0] - (e[0] - b[0]) / 6)} ${n2(c[1] - (e[1] - b[1]) / 6)} ${n2(c[0])} ${n2(c[1])}`;
  }
  return d + 'Z';
}

// an ellipse whose edge wanders in and out by up to wobble of it
function blob(cx: number, cy: number, rx: number, ry: number, rnd: () => number, n = 12, wobble = 0.12): Pt[] {
  const [a, b, c] = [rnd() * 2 * PI, rnd() * 2 * PI, rnd() * 2 * PI];
  return Array.from({length: n}, (_, i) => {
    const t = (i / n) * 2 * PI;
    const k = 1 + wobble * (0.5 * Math.sin(2 * t + a) + 0.3 * Math.sin(3 * t + b) + 0.2 * Math.sin(5 * t + c));
    return [cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k];
  });
}

// points scattered over a circle, f picks how far out (sqrt: evenly)
const scatter = (rnd: () => number, n: number, cx: number, cy: number, r: number, size: [number, number], f = Math.sqrt): Dot[] =>
  Array.from({length: n}, () => {
    const a = rnd() * 2 * PI;
    const d = r * f(rnd());
    return [cx + Math.cos(a) * d, cy + Math.sin(a) * d, size[0] + rnd() * (size[1] - size[0])];
  });
// up left of the middle, where the light comes from
const litSide = (s: Dot, cx: number, cy: number) => s[0] - cx + (s[1] - cy) < 0;

// the gradients, each in the box of what it fills. a round thing lit from the top left: bright up left, dark down right
const ball = (id: string, c: string, lit = 0.3, deep = -0.38) => (
  <radialGradient id={id} cx={0.45} cy={0.42} r={0.62} fx={0.3} fy={0.26}>
    <stop offset={0} stopColor={tone(c, lit)} />
    <stop offset={0.55} stopColor={c} />
    <stop offset={1} stopColor={tone(c, deep)} />
  </radialGradient>
);
// a flat face, a little lighter up left
const face = (id: string, c: string, lit = 0.1, deep = -0.12) => (
  <linearGradient id={id} x1={0} y1={0} x2={1} y2={1}>
    <stop offset={0} stopColor={tone(c, lit)} />
    <stop offset={1} stopColor={tone(c, deep)} />
  </linearGradient>
);
// a log or a bar lying along x: its upper side in the light
const tube = (id: string, c: string, vertical = false) => (
  <linearGradient id={id} x1={0} y1={0} x2={vertical ? 1 : 0} y2={vertical ? 0 : 1}>
    <stop offset={0} stopColor={tone(c, 0.28)} />
    <stop offset={0.45} stopColor={c} />
    <stop offset={1} stopColor={tone(c, -0.4)} />
  </linearGradient>
);
// water: lighter where it's shallow at the edge
const deep = (id: string, c: string) => (
  <radialGradient id={id} cx={0.5} cy={0.55} r={0.6}>
    <stop offset={0} stopColor={tone(c, -0.28)} />
    <stop offset={0.7} stopColor={c} />
    <stop offset={1} stopColor={tone(c, 0.3)} />
  </radialGradient>
);

// the soft shadow round the foot of a thing. a shadow cast by the sun leaves it out (data-halo)
const halo = (id: string, cx: number, cy: number, rx: number, ry = rx, k = 0.34) => (
  <>
    <defs>
      <radialGradient id={id}>
        <stop offset={0.45} stopColor="#000" stopOpacity={k} />
        <stop offset={1} stopColor="#000" stopOpacity={0} />
      </radialGradient>
    </defs>
    <ellipse data-halo="" cx={n2(cx + rx * 0.04)} cy={n2(cy + ry * 0.06)} rx={n2(rx)} ry={n2(ry)} fill={`url(#${id})`} />
  </>
);
// the soft shadow under something with corners, three layers growing out
const softBox = (x: number, y: number, w: number, h: number, rx: number, s: number) => (
  <g data-halo="">
    {[1, 0.6, 0.3].map((g, i) => (
      <rect key={i} x={n2(x - s * g + s * 0.3)} y={n2(y - s * g + s * 0.45)} width={n2(w + 2 * s * g)} height={n2(h + 2 * s * g)} rx={n2(rx + s * g)} fill="#000" opacity={0.09} />
    ))}
  </g>
);
// a thin highlight along the edge up left of a round thing
const rimLight = (cx: number, cy: number, r: number, w: number, o = 0.4) => (
  <path d={`M${n2(cx - r * 0.94)} ${n2(cy + r * 0.34)}A${n2(r)} ${n2(r)} 0 0 1 ${n2(cx + r * 0.34)} ${n2(cy - r * 0.94)}`} stroke="#fff" strokeOpacity={o} strokeWidth={n2(w)} fill="none" strokeLinecap="round" />
);

// a crown of leaves: lobes round the middle and over it that run into each other, each with clumps of leaves lit
// from the top left and shaded down right, a ragged edge of small clumps. the lobes down right of the middle are a
// little darker, the whole crown is lit from the top left
function crown(p: string, cx: number, cy: number, r: number, c: string, rnd: () => number, lobes = 8, size = 0.37, leaves = 10) {
  const ring = (count: number, dist: number, k: number, turn: number): Dot[] =>
    Array.from({length: count}, (_, i) => {
      const a = turn + ((i + (rnd() - 0.5) * 0.5) / count) * 2 * PI;
      const d = r * dist * (0.92 + rnd() * 0.14);
      return [cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * k * (0.86 + rnd() * 0.28)];
    });
  const outer = ring(lobes, 0.52, size, rnd() * 2 * PI);
  const all: Dot[] = [...outer, ...ring(Math.max(3, lobes - 4), 0.24, size * 0.98, rnd() * 2 * PI), [cx - r * 0.05, cy - r * 0.07, r * size * 0.82]];
  // small clumps round the outside of the outer lobes: the crown's ragged edge
  const edge: Dot[] = outer.flatMap(([x, y, rr]) => {
    const a = Math.atan2(y - cy, x - cx);
    return [-0.45, 0, 0.45].map((da): Dot => {
      const d = Math.hypot(x - cx, y - cy) + rr * (0.72 + rnd() * 0.12);
      return [cx + Math.cos(a + da * (0.7 + rnd() * 0.3)) * d, cy + Math.sin(a + da * (0.7 + rnd() * 0.3)) * d, rr * (0.28 + rnd() * 0.12)];
    });
  });
  // on every lobe clumps in the light up left and in the shade down right
  const lit: Dot[] = [];
  const dark: Dot[] = [];
  for (const [x, y, rr] of all) {
    for (let k = 0; k < 2; k++) lit.push([x - rr * (0.25 + rnd() * 0.25), y - rr * (0.25 + rnd() * 0.25), rr * (0.18 + rnd() * 0.12)]);
    dark.push([x + rr * (0.25 + rnd() * 0.25), y + rr * (0.3 + rnd() * 0.25), rr * (0.18 + rnd() * 0.1)]);
  }
  const specks = scatter(rnd, leaves, cx, cy, r * 0.85, [r * 0.014, r * 0.028]);
  // one light over the whole crown, the lobes shaped by a lighter cap up left and the clumps
  return (
    <>
      <defs>
        <radialGradient id={p + 'l'} cx={0.42} cy={0.4} r={0.62} fx={0.32} fy={0.3}>
          <stop offset={0} stopColor={tone(c, 0.14)} />
          <stop offset={0.55} stopColor={c} />
          <stop offset={1} stopColor={tone(c, -0.3)} />
        </radialGradient>
      </defs>
      <path d={circles([...outer, ...edge])} fill={tone(c, -0.5)} transform={`translate(${n2(r * 0.03)} ${n2(r * 0.045)})`} />
      <path d={circles(edge.filter((e) => litSide(e, cx, cy)))} fill={tone(c, 0.02)} />
      <path d={circles(edge.filter((e) => !litSide(e, cx, cy)))} fill={tone(c, -0.22)} />
      <path d={circles(all)} fill={`url(#${p}l)`} stroke={tone(c, -0.4)} strokeOpacity={0.22} strokeWidth={n2(r * 0.012)} />
      <path d={circles(all.map(([x, y, rr]) => [x - rr * 0.22, y - rr * 0.25, rr * 0.58]))} fill={tone(c, 0.16)} opacity={0.42} />
      <path d={circles(dark)} fill={tone(c, -0.32)} opacity={0.5} />
      <path d={circles(lit)} fill={tone(c, 0.26)} opacity={0.5} />
      <path d={circles(specks)} fill={tone(c, -0.5)} opacity={0.45} />
    </>
  );
}

// a crown, a big one (meters across, from 6 on) as several crowns of branches leaning together, the ones up left lying
// over the others in the light
function bigCrown(p: string, cx: number, cy: number, r: number, c: string, rnd: () => number, meters: number) {
  if (meters < 6) return crown(p, cx, cy, r, c, rnd);
  const n = Math.min(9, Math.round(meters / 1.6));
  const parts = Array.from({length: n}, (_, i): Dot => {
    const a = ((i + rnd() * 0.5) / n) * 2 * PI;
    return [cx + Math.cos(a) * r * 0.52, cy + Math.sin(a) * r * 0.52, r * (0.46 + rnd() * 0.08)];
  }).sort((a, e) => e[0] + e[1] - (a[0] + a[1]));
  return (
    <>
      {parts.map(([x, y, rr], i) => (
        <g key={i}>{crown(`${p}c${i}`, x, y, rr, tone(c, ((cx - x + cy - y) / r) * 0.08), rnd, 8, 0.37, 4)}</g>
      ))}
      {crown(`${p}cm`, cx - r * 0.04, cy - r * 0.05, r * 0.5, tone(c, 0.05), rnd, 8, 0.37, 4)}
    </>
  );
}

// a parasol folded up, from above: its cloth hanging in folds round the pole, r out from it, a strap round them, the top
// in the middle
function folded(cx: number, cy: number, r: number, c: string, c2: string) {
  const folds = Array.from({length: 8}, (_, i) => {
    const a = ((i + 0.5) / 8) * 2 * PI;
    const [x1, y1, x2, y2] = [cx + Math.cos(a - 0.22) * r, cy + Math.sin(a - 0.22) * r, cx + Math.cos(a + 0.22) * r, cy + Math.sin(a + 0.22) * r];
    return {a, d: `M${n2(cx)} ${n2(cy)}L${n2(x1)} ${n2(y1)}Q${n2(cx + Math.cos(a) * r * 1.3)} ${n2(cy + Math.sin(a) * r * 1.3)} ${n2(x2)} ${n2(y2)}Z`, c: i % 2 ? c2 : c};
  });
  return (
    <>
      <path d={circles([[cx + r * 0.2, cy + r * 0.3, r * 1.15]])} fill="#000" opacity={0.25} data-halo="" />
      {folds.map((f, i) => (
        <path key={i} d={f.d} fill={tone(f.c, Math.cos(f.a + (3 * PI) / 4) * 0.16 - 0.04)} stroke={tone(c, -0.38)} strokeWidth={n2(r * 0.04)} strokeLinejoin="round" />
      ))}
      <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.55)} fill="none" stroke="#5a4a3a" strokeWidth={n2(r * 0.12)} />
      <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.22)} fill={tone(c, -0.1)} stroke={tone(c, -0.4)} strokeWidth={n2(r * 0.04)} />
      <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.09)} fill="#7a5c3a" />
    </>
  );
}

// flowers: dots of petals round a middle, as few elements as there are colors
function blossoms(list: [number, number, number, string][], petals = 5) {
  const byColor = new Map<string, Dot[]>();
  const hearts: Dot[] = [];
  for (const [x, y, s, c] of list) {
    const dots = byColor.get(c) ?? [];
    for (let k = 0; k < petals; k++) {
      const a = (k / petals) * 2 * PI + x;
      dots.push([x + Math.cos(a) * s * 0.55, y + Math.sin(a) * s * 0.55, s * 0.42]);
    }
    byColor.set(c, dots);
    hearts.push([x, y, s * 0.28]);
  }
  return (
    <>
      {[...byColor].map(([c, dots]) => (
        <path key={c} d={circles(dots)} fill={c} />
      ))}
      <path d={circles(hearts)} fill="#f6c945" />
    </>
  );
}

// a lettuce or a herb from above: leaves round the middle, the young ones lighter
const rosette = (x: number, y: number, s: number, c: string, leaves = 7) => {
  const outer: Dot[] = Array.from({length: leaves}, (_, k) => {
    const a = (k / leaves) * 2 * PI + x * 3;
    return [x + Math.cos(a) * s * 0.52, y + Math.sin(a) * s * 0.52, s * 0.42];
  });
  return (
    <g key={`${n2(x)} ${n2(y)}`}>
      <path d={circles(outer)} fill={c} stroke={tone(c, -0.35)} strokeOpacity={0.5} strokeWidth={n2(s * 0.05)} />
      <circle cx={n2(x)} cy={n2(y)} r={n2(s * 0.45)} fill={tone(c, 0.25)} />
      <circle cx={n2(x - s * 0.08)} cy={n2(y - s * 0.08)} r={n2(s * 0.2)} fill={tone(c, 0.45)} />
    </g>
  );
};

// a roof of tiles in rows, its faces lit by where they look: towards the top or left lighter, down or right darker.
// faces: [points, which way it looks (n, s, w, e), rows along x or y]
function tiled(p: string, faces: [Pt[], 'n' | 's' | 'w' | 'e'][], c: string, row: number, box: Box) {
  const light = {n: 0.14, w: 0.05, e: -0.08, s: -0.16};
  const lines = (dir: 'n' | 's' | 'w' | 'e') => {
    const d: string[] = [];
    if (dir === 'n' || dir === 's') for (let y = box.y + row; y < box.y + box.h; y += row) d.push(`M${n2(box.x)} ${n2(y)}h${n2(box.w)}`);
    else for (let x = box.x + row; x < box.x + box.w; x += row) d.push(`M${n2(x)} ${n2(box.y)}v${n2(box.h)}`);
    return d.join('');
  };
  return faces.map(([pts, dir], i) => (
    <g key={i}>
      <defs>
        <clipPath id={`${p}f${i}`}>
          <polygon points={poly(pts)} />
        </clipPath>
      </defs>
      <polygon points={poly(pts)} fill={tone(c, light[dir])} />
      <path d={lines(dir)} stroke={tone(c, -0.4)} strokeOpacity={0.35} strokeWidth={n2(row * 0.16)} clipPath={`url(#${p}f${i})`} />
      <path d={lines(dir)} stroke={tone(c, 0.3)} strokeOpacity={0.25} strokeWidth={n2(row * 0.08)} clipPath={`url(#${p}f${i})`} transform={`translate(${dir === 'n' || dir === 's' ? 0 : n2(row * 0.18)} ${dir === 'n' || dir === 's' ? n2(row * 0.18) : 0})`} />
    </g>
  ));
}

// a hipped roof filling the box: the ridge along the long side, the hips from the corners to its ends, with a
// chimney and a roof window when there's room
function hipRoof(p: string, b: Box, c: string, extras = true) {
  const {x, y, w, h} = b;
  const {cx, cy} = middle(b);
  const s = Math.min(w, h);
  const half = s / 2;
  const wide = w >= h;
  const [a, e]: [Pt, Pt] = wide ? [[x + half, cy], [x + w - half, cy]] : [[cx, y + half], [cx, y + h - half]];
  const [tl, tr, br, bl]: Pt[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const faces: [Pt[], 'n' | 's' | 'w' | 'e'][] = wide
    ? [[[tl, tr, e, a], 'n'], [[bl, br, e, a], 's'], [[tl, a, bl], 'w'], [[tr, e, br], 'e']]
    : [[[tl, a, e, bl], 'w'], [[tr, a, e, br], 'e'], [[tl, tr, a], 'n'], [[bl, br, e], 's']];
  const ridge = tone(c, -0.35);
  const cap = tone(c, 0.25);
  const lines = `M${n2(a[0])} ${n2(a[1])}L${n2(e[0])} ${n2(e[1])}M${n2(tl[0])} ${n2(tl[1])}L${n2(a[0])} ${n2(a[1])}L${n2(bl[0])} ${n2(bl[1])}M${n2(tr[0])} ${n2(tr[1])}L${n2(e[0])} ${n2(e[1])}L${n2(br[0])} ${n2(br[1])}`;
  // the chimney on the face towards the light, the window lower on it
  const k = s * 0.11;
  const [chx, chy] = wide ? [x + w * 0.66, cy - s * 0.2] : [cx - s * 0.2, y + h * 0.34];
  const [wx, wy] = wide ? [x + w * 0.32, cy - s * 0.3] : [cx - s * 0.3, y + h * 0.66];
  return (
    <>
      {softBox(x, y, w, h, s * 0.02, s * 0.05)}
      {tiled(p, faces, c, s * 0.055, b)}
      <path d={lines} stroke={ridge} strokeWidth={n2(s * 0.03)} strokeLinecap="round" fill="none" />
      <path d={lines} stroke={cap} strokeOpacity={0.6} strokeWidth={n2(s * 0.01)} strokeLinecap="round" fill="none" transform={`translate(${n2(-s * 0.006)} ${n2(-s * 0.006)})`} />
      <rect x={n2(x)} y={n2(y)} width={n2(w)} height={n2(h)} fill="none" stroke={tone(c, -0.45)} strokeWidth={n2(s * 0.014)} />
      {extras && s > 0 && (
        <>
          <rect x={n2(chx - k / 2 + k * 0.25)} y={n2(chy - k / 2 + k * 0.32)} width={n2(k)} height={n2(k)} fill="#000" opacity={0.25} />
          <rect x={n2(chx - k / 2)} y={n2(chy - k / 2)} width={n2(k)} height={n2(k)} fill="#a2563f" stroke="#7a3d2c" strokeWidth={n2(k * 0.08)} />
          <rect x={n2(chx - k * 0.28)} y={n2(chy - k * 0.28)} width={n2(k * 0.56)} height={n2(k * 0.56)} fill="#2a2522" />
          <rect x={n2(wx - k * 0.6)} y={n2(wy - k * 0.45)} width={n2(k * 1.2)} height={n2(k * 0.9)} rx={n2(k * 0.05)} fill="#d9dde0" />
          <rect x={n2(wx - k * 0.5)} y={n2(wy - k * 0.35)} width={n2(k)} height={n2(k * 0.7)} fill="#3d556b" />
          <path d={`M${n2(wx - k * 0.42)} ${n2(wy + k * 0.2)}l${n2(k * 0.35)} ${n2(-k * 0.5)}`} stroke="#fff" strokeOpacity={0.5} strokeWidth={n2(k * 0.08)} />
        </>
      )}
    </>
  );
}

// a gable roof lying along x, l by d around 0,0: the face up in the light, the one down in the shade, shingles in
// rows along the ridge
function gableRoof(p: string, l: number, d: number, c: string, row = d * 0.09) {
  const b = {x: -l / 2, y: -d / 2, w: l, h: d};
  const faces: [Pt[], 'n' | 's'][] = [
    [[[-l / 2, -d / 2], [l / 2, -d / 2], [l / 2, 0], [-l / 2, 0]], 'n'],
    [[[-l / 2, 0], [l / 2, 0], [l / 2, d / 2], [-l / 2, d / 2]], 's'],
  ];
  return (
    <>
      {tiled(p, faces, c, row, b)}
      {/* the shingles' joints, every other row moved on by half */}
      <path
        d={Array.from({length: Math.ceil(d / row)}, (_, i) => {
          const y = -d / 2 + i * row;
          const off = i % 2 ? row : 0;
          const out: string[] = [];
          for (let x = -l / 2 + off; x < l / 2; x += row * 2) out.push(`M${n2(x)} ${n2(y)}v${n2(row)}`);
          return out.join('');
        }).join('')}
        stroke={tone(c, -0.4)}
        strokeOpacity={0.25}
        strokeWidth={n2(row * 0.1)}
      />
      <rect x={n2(-l / 2)} y={n2(-d * 0.025)} width={n2(l)} height={n2(d * 0.05)} fill={tone(c, -0.3)} />
      <rect x={n2(-l / 2)} y={n2(-d * 0.025)} width={n2(l)} height={n2(d * 0.018)} fill={tone(c, 0.2)} opacity={0.7} />
      <rect x={n2(-l / 2)} y={n2(-d / 2)} width={n2(l)} height={n2(d)} fill="none" stroke={tone(c, -0.45)} strokeWidth={n2(d * 0.02)} />
    </>
  );
}

// a garden chair from above around x, y, c big, its back turned deg (0: up), seat in color
function chair(x: number, y: number, c: number, deg: number, seat = '#e9e0cc', frame = '#7d5a3c') {
  return (
    <g key={`${n2(x)} ${n2(y)}`} transform={`rotate(${n2(deg)} ${n2(x)} ${n2(y)})`}>
      <rect x={n2(x - c / 2 + c * 0.08)} y={n2(y - c / 2 + c * 0.12)} width={n2(c)} height={n2(c)} rx={n2(c * 0.2)} fill="#000" opacity={0.2} data-halo="" />
      <rect x={n2(x - c / 2)} y={n2(y - c / 2)} width={n2(c)} height={n2(c)} rx={n2(c * 0.18)} fill={frame} />
      <rect x={n2(x - c * 0.4)} y={n2(y - c * 0.26)} width={n2(c * 0.8)} height={n2(c * 0.68)} rx={n2(c * 0.16)} fill={seat} stroke={tone(seat, -0.25)} strokeWidth={n2(c * 0.04)} />
      <rect x={n2(x - c * 0.3)} y={n2(y - c * 0.18)} width={n2(c * 0.45)} height={n2(c * 0.2)} rx={n2(c * 0.1)} fill="#fff" opacity={0.3} />
      <rect x={n2(x - c / 2)} y={n2(y - c / 2)} width={n2(c)} height={n2(c * 0.22)} rx={n2(c * 0.1)} fill={tone(frame, -0.2)} />
      <rect x={n2(x - c / 2)} y={n2(y - c / 2)} width={n2(c)} height={n2(c * 0.08)} rx={n2(c * 0.04)} fill={tone(frame, 0.3)} />
    </g>
  );
}

// wood seen from above: boards along x in rows, with their grain
function boards(x: number, y: number, w: number, h: number, n: number, c: string, rnd: () => number) {
  const bh = h / n;
  return (
    <>
      {Array.from({length: n}, (_, i) => (
        <rect key={i} x={n2(x)} y={n2(y + i * bh)} width={n2(w)} height={n2(bh)} fill={tone(c, (rnd() - 0.5) * 0.12)} />
      ))}
      <path
        d={Array.from({length: n}, (_, i) => {
          const yy = y + i * bh;
          return `M${n2(x + w * rnd() * 0.2)} ${n2(yy + bh * (0.3 + rnd() * 0.4))}h${n2(w * (0.4 + rnd() * 0.4))}`;
        }).join('')}
        stroke={tone(c, -0.3)}
        strokeOpacity={0.45}
        strokeWidth={n2(bh * 0.06)}
        strokeLinecap="round"
      />
      <path d={Array.from({length: n - 1}, (_, i) => `M${n2(x)} ${n2(y + (i + 1) * bh)}h${n2(w)}`).join('')} stroke={tone(c, -0.45)} strokeWidth={n2(bh * 0.08)} />
    </>
  );
}

// what fills between steps over a rectangle, m svg units per meter: little stones, chips of bark or blades of grass, about
// as many as on that much ground, a path per color
function strewn(kind: 'gravel' | 'bark' | 'grass', x: number, y: number, w: number, h: number, m: number, rnd: () => number) {
  const per = (k: number, most: number) => Math.min(most, Math.round(((w * h) / (m * m)) * k));
  const at = (): Pt => [x + rnd() * w, y + rnd() * h];
  if (kind === 'gravel') {
    const colors = ['#a59c8c', '#cfc8ba', '#9a9182', '#ddd6c9'];
    const stones = Array.from({length: per(260, 360)}, (): Dot => [...at(), (0.012 + rnd() * 0.012) * m]);
    return (
      <>
        <rect x={n2(x)} y={n2(y)} width={n2(w)} height={n2(h)} fill="#b8b0a1" />
        {colors.map((c, i) => (
          <path key={c} d={circles(stones.filter((_, k) => k % colors.length === i))} fill={c} />
        ))}
      </>
    );
  }
  if (kind === 'bark') {
    const colors = ['#8a6142', '#4f3524', '#7a5438'];
    const chips = Array.from({length: per(140, 220)}, () => {
      const [cx, cy] = at();
      const a = rnd() * PI;
      const [ux, uy, vx, vy] = [Math.cos(a) * 0.028 * m, Math.sin(a) * 0.028 * m, -Math.sin(a) * 0.008 * m, Math.cos(a) * 0.008 * m];
      return `M${n2(cx - ux - vx)} ${n2(cy - uy - vy)}L${n2(cx + ux - vx)} ${n2(cy + uy - vy)}L${n2(cx + ux + vx)} ${n2(cy + uy + vy)}L${n2(cx - ux + vx)} ${n2(cy - uy + vy)}Z`;
    });
    return (
      <>
        <rect x={n2(x)} y={n2(y)} width={n2(w)} height={n2(h)} fill="#6b4a32" />
        {colors.map((c, i) => (
          <path key={c} d={chips.filter((_, k) => k % colors.length === i).join('')} fill={c} />
        ))}
      </>
    );
  }
  const blades = Array.from({length: per(200, 280)}, () => {
    const [bx, by] = at();
    return `M${n2(bx)} ${n2(by)}l${n2((rnd() - 0.5) * 0.03 * m)} ${n2(-0.05 * m)}`;
  });
  return (
    <>
      <rect x={n2(x)} y={n2(y)} width={n2(w)} height={n2(h)} fill="#4f8f3c" />
      <path d={blades.filter((_, k) => k % 2).join('')} stroke="#6aa94f" strokeWidth={n2(0.008 * m)} strokeLinecap="round" />
      <path d={blades.filter((_, k) => !(k % 2)).join('')} stroke="#3b7330" strokeWidth={n2(0.008 * m)} strokeLinecap="round" />
    </>
  );
}

// a leaf from above, pointed at both ends: from x, y along a (radians), l long, about w wide
const leaf = (x: number, y: number, a: number, l: number, w: number) => {
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const [mx, my] = [x + (c * l) / 2, y + (s * l) / 2];
  const [nx, ny] = [-s * w, c * w];
  return `M${n2(x)} ${n2(y)}Q${n2(mx + nx)} ${n2(my + ny)} ${n2(x + c * l)} ${n2(y + s * l)}Q${n2(mx - nx)} ${n2(my - ny)} ${n2(x)} ${n2(y)}Z`;
};
// a stalk or a blade from x, y along a, l long, bent sideways by bend of its length
const stalk = (x: number, y: number, a: number, l: number, bend: number) => {
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return `M${n2(x)} ${n2(y)}Q${n2(x + (c * l) / 2 - s * bend * l)} ${n2(y + (s * l) / 2 + c * bend * l)} ${n2(x + c * l)} ${n2(y + s * l)}`;
};
// the point t of the way along such a stalk, and which way it goes there
const onStalk = (x: number, y: number, a: number, l: number, bend: number, t: number): [number, number, number] => {
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const [qx, qy] = [(c * l) / 2 - s * bend * l, (s * l) / 2 + c * bend * l];
  const [ex, ey] = [c * l, s * l];
  const [px, py] = [2 * (1 - t) * t * qx + t * t * ex, 2 * (1 - t) * t * qy + t * t * ey];
  const [dx, dy] = [2 * (1 - t) * qx + 2 * t * (ex - qx), 2 * (1 - t) * qy + 2 * t * (ey - qy)];
  return [x + px, y + py, Math.atan2(dy, dx)];
};
// a bed's plants about step apart in rows moved on by half, shaken so no rows show, each with random numbers of its own
// (from seed and where it is in the rows). tile: the box repeats itself, rows and columns fit it exactly and a plant near
// an edge comes once more past the other edge, the same plant
function spots(b: Box, step: number, seed: string, tile = false, most = 320): {x: number; y: number; r: () => number}[] {
  let cols = Math.max(1, Math.round(b.w / step));
  let rows = Math.max(2, Math.round(b.h / (step * 0.87)));
  if (tile) rows += rows % 2;
  else {
    // too many for the box: further apart
    const k = Math.sqrt((rows * cols) / most);
    if (k > 1) [cols, rows] = [Math.max(1, Math.round(cols / k)), Math.max(2, Math.round(rows / k))];
  }
  const [sx, sy] = [b.w / cols, b.h / rows];
  const out: {x: number; y: number; r: () => number}[] = [];
  for (let j = 0; j < rows + (tile ? 0 : 1); j++) {
    for (let i = 0; i < cols + (tile ? 0 : 1); i++) {
      const id = `${seed}:${j}:${i}`;
      const shake = random(id);
      const [x, y] = [b.x + (i + (j % 2) * 0.5 + (shake() - 0.5) * 0.7) * sx, b.y + (j + 0.5 + (shake() - 0.5) * 0.7) * sy];
      for (const dx of tile ? [-b.w, 0, b.w] : [0]) {
        for (const dy of tile ? [-b.h, 0, b.h] : [0]) {
          const [qx, qy] = [x + dx, y + dy];
          if (!dx && !dy) out.push({x, y, r: random(id + 'p')});
          else if (qx > b.x - step && qx < b.x + b.w + step && qy > b.y - step && qy < b.y + b.h + step) out.push({x: qx, y: qy, r: random(id + 'p')});
        }
      }
    }
  }
  return out;
}

// a small leafy mound from above, as dots in three tones (lit up left, shaded down right): for the many plants of a bed
const mound = (x: number, y: number, s: number, rnd: () => number): Dot[][] => {
  const lobes = Array.from({length: 5}, (_, k): Dot => {
    const a = (k / 5) * 2 * PI + rnd();
    return [x + Math.cos(a) * s * 0.42, y + Math.sin(a) * s * 0.42, s * (0.4 + rnd() * 0.12)];
  });
  return [
    lobes.map(([lx, ly, r]) => [lx + s * 0.06, ly + s * 0.08, r]),
    [...lobes, [x, y, s * 0.5]],
    lobes.filter((l) => litSide(l, x, y)).map(([lx, ly, r]) => [lx - r * 0.2, ly - r * 0.2, r * 0.5]),
  ];
};
// dots of many plants by color, a path each
function byColor(list: [Dot, string][]) {
  const groups = new Map<string, Dot[]>();
  for (const [d, c] of list) groups.set(c, [...(groups.get(c) ?? []), d]);
  return [...groups].map(([c, ds]) => <path key={c} d={circles(ds)} fill={c} />);
}
// a butterfly sitting with its wings open, s across, its wings c
const butterfly = (x: number, y: number, s: number, a: number, c: string) => (
  <g transform={`translate(${n2(x)} ${n2(y)}) rotate(${n2((a * 180) / PI)})`}>
    <path d={circles([[-s * 0.24, -s * 0.2, s * 0.24], [-s * 0.24, s * 0.2, s * 0.24]])} fill={c} stroke="#2a2522" strokeWidth={n2(s * 0.05)} />
    <path d={circles([[s * 0.12, -s * 0.16, s * 0.17], [s * 0.12, s * 0.16, s * 0.17]])} fill={tone(c, -0.15)} stroke="#2a2522" strokeWidth={n2(s * 0.05)} />
    <path d={circles([[-s * 0.3, -s * 0.26, s * 0.06], [-s * 0.3, s * 0.26, s * 0.06]])} fill="#2a2522" />
    <path d={circles([[-s * 0.3, -s * 0.26, s * 0.025], [-s * 0.3, s * 0.26, s * 0.025]])} fill="#f4f1ea" />
    <rect x={n2(-s * 0.32)} y={n2(-s * 0.03)} width={n2(s * 0.62)} height={n2(s * 0.06)} rx={n2(s * 0.03)} fill="#2a2522" />
  </g>
);

// a few blades of grass standing at x, y in meters
const tuft = (m: number, x: number, y: number, s = 1) =>
  `M${n2(x * m)} ${n2(y * m)} l${n2(-0.04 * m * s)} ${n2(-0.11 * m * s)} l${n2(0.03 * m * s)} ${n2(0.08 * m * s)} l${n2(0.01 * m * s)} ${n2(-0.12 * m * s)} ` +
  `l${n2(0.02 * m * s)} ${n2(0.12 * m * s)} l${n2(0.03 * m * s)} ${n2(-0.08 * m * s)} l${n2(-0.03 * m * s)} ${n2(0.11 * m * s)} Z`;
const dots = (m: number, list: [number, number, number, string][]) => {
  const byColor = new Map<string, Dot[]>();
  for (const [x, y, r, c] of list) byColor.set(c, [...(byColor.get(c) ?? []), [x * m, y * m, r * m]]);
  return [...byColor].map(([c, d]) => <path key={c} d={circles(d)} fill={c} />);
};
// a texture's things scattered the same every time, in meters on a w by h tile
const tileScatter = (seed: string, n: number, w: number, h: number): Pt[] => {
  const rnd = random(seed);
  return Array.from({length: n}, () => [rnd() * w, rnd() * h]);
};

// the colors a picture comes in, by key: its name and what it changes
type Variants<T> = Record<string, T & {label: string}>;
// the color picked for the drawing, else one by its seed (vary: every one its own) or the first, the usual one
function pick<T>(o: ThingOptions, list: Variants<T>, vary = false): T & {label: string} {
  const keys = Object.keys(list);
  return list[o.variant ?? ''] ?? list[keys[vary ? Math.floor(random(o.seed + 'color')() * keys.length) : 0]];
}
const choices = (list: Variants<object>) => Object.entries(list).map(([key, v]) => ({key, label: v.label}));

const TREES: Variants<{c: string; bloom?: string}> = {
  green: {label: 'Green', c: '#3f7a34'},
  light: {label: 'Light green', c: '#5c9a40'},
  copper: {label: 'Red leaves', c: '#6e3a3c'},
  golden: {label: 'Golden', c: '#9a9f45'},
  blossom: {label: 'Cherry blossom', c: '#5a8a3f', bloom: '#f6c6d8'},
};
const CONIFERS: Variants<{c: string}> = {
  green: {label: 'Green', c: '#2d6b47'},
  blue: {label: 'Blue-green', c: '#4a7a78'},
  golden: {label: 'Golden', c: '#8f9a3c'},
};
const BUSHES: Variants<{c: string}> = {
  green: {label: 'Green', c: '#56923d'},
  dark: {label: 'Dark green', c: '#3f7a34'},
  red: {label: 'Red leaves', c: '#7a3d3a'},
  golden: {label: 'Golden', c: '#9aa548'},
};
const BLOOMS: Variants<{c: [string, string]}> = {
  pink: {label: 'Pink', c: ['#e27fae', '#f7c6dc']},
  purple: {label: 'Purple', c: ['#a77fd0', '#dcc6f0']},
  white: {label: 'White', c: ['#ece8dd', '#ffffff']},
  red: {label: 'Red', c: ['#c8352d', '#f08a7e']},
  yellow: {label: 'Yellow', c: ['#e8b62a', '#f6dc7a']},
};
const FRUITS: Variants<{c: [string, string]; s: number}> = {
  red: {label: 'Red apples', c: ['#c8392b', '#e7a733'], s: 1},
  yellow: {label: 'Yellow apples', c: ['#e2b93a', '#c9a12c'], s: 1},
  pears: {label: 'Pears', c: ['#b4bf48', '#d7c052'], s: 1.1},
  cherries: {label: 'Cherries', c: ['#8c1a24', '#b0202c'], s: 0.65},
};
const ROOFS: Variants<{c: string}> = {
  red: {label: 'Red', c: '#b0573d'},
  anthracite: {label: 'Anthracite', c: '#4f555c'},
  brown: {label: 'Brown', c: '#7a4f3a'},
  grey: {label: 'Grey', c: '#8a8f96'},
};
const SHEDS: Variants<{c: string}> = {
  green: {label: 'Green-grey', c: '#5d675b'},
  anthracite: {label: 'Anthracite', c: '#4a4e53'},
  red: {label: 'Red', c: '#a24a36'},
  wood: {label: 'Wood', c: '#8a6440'},
};
const SMALL_ROOFS: Variants<{c: string}> = {
  red: {label: 'Red', c: '#b0503a'},
  green: {label: 'Green', c: '#4a7a4a'},
  blue: {label: 'Blue', c: '#4a6a9a'},
  wood: {label: 'Wood', c: '#8a6440'},
};
const CANVAS: Variants<{c: string}> = {
  cream: {label: 'Cream', c: '#ece5d6'},
  white: {label: 'White', c: '#f4f4f0'},
  grey: {label: 'Grey', c: '#9aa0a6'},
  green: {label: 'Green', c: '#7f9f7a'},
  anthracite: {label: 'Anthracite', c: '#5b6168'},
};
const SAILS: Variants<{c: string}> = {
  sand: {label: 'Sand', c: '#e6dcc4'},
  white: {label: 'White', c: '#f2f0ea'},
  anthracite: {label: 'Anthracite', c: '#5b6168'},
  terracotta: {label: 'Terracotta', c: '#c9643f'},
  green: {label: 'Green', c: '#8fae8a'},
};
const CUSHIONS: Variants<{c: string}> = {
  cream: {label: 'Cream', c: '#e9e0cc'},
  grey: {label: 'Grey', c: '#c9cdd0'},
  green: {label: 'Green', c: '#9fb98f'},
  terracotta: {label: 'Terracotta', c: '#d98a6a'},
  blue: {label: 'Blue', c: '#9fb7d0'},
};
const STRIPES: Variants<{c: string}> = {
  blue: {label: 'Blue', c: '#4e86b5'},
  red: {label: 'Red', c: '#c9643f'},
  green: {label: 'Green', c: '#5f8f5a'},
  grey: {label: 'Grey', c: '#7a8088'},
  yellow: {label: 'Yellow', c: '#e0a83a'},
};
const LOUNGES: Variants<{c: string}> = {
  grey: {label: 'Grey', c: '#cfd5d8'},
  cream: {label: 'Cream', c: '#e9e0cc'},
  anthracite: {label: 'Anthracite', c: '#6a7077'},
  blue: {label: 'Blue', c: '#8fa9c4'},
};
const BENCHES: Variants<{c: string}> = {
  wood: {label: 'Wood', c: '#a8794a'},
  grey: {label: 'Grey', c: '#9aa0a6'},
  white: {label: 'White', c: '#e6e2d8'},
  green: {label: 'Green', c: '#4f7a5a'},
};
const HAMMOCKS: Variants<{c: string[]}> = {
  colorful: {label: 'Colorful', c: ['#e0a83a', '#d4693f', '#3f8f8a', '#efe6d0', '#c94c4c']},
  blue: {label: 'Blue and white', c: ['#3f6f9f', '#f2efe6']},
  natural: {label: 'Natural', c: ['#e6dcc4', '#cdbf9f']},
  green: {label: 'Green and white', c: ['#5f8f5a', '#f2efe6']},
};
const CARS: Variants<{c: string}> = {
  blue: {label: 'Blue', c: '#4b6b9b'},
  red: {label: 'Red', c: '#b8342c'},
  white: {label: 'White', c: '#e2e5e8'},
  black: {label: 'Black', c: '#2a2d31'},
  silver: {label: 'Silver', c: '#9aa3ab'},
  green: {label: 'Green', c: '#3f6b4a'},
};
const PADS: Variants<{c: string}> = {
  blue: {label: 'Blue', c: '#2f72b4'},
  green: {label: 'Green', c: '#3f8f4a'},
  red: {label: 'Red', c: '#c0392b'},
  grey: {label: 'Grey', c: '#5b6168'},
  orange: {label: 'Orange', c: '#e07b2a'},
};
const GRILLS: Variants<{c: string}> = {
  black: {label: 'Black', c: '#24272b'},
  red: {label: 'Red', c: '#a8302a'},
  blue: {label: 'Blue', c: '#2f5f9f'},
};
const BARRELS: Variants<{c: string}> = {
  green: {label: 'Green', c: '#2f6b3b'},
  grey: {label: 'Grey', c: '#5b6168'},
  brown: {label: 'Brown', c: '#6b4a2e'},
  terracotta: {label: 'Terracotta', c: '#a8583a'},
};
const CABINETS: Variants<{c: string}> = {
  wood: {label: 'Wood', c: '#6e5442'},
  grey: {label: 'Grey', c: '#5b6168'},
  black: {label: 'Black', c: '#2f3236'},
};
const TABLES: Variants<{c: string}> = {
  blue: {label: 'Blue', c: '#1f5d8c'},
  green: {label: 'Green', c: '#2f6f4a'},
};
const SEATS: Variants<{c: [string, string]}> = {
  redgreen: {label: 'Red and green', c: ['#d6453a', '#2f8a4f']},
  blueyellow: {label: 'Blue and yellow', c: ['#2f6fc0', '#f0c636']},
  black: {label: 'Black', c: ['#2b2e31', '#2b2e31']},
};
const TOWERS: Variants<{roof: string; slide: string}> = {
  green: {label: 'Green', roof: '#3f8f4a', slide: '#f2c230'},
  red: {label: 'Red', roof: '#b8453a', slide: '#f2c230'},
  blue: {label: 'Blue', roof: '#3f6fa8', slide: '#d6453a'},
  wood: {label: 'Wood', roof: '#8a6440', slide: '#3f8f4a'},
};
const LAMPS: Variants<{c: string}> = {
  black: {label: 'Black', c: '#3d4146'},
  copper: {label: 'Copper', c: '#9a6a3a'},
  white: {label: 'White', c: '#d6d6d0'},
};
const STATUES: Variants<{c: string}> = {
  stone: {label: 'Stone', c: '#cdc7ba'},
  bronze: {label: 'Bronze', c: '#8a6a44'},
  patina: {label: 'Patina', c: '#7d9c86'},
};
const HATS: Variants<{hat: string; coat: string}> = {
  red: {label: 'Red', hat: '#d9302a', coat: '#2f64b5'},
  blue: {label: 'Blue', hat: '#2f64b5', coat: '#c0392b'},
  green: {label: 'Green', hat: '#3f8f4a', coat: '#c0392b'},
};
const POTS: Variants<{c: string}> = {
  red: {label: 'Red', c: '#d83a3a'},
  pink: {label: 'Pink', c: '#e98bb5'},
  white: {label: 'White', c: '#f4f1ea'},
  purple: {label: 'Purple', c: '#9b5fd0'},
  yellow: {label: 'Yellow', c: '#f2c230'},
};
const VINES: Variants<{c: string}> = {
  grapes: {label: 'Grapes', c: '#7b4a9e'},
  wisteria: {label: 'Wisteria', c: '#a58ad8'},
  roses: {label: 'Roses', c: '#d6456a'},
};

// a parasol's fabric: its panels in turn
const FABRICS: Variants<{c: [string, string]}> = {
  cream: {label: 'Cream', c: ['#ece2cb', '#ece2cb']},
  anthracite: {label: 'Anthracite', c: ['#5b6168', '#5b6168']},
  terracotta: {label: 'Terracotta', c: ['#c9643f', '#c9643f']},
  sage: {label: 'Sage', c: ['#8fae8a', '#8fae8a']},
  yellow: {label: 'Yellow', c: ['#e8b844', '#e8b844']},
  blue: {label: 'Blue and white', c: ['#f2efe6', '#3f6f9f']},
  red: {label: 'Red and white', c: ['#f2efe6', '#c9643f']},
};

const STUMPS: Variants<{cut: string; bark: string; moss: number}> = {
  weathered: {label: 'Weathered', cut: '#ab9c84', bark: '#54473a', moss: 0.3},
  fresh: {label: 'Fresh', cut: '#d9b37c', bark: '#5d4532', moss: 0},
  mossy: {label: 'Mossy', cut: '#8f8a70', bark: '#4a4033', moss: 1},
};
const STEP_FILLS: Variants<{fill: 'gravel' | 'bark' | 'grass'}> = {
  gravel: {label: 'Gravel', fill: 'gravel'},
  bark: {label: 'Bark mulch', fill: 'bark'},
  grass: {label: 'Grass', fill: 'grass'},
};
const WOODS: Variants<{c: string}> = {
  natural: {label: 'Natural', c: '#a8794a'},
  larch: {label: 'Larch', c: '#c4925a'},
  grey: {label: 'Weathered', c: '#9b968c'},
  dark: {label: 'Dark brown', c: '#6b4a2e'},
};
const STONE_STEPS: Variants<{c: string}> = {
  granite: {label: 'Granite', c: '#a9a9a3'},
  sandstone: {label: 'Sandstone', c: '#cbb18a'},
  anthracite: {label: 'Anthracite', c: '#5f6366'},
};
const STEPPERS: Variants<{c: string; shape: 'stone' | 'slice' | 'slab'}> = {
  stone: {label: 'Natural stone', c: '#a8a49a', shape: 'stone'},
  sandstone: {label: 'Sandstone', c: '#cdb48a', shape: 'stone'},
  slices: {label: 'Wood slices', c: '#c9a26b', shape: 'slice'},
  slabs: {label: 'Concrete slabs', c: '#b9b6ae', shape: 'slab'},
};
const BRIDGES: Variants<{deck: string; rail: string}> = {
  natural: {label: 'Natural', deck: '#a8794a', rail: '#8a6440'},
  grey: {label: 'Weathered', deck: '#9b968c', rail: '#7d786f'},
  red: {label: 'Red railing', deck: '#a8794a', rail: '#b8452f'},
};

const BUDDLEJAS: Variants<{c: string}> = {
  purple: {label: 'Purple', c: '#8a5cc2'},
  dark: {label: 'Dark purple', c: '#5b2f8a'},
  pink: {label: 'Pink', c: '#d873b0'},
  white: {label: 'White', c: '#efece4'},
};
const HYDRANGEAS: Variants<{c: [string, string]}> = {
  blue: {label: 'Blue', c: ['#6f8fd8', '#a9c1f0']},
  pink: {label: 'Pink', c: ['#e48bb8', '#f6c3dc']},
  white: {label: 'White', c: ['#dfe4e2', '#ffffff']},
  purple: {label: 'Purple', c: ['#9a72c9', '#cdb6ea']},
};
const RHODOS: Variants<{c: [string, string]}> = {
  pink: {label: 'Pink', c: ['#d9579a', '#f3a8cd']},
  purple: {label: 'Purple', c: ['#8a4fbf', '#c7a3e6']},
  red: {label: 'Red', c: ['#c8302f', '#ee7f78']},
  white: {label: 'White', c: ['#e9e2e4', '#ffffff']},
};
const ROSES: Variants<{c: [string, string]}> = {
  red: {label: 'Red', c: ['#b81d2a', '#e2525a']},
  pink: {label: 'Pink', c: ['#e2759f', '#f7bdd2']},
  yellow: {label: 'Yellow', c: ['#e8b62a', '#f6dc7a']},
  white: {label: 'White', c: ['#ece6da', '#ffffff']},
  apricot: {label: 'Apricot', c: ['#f0a070', '#fad0b0']},
};
const GRASSES: Variants<{c: string; plume?: string; low?: boolean}> = {
  green: {label: 'Silver grass', c: '#7a9a4a', plume: '#dcd2ae'},
  red: {label: 'Red', c: '#8a4a3a', plume: '#d0a090'},
  pampas: {label: 'Pampas grass', c: '#8fa36a', plume: '#f4efe4'},
  blue: {label: 'Blue fescue', c: '#7f9fa8', low: true},
};
const HOSTAS: Variants<{c: string; edge?: string}> = {
  green: {label: 'Green', c: '#4f8f3c'},
  blue: {label: 'Blue-green', c: '#5a8a88'},
  white: {label: 'White edge', c: '#4a8a3a', edge: '#eef0d8'},
  gold: {label: 'Golden', c: '#a3b448'},
};
const MAPLES: Variants<{c: string}> = {
  red: {label: 'Red', c: '#9a2a2a'},
  orange: {label: 'Orange', c: '#d0702a'},
  green: {label: 'Green', c: '#6a9a3a'},
};
const FERNS: Variants<{c: string}> = {
  green: {label: 'Green', c: '#4f9a3a'},
  dark: {label: 'Dark green', c: '#2f6b2f'},
  rust: {label: 'Autumn', c: '#a8743a'},
};
const LAVENDERS: Variants<{c: string}> = {
  purple: {label: 'Purple', c: '#8a6fc4'},
  blue: {label: 'Blue', c: '#6f7fd0'},
  white: {label: 'White', c: '#eeeaf2'},
  pink: {label: 'Pink', c: '#d898c4'},
};
const BOXES: Variants<{c: string; shape: 'ball' | 'cone' | 'block'}> = {
  ball: {label: 'Ball', c: '#3f6f2f', shape: 'ball'},
  cone: {label: 'Cone', c: '#3a6a2f', shape: 'cone'},
  block: {label: 'Block', c: '#3f6f2f', shape: 'block'},
};
const PERENNIALS: Variants<{c: string[]; grass?: boolean}> = {
  colorful: {label: 'Colorful', c: ['#8a6fd0', '#e27fae', '#f2c230', '#f4f1ea', '#d9534f']},
  blue: {label: 'Blue and white', c: ['#6a7fd0', '#9fb2ea', '#f4f1ea', '#8a6fd0']},
  pink: {label: 'Pink and purple', c: ['#e27fae', '#b05fc0', '#f7c6dc', '#8a6fd0']},
  warm: {label: 'Warm', c: ['#f2c230', '#e8762a', '#d9534f', '#f6dc7a']},
  prairie: {label: 'Prairie', c: ['#d873b0', '#f2c230', '#b07ad0', '#e8762a'], grass: true},
};
const MIXED: Variants<{c: string[]}> = {
  colorful: {label: 'Colorful', c: ['#d9534f', '#f2c230', '#e27fae', '#f4f1ea', '#8a6fd0', '#e8762a']},
  pink: {label: 'Pink and purple', c: ['#e27fae', '#b05fc0', '#f7c6dc', '#f4f1ea', '#8a6fd0']},
  blue: {label: 'Blue and white', c: ['#6a7fd0', '#9fb2ea', '#f4f1ea', '#8a6fd0']},
  warm: {label: 'Warm', c: ['#f2c230', '#e8762a', '#d9534f', '#f6dc7a', '#f4f1ea']},
};
// what grows in a mixed bed, daisies and spikes the most
const MIXED_KINDS = ['daisy', 'daisy', 'spike', 'spike', 'heads', 'grass', 'cushion', 'shrub'] as const;
const SPRING: Variants<{c: string[]}> = {
  colorful: {label: 'Colorful', c: ['#d9302a', '#f2c230', '#e27fae', '#f4f1ea', '#8a4fbf']},
  red: {label: 'Red and yellow', c: ['#d9302a', '#f2c230']},
  pink: {label: 'Pink and white', c: ['#e27fae', '#f4f1ea']},
  purple: {label: 'Purple', c: ['#6a2f8a', '#a37ad6', '#f4f1ea']},
};
const SUMMER: Variants<{c: string[]}> = {
  colorful: {label: 'Colorful', c: ['#e8762a', '#f2c230', '#d9302a', '#e27fae', '#8a4fbf', '#f4f1ea']},
  warm: {label: 'Warm', c: ['#e8762a', '#f2c230', '#d9302a']},
  pink: {label: 'Pink and white', c: ['#e27fae', '#f4f1ea', '#c04f8a']},
  blue: {label: 'Blue and white', c: ['#5a6fd0', '#9fb2ea', '#f4f1ea']},
};
const GROUND_COVERS: Variants<{c: string; bloom?: string}> = {
  ivy: {label: 'Ivy', c: '#2f5a2a'},
  periwinkle: {label: 'Periwinkle', c: '#2f6a32', bloom: '#7f8fe0'},
  thyme: {label: 'Thyme', c: '#6f8a5a', bloom: '#c48fd0'},
  cranesbill: {label: 'Cranesbill', c: '#4f8a3f', bloom: '#d880c0'},
};

// a bed's border along its edge
const EDGINGS: Variants<{c: string; kind: 'stone' | 'brick' | 'wood'}> = {
  stone: {label: 'Natural stone', c: '#a39d92', kind: 'stone'},
  sandstone: {label: 'Sandstone', c: '#cdb48a', kind: 'stone'},
  brick: {label: 'Brick', c: '#a8553a', kind: 'brick'},
  wood: {label: 'Wood', c: '#8a6440', kind: 'wood'},
};

const CANTILEVERS: Variants<{c: string}> = {
  anthracite: {label: 'Anthracite', c: '#4f5459'},
  grey: {label: 'Grey', c: '#9aa0a6'},
  beige: {label: 'Beige', c: '#d9cdb4'},
  taupe: {label: 'Taupe', c: '#8a7f72'},
  white: {label: 'White', c: '#eeece6'},
  terracotta: {label: 'Terracotta', c: '#b9643f'},
};

const WOOD = '#9c7447';
const STONE = '#b3ad9f';
const WATER = '#2f86bf';

// a cantilever parasol: its foot of weights and the mast where the area is, the canopy on its arm off to the side (to the
// right, the place turns it), square or with eight sides, its faces lit from the top left, ribs to the corners, a vent on
// top. as a swatch (no m) smaller and moved so both fit
function cantilever(sides: 4 | 8) {
  return function canopy(b: Box, p: string, o: ThingOptions): React.ReactNode {
    const {cx, cy} = middle(b);
    const swatch = o.m === undefined;
    const s = Math.min(b.w, b.h) * (swatch ? 0.66 : 0.96);
    const c = pick(o, CANTILEVERS, true).c;
    const [fx, fy] = [swatch ? cx - s * 0.47 : cx, cy];
    const [ax, ay] = [fx + s * 0.62, fy];
    // the corners: a square's at its side, an octagon's as wide across its flats
    const R = sides === 4 ? s * 0.707 : s * 0.541;
    const turn = sides === 4 ? -PI / 4 : -PI / 2 + PI / 8;
    const corners = Array.from({length: sides}, (_, i): Pt => [ax + Math.cos(turn + (i / sides) * 2 * PI) * R, ay + Math.sin(turn + (i / sides) * 2 * PI) * R]);
    const foot = s * 0.17;
    const petals = Array.from({length: 4}, (_, k): Dot => {
      const a = (k / 4) * 2 * PI + PI / 4;
      return [fx + Math.cos(a) * foot * 0.55, fy + Math.sin(a) * foot * 0.55, foot * 0.55];
    });
    const metal = '#6b6f73';
    return (
      <>
        {o.closed ? null : sides === 4 ? softBox(ax - s / 2, ay - s / 2, s, s, s * 0.04, s * 0.06) : halo(p + 'h', ax, ay, R, R, 0.3)}
        <path d={circles(petals)} fill="#45484c" stroke="#2a2c2f" strokeWidth={n2(s * 0.006)} />
        <path d={circles(petals.map(([x, y, r]) => [x - r * 0.2, y - r * 0.2, r * 0.55]))} fill="#5d6166" opacity={0.7} />
        <path d={petals.map(([x, y, r]) => `M${n2(x - r * 0.85)} ${n2(y)}h${n2(r * 1.7)}`).join('')} stroke="#1f2124" strokeWidth={n2(s * 0.01)} />
        <path d={`M${n2(fx)} ${n2(fy)}L${n2(ax)} ${n2(ay)}`} stroke={metal} strokeWidth={n2(s * 0.022)} strokeLinecap="round" />
        <circle cx={n2(fx)} cy={n2(fy)} r={n2(s * 0.035)} fill={tone(metal, -0.2)} stroke="#2a2c2f" strokeWidth={n2(s * 0.006)} />
        <circle cx={n2(fx - s * 0.008)} cy={n2(fy - s * 0.008)} r={n2(s * 0.015)} fill={tone(metal, 0.4)} />
        {o.closed ? (
          folded(ax, ay, s * 0.075, c, c)
        ) : (
          <>
            {corners.map(([x, y], i) => {
              const [nx, ny] = corners[(i + 1) % sides];
              const mid = Math.atan2((y + ny) / 2 - ay, (x + nx) / 2 - ax);
              return <polygon key={i} points={poly([[ax, ay], [x, y], [nx, ny]])} fill={tone(c, Math.cos(mid + (3 * PI) / 4) * 0.14 - 0.03)} />;
            })}
            <path d={corners.map(([x, y]) => `M${n2(ax)} ${n2(ay)}L${n2(x)} ${n2(y)}`).join('')} stroke={tone(c, -0.35)} strokeWidth={n2(s * 0.008)} />
            <polygon points={poly(corners)} fill="none" stroke={tone(c, -0.4)} strokeWidth={n2(s * 0.012)} strokeLinejoin="round" />
            <path d={circles([[ax + s * 0.01, ay + s * 0.015, s * 0.1]])} fill="#000" opacity={0.25} />
            <circle cx={n2(ax)} cy={n2(ay)} r={n2(s * 0.1)} fill={tone(c, 0.08)} stroke={tone(c, -0.35)} strokeWidth={n2(s * 0.006)} />
            <circle cx={n2(ax)} cy={n2(ay)} r={n2(s * 0.03)} fill={tone(c, -0.3)} />
            <path d={circles(corners.map(([x, y]) => [x, y, s * 0.012]))} fill="#2a2c2f" />
          </>
        )}
      </>
    );
  };
}

export const PICTURES: Record<string, Picture> = {
  // plants
  tree: {
    label: 'Tree',
    group: 'trees',
    round: true,
    size: [3.5, 8],
    over: true,
    many: true,
    variants: choices(TREES),
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const kind = pick(o, TREES);
      const flowers = kind.bloom ? scatter(random(o.seed + 'bloom'), 110, cx, cy, r * 0.82, [r * 0.018, r * 0.032]) : [];
      return (
        <>
          {halo(p + 'h', cx, cy, r, r * 0.96)}
          {bigCrown(p, cx, cy, r * 0.92, kind.c, random(o.seed + 'tree'), o.m ? (2 * r) / o.m : 0)}
          {kind.bloom && (
            <>
              <path d={circles(flowers)} fill={kind.bloom} />
              <path d={circles(flowers.filter((f) => litSide(f, cx, cy)).map(([x, y, s]) => [x - s * 0.3, y - s * 0.3, s * 0.5]))} fill="#fff" opacity={0.7} />
            </>
          )}
        </>
      );
    },
  },
  conifer: {
    label: 'Conifer',
    group: 'trees',
    round: true,
    size: [0.8, 5],
    many: true,
    variants: choices(CONIFERS),
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'conifer');
      const c = pick(o, CONIFERS).c;
      // a tier of needle tips round the middle, shallow so the edge looks soft
      const tier = (outer: number, depth: number, n: number) => {
        const turn = rnd();
        return Array.from({length: 2 * n}, (_, i) => {
          const a = turn + (i * PI) / n;
          const rr = r * outer * (i % 2 ? 1 - depth : 0.94 + rnd() * 0.1);
          return `${n2(cx + rr * Math.cos(a))},${n2(cy + rr * Math.sin(a))}`;
        }).join(' ');
      };
      const needles = (n: number, from: number, to: number) =>
        Array.from({length: n}, () => {
          const a = rnd() * 2 * PI;
          const [r0, r1] = [r * (from + rnd() * 0.05), r * (to + rnd() * 0.06)];
          return {a, d: `M${n2(cx + Math.cos(a) * r0)} ${n2(cy + Math.sin(a) * r0)}L${n2(cx + Math.cos(a) * r1)} ${n2(cy + Math.sin(a) * r1)}`};
        });
      const all = [...needles(40, 0.7, 0.86), ...needles(30, 0.46, 0.62), ...needles(18, 0.24, 0.38)];
      const lit = all.filter((n) => Math.cos(n.a + (3 * PI) / 4) > 0).map((n) => n.d).join('');
      const dark = all.filter((n) => Math.cos(n.a + (3 * PI) / 4) <= 0).map((n) => n.d).join('');
      return (
        <>
          <defs>
            {ball(p + 'a', c, 0.2, -0.45)}
            {ball(p + 'b', tone(c, 0.06), 0.24, -0.38)}
            {ball(p + 'c', tone(c, 0.14), 0.3, -0.3)}
          </defs>
          {halo(p + 'h', cx, cy, r, r * 0.96)}
          <polygon points={tier(0.94, 0.12, 36)} fill={tone(c, -0.5)} transform={`translate(${n2(r * 0.03)} ${n2(r * 0.045)})`} />
          <polygon points={tier(0.94, 0.12, 36)} fill={`url(#${p}a)`} />
          <polygon points={tier(0.72, 0.18, 26)} fill={`url(#${p}b)`} />
          <path d={dark} stroke={tone(c, -0.45)} strokeOpacity={0.38} strokeWidth={n2(r * 0.013)} strokeLinecap="round" />
          <path d={lit} stroke={tone(c, 0.45)} strokeOpacity={0.32} strokeWidth={n2(r * 0.013)} strokeLinecap="round" />
          <polygon points={tier(0.46, 0.22, 16)} fill={`url(#${p}c)`} />
          <polygon points={tier(0.2, 0.4, 8)} fill={tone(c, 0.38)} />
          <circle cx={n2(cx - r * 0.02)} cy={n2(cy - r * 0.02)} r={n2(r * 0.04)} fill={tone(c, 0.55)} />
        </>
      );
    },
  },
  fruitTree: {
    label: 'Fruit tree',
    group: 'trees',
    round: true,
    size: [3, 6],
    over: true,
    many: true,
    variants: choices(FRUITS),
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'fruit');
      const leafy = crown(p, cx, cy, r * 0.86, '#4c8d38', rnd, 9, 0.34, 10);
      const kind = pick(o, FRUITS);
      const fruit = scatter(rnd, 12, cx, cy, r * 0.74, [r * 0.04 * kind.s, r * 0.05 * kind.s], (v) => 0.35 + 0.65 * Math.sqrt(v));
      const fallen = Array.from({length: 2}, (): Dot => {
        const a = PI * (0.1 + rnd() * 0.6);
        return [cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9, r * 0.04];
      });
      const red = fruit.filter((_, i) => i % 4);
      const yellow = fruit.filter((_, i) => !(i % 4));
      return (
        <>
          {halo(p + 'h', cx, cy, r, r * 0.96)}
          <path d={circles(fallen)} fill={tone(kind.c[0], -0.25)} stroke={tone(kind.c[0], -0.5)} strokeWidth={n2(r * 0.008)} data-halo="" />
          {leafy}
          <path d={circles(red)} fill={kind.c[0]} stroke={tone(kind.c[0], -0.35)} strokeWidth={n2(r * 0.01)} />
          <path d={circles(yellow)} fill={kind.c[1]} stroke={tone(kind.c[1], -0.3)} strokeWidth={n2(r * 0.01)} />
          <path d={circles(fruit.map(([x, y, s]) => [x - s * 0.35, y - s * 0.35, s * 0.3]))} fill="#fff" opacity={0.6} />
        </>
      );
    },
  },
  palm: {
    label: 'Palm',
    group: 'trees',
    round: true,
    size: [2.5, 5],
    over: true,
    many: true,
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'palm');
      const c = '#4c8f3c';
      const n = 10;
      const fronds = Array.from({length: n}, (_, i) => {
        const deg = ((i + (rnd() - 0.5) * 0.45) / n) * 360;
        const len = r * (0.82 + rnd() * 0.14);
        const bend = (rnd() - 0.5) * len * 0.2;
        const rib = (t: number): Pt => [len * t, bend * t * t];
        // leaflets from the rib out and back, the longest a third of the way out
        const leaflets = Array.from({length: 22}, (_, k) => {
          const t = 0.12 + (k / 21) * 0.86;
          const [x, y] = rib(t);
          const w = len * 0.24 * Math.sin(PI * Math.min(1, t * 1.05)) * (0.85 + rnd() * 0.3);
          return [-1, 1].map((sgn) => `M${n2(x)} ${n2(y)}l${n2(-len * 0.07)} ${n2(sgn * w)}`).join('');
        }).join('');
        const body = poly([
          rib(0.08),
          ...Array.from({length: 9}, (_, k) => {
            const t = 0.15 + k * 0.1;
            const [x, y] = rib(t);
            return [x - len * 0.05, y - len * 0.2 * Math.sin(PI * Math.min(1, t))] as Pt;
          }),
          rib(1),
          ...Array.from({length: 9}, (_, k) => {
            const t = 0.95 - k * 0.1;
            const [x, y] = rib(t);
            return [x - len * 0.05, y + len * 0.2 * Math.sin(PI * Math.min(1, t))] as Pt;
          }),
        ]);
        return {deg, len, bend, leaflets, body, lit: Math.cos(((deg + 135) * PI) / 180) * 0.16};
      });
      const nuts: Dot[] = [0, 2.1, 4.2].map((a) => [cx + Math.cos(a + 0.5) * r * 0.1, cy + Math.sin(a + 0.5) * r * 0.1, r * 0.07]);
      return (
        <>
          <defs>
            {ball(p + 't', '#8a6640', 0.25, -0.4)}
            {ball(p + 'n', '#6d4b2b', 0.35, -0.35)}
          </defs>
          {halo(p + 'h', cx, cy, r * 0.9, r * 0.9, 0.28)}
          {fronds.map((f, i) => (
            <g key={i} transform={`translate(${n2(cx)} ${n2(cy)}) rotate(${n2(f.deg)})`}>
              <polygon points={f.body} fill={tone(c, f.lit - 0.25)} opacity={0.55} />
              <path d={f.leaflets} stroke={tone(c, f.lit + (i % 2 ? 0.04 : -0.04))} strokeWidth={n2(r * 0.024)} strokeLinecap="round" />
              <path d={`M${n2(f.len * 0.05)} 0Q${n2(f.len * 0.55)} ${n2(f.bend * 0.3)} ${n2(f.len)} ${n2(f.bend)}`} stroke={tone(c, 0.35 + f.lit)} strokeWidth={n2(r * 0.02)} fill="none" strokeLinecap="round" />
            </g>
          ))}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.17)} fill={`url(#${p}t)`} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.12)} fill="none" stroke="#5b4026" strokeWidth={n2(r * 0.03)} strokeDasharray={`${n2(r * 0.02)} ${n2(r * 0.025)}`} />
          {nuts.map(([x, y, s], i) => (
            <circle key={i} cx={n2(x)} cy={n2(y)} r={n2(s)} fill={`url(#${p}n)`} />
          ))}
        </>
      );
    },
  },
  bush: {
    label: 'Bush',
    group: 'trees',
    round: true,
    size: [0.8, 2.2],
    many: true,
    variants: choices(BUSHES),
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.97, r * 0.92)}
          {crown(p, cx, cy, r * 0.86, pick(o, BUSHES).c, random(o.seed + 'bush'), 11, 0.31, 12)}
        </>
      );
    },
  },
  floweringBush: {
    label: 'Flowering shrub',
    group: 'trees',
    round: true,
    size: [0.8, 2.5],
    many: true,
    variants: choices(BLOOMS),
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'bloom');
      const [c, light] = pick(o, BLOOMS, true).c;
      const heads = scatter(rnd, 26, cx, cy, r * 0.76, [r * 0.045, r * 0.07]);
      const flowers = heads.flatMap(([x, y, hs]) => Array.from({length: 5}, (_, k): Dot => [x + Math.cos(k * 1.26 + x) * hs * 0.55, y + Math.sin(k * 1.26 + x) * hs * 0.55, hs * 0.36]));
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.97, r * 0.92)}
          {crown(p, cx, cy, r * 0.86, '#3f7d38', rnd, 10, 0.33, 10)}
          <path d={circles(heads.map(([x, y, hs]) => [x + hs * 0.25, y + hs * 0.3, hs]))} fill="#1f3f1c" opacity={0.35} />
          <path d={circles(heads)} fill={tone(c, -0.12)} />
          <path d={circles(flowers.filter((f) => !litSide(f, cx, cy)))} fill={c} />
          <path d={circles(flowers.filter((f) => litSide(f, cx, cy)))} fill={light} />
          <path d={circles(heads.map(([x, y, hs]) => [x, y, hs * 0.14]))} fill="#f6d36a" />
        </>
      );
    },
  },
  butterflyBush: {
    label: 'Butterfly bush',
    group: 'trees',
    round: true,
    variants: choices(BUDDLEJAS),
    size: [1.2, 3],
    many: true,
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'buddleja');
      const c = pick(o, BUDDLEJAS, true).c;
      // long arching shoots from the middle, grey-green leaves along them, a cone of flowers at the end of each, butterflies
      // on two of them
      const shoots = Array.from({length: 12}, (_, i) => ({a: ((i + rnd() * 0.8) / 12) * 2 * PI, l: r * (0.44 + rnd() * 0.14), bend: (rnd() - 0.5) * 0.4}));
      const leaves = shoots.flatMap((sh) =>
        [0.35, 0.6, 0.85].map((t, k) => {
          const [x, y, a] = onStalk(cx, cy, sh.a, sh.l, sh.bend, t);
          return leaf(x, y, a + (k % 2 ? 0.8 : -0.8), r * 0.16, r * 0.045);
        }),
      );
      const tips = shoots.map((sh) => onStalk(cx, cy, sh.a, sh.l, sh.bend, 1));
      const florets = tips.flatMap(([x, y, a]) =>
        Array.from({length: 8}, (_, k): Dot => {
          const t = k / 7;
          const w = r * 0.07 * (1 - t * 0.75);
          const side = (rnd() - 0.5) * 2 * w;
          const out = r * 0.34 * t;
          return [x + Math.cos(a) * out - Math.sin(a) * side, y + Math.sin(a) * out + Math.cos(a) * side, r * (0.03 - t * 0.012)];
        }),
      );
      const [b1, b2] = [tips[Math.floor(rnd() * tips.length)], tips[Math.floor(rnd() * tips.length)]];
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.95, r * 0.9)}
          {crown(p, cx, cy, r * 0.62, '#647f58', rnd, 8, 0.36, 4)}
          <path d={shoots.map((sh) => stalk(cx, cy, sh.a, sh.l, sh.bend)).join('')} stroke="#5a5244" strokeWidth={n2(r * 0.014)} fill="none" strokeLinecap="round" />
          <path d={leaves.join('')} fill="#86a079" stroke="#55704a" strokeWidth={n2(r * 0.005)} />
          <path d={circles(florets.map(([x, y, s]) => [x + s * 0.3, y + s * 0.4, s]))} fill={tone(c, -0.5)} opacity={0.45} />
          <path d={circles(florets)} fill={tone(c, -0.1)} />
          <path d={circles(florets.filter((_, i) => i % 3 === 0).map(([x, y, s]) => [x - s * 0.25, y - s * 0.25, s * 0.6]))} fill={tone(c, 0.3)} />
          <path d={circles(florets.filter((_, i) => i % 4 === 1).map(([x, y, s]) => [x, y, s * 0.28]))} fill="#f2c230" opacity={0.8} />
          {butterfly(b1[0] + Math.cos(b1[2]) * r * 0.12, b1[1] + Math.sin(b1[2]) * r * 0.12, r * 0.16, b1[2] + 1.2, '#e8862a')}
          {butterfly(b2[0], b2[1], r * 0.13, b2[2] - 1, '#f2efe6')}
        </>
      );
    },
  },
  hydrangea: {
    label: 'Hydrangea',
    group: 'trees',
    round: true,
    variants: choices(HYDRANGEAS),
    size: [0.8, 2.2],
    many: true,
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'hydrangea');
      const [c, light] = pick(o, HYDRANGEAS, true).c;
      // a mound of big leaves full of round flower heads, each of many little florets, lighter where the light falls on it
      const heads = scatter(rnd, 13, cx, cy, r * 0.6, [r * 0.13, r * 0.17]);
      const florets = heads.flatMap(([x, y, s]) =>
        Array.from({length: 16}, (): [Dot, boolean] => {
          const a = rnd() * 2 * PI;
          const d = s * 0.82 * Math.sqrt(rnd());
          const [fx, fy] = [Math.cos(a) * d, Math.sin(a) * d];
          return [[x + fx, y + fy, s * 0.2], fx + fy < -s * 0.15];
        }),
      );
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.97, r * 0.92)}
          {crown(p, cx, cy, r * 0.88, '#3f7a35', rnd, 10, 0.35, 6)}
          <path d={circles(heads.map(([x, y, s]) => [x + s * 0.15, y + s * 0.22, s]))} fill="#1f3a1c" opacity={0.35} />
          <path d={circles(heads)} fill={tone(c, -0.12)} />
          <path d={circles(florets.filter(([, lit]) => !lit).map(([d]) => d))} fill={c} />
          <path d={circles(florets.filter(([, lit]) => lit).map(([d]) => d))} fill={light} />
          <path d={circles(florets.map(([[x, y, s]]) => [x, y, s * 0.28]))} fill={tone(c, -0.35)} opacity={0.45} />
        </>
      );
    },
  },
  rhododendron: {
    label: 'Rhododendron',
    group: 'trees',
    round: true,
    variants: choices(RHODOS),
    size: [1, 3],
    many: true,
    around: 'mulch',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'rhodo');
      const [c, light] = pick(o, RHODOS, true).c;
      // whorls of long leathery leaves, a truss of flowers in the middle of most of them
      const whorls = scatter(rnd, 22, cx, cy, r * 0.66, [r * 0.2, r * 0.26]);
      const leaves = whorls.flatMap(([x, y, s]) => Array.from({length: 7}, (_, k) => ({x, y, a: (k / 7) * 2 * PI + x * 0.7, s})));
      const flowers = whorls
        .filter((_, i) => i % 3 !== 2)
        .flatMap(([x, y, s]) => [
          ...Array.from({length: 7}, (_, k): Dot => {
            const a = (k / 7) * 2 * PI + y;
            return [x + Math.cos(a) * s * 0.36, y + Math.sin(a) * s * 0.36, s * 0.24];
          }),
          [x, y, s * 0.24] as Dot,
        ]);
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.97, r * 0.93)}
          {crown(p, cx, cy, r * 0.84, '#2a4f25', rnd, 10, 0.34, 0)}
          <path d={leaves.map((l) => leaf(l.x, l.y, l.a, l.s, l.s * 0.28)).join('')} fill="#2f5a2a" stroke="#1a3417" strokeWidth={n2(r * 0.006)} />
          <path d={leaves.filter((l) => Math.cos(l.a + (3 * PI) / 4) > 0).map((l) => leaf(l.x, l.y, l.a, l.s * 0.9, l.s * 0.12)).join('')} fill="#4f7d3f" opacity={0.6} />
          <path d={leaves.map((l) => stalk(l.x, l.y, l.a, l.s * 0.85, 0)).join('')} stroke="#6f9a5a" strokeOpacity={0.6} strokeWidth={n2(r * 0.006)} />
          <path d={circles(flowers.map(([x, y, s]) => [x + s * 0.2, y + s * 0.3, s]))} fill="#14260f" opacity={0.4} />
          <path d={circles(flowers)} fill={c} stroke={tone(c, -0.3)} strokeWidth={n2(r * 0.005)} />
          <path d={circles(flowers.map(([x, y, s]) => [x - s * 0.25, y - s * 0.25, s * 0.5]))} fill={light} opacity={0.75} />
          <path d={circles(flowers.map(([x, y, s]) => [x + s * 0.1, y + s * 0.05, s * 0.14]))} fill={tone(c, -0.45)} opacity={0.8} />
        </>
      );
    },
  },
  rose: {
    label: 'Rose bush',
    group: 'trees',
    round: true,
    variants: choices(ROSES),
    size: [0.6, 1.8],
    many: true,
    around: 'mulch',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'rose');
      const [c, light] = pick(o, ROSES, true).c;
      // a dark leafy bush with roses open on it, their petals curling round to a tight middle, a few buds
      const blooms = scatter(rnd, 11, cx, cy, r * 0.68, [r * 0.085, r * 0.12]);
      const buds = scatter(rnd, 6, cx, cy, r * 0.75, [r * 0.03, r * 0.04]);
      const swirl = (x: number, y: number, s: number) =>
        `M${n2(x + s * 0.55)} ${n2(y)}A${n2(s * 0.55)} ${n2(s * 0.55)} 0 1 1 ${n2(x)} ${n2(y - s * 0.55)}A${n2(s * 0.35)} ${n2(s * 0.35)} 0 1 1 ${n2(x - s * 0.1)} ${n2(y + s * 0.3)}A${n2(s * 0.15)} ${n2(s * 0.15)} 0 1 1 ${n2(x + s * 0.1)} ${n2(y - s * 0.05)}`;
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.97, r * 0.92)}
          {crown(p, cx, cy, r * 0.86, '#365f2c', rnd, 10, 0.33, 10)}
          <path d={circles(blooms.map(([x, y, s]) => [x + s * 0.2, y + s * 0.3, s]))} fill="#14260f" opacity={0.4} />
          <path d={circles(blooms)} fill={c} />
          <path d={circles(blooms.map(([x, y, s]) => [x - s * 0.2, y - s * 0.2, s * 0.6]))} fill={light} opacity={0.6} />
          <path d={blooms.map(([x, y, s]) => swirl(x, y, s)).join('')} fill="none" stroke={tone(c, -0.4)} strokeWidth={n2(r * 0.009)} />
          <path d={circles(buds)} fill={tone(c, -0.2)} stroke="#2f5a2a" strokeWidth={n2(r * 0.01)} />
        </>
      );
    },
  },
  boxwood: {
    label: 'Boxwood',
    group: 'trees',
    variants: choices(BOXES),
    size: [0.3, 1.4],
    many: true,
    around: 'gravel',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'box');
      const kind = pick(o, BOXES);
      const c = kind.c;
      const rr = r * 0.86;
      // clipped tight: a dense ball, cone or block of tiny leaves, the light on its top left
      const leaves = scatter(rnd, 150, cx, cy, rr * 1.02, [rr * 0.025, rr * 0.045]);
      const outline =
        kind.shape === 'block' ? (
          <rect x={n2(cx - rr)} y={n2(cy - rr)} width={n2(rr * 2)} height={n2(rr * 2)} rx={n2(rr * 0.2)} />
        ) : (
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(rr)} />
        );
      return (
        <>
          <defs>
            {kind.shape === 'block' ? face(p + 'b', c, 0.22, -0.28) : ball(p + 'b', c, 0.3, -0.42)}
            <clipPath id={p + 'k'}>{outline}</clipPath>
          </defs>
          {kind.shape === 'block' ? softBox(cx - rr, cy - rr, rr * 2, rr * 2, rr * 0.2, rr * 0.12) : halo(p + 'h', cx, cy, r, r * 0.96)}
          <g fill={`url(#${p}b)`}>{outline}</g>
          <g clipPath={`url(#${p}k)`}>
            <path d={circles(leaves.filter((l) => !litSide(l, cx, cy)))} fill={tone(c, -0.35)} opacity={0.5} />
            <path d={circles(leaves.filter((l) => litSide(l, cx, cy)))} fill={tone(c, 0.38)} opacity={0.5} />
            {kind.shape === 'cone' && (
              <path
                d={[0.3, 0.55, 0.8].map((f) => `M${n2(cx + rr * f)} ${n2(cy)}a${n2(rr * f)} ${n2(rr * f)} 0 1 0 ${n2(-2 * rr * f)} 0a${n2(rr * f)} ${n2(rr * f)} 0 1 0 ${n2(2 * rr * f)} 0`).join('')}
                fill="none"
                stroke={tone(c, -0.3)}
                strokeOpacity={0.4}
                strokeWidth={n2(rr * 0.04)}
              />
            )}
          </g>
          {kind.shape === 'cone' && <circle cx={n2(cx - rr * 0.03)} cy={n2(cy - rr * 0.03)} r={n2(rr * 0.07)} fill={tone(c, 0.45)} />}
          {kind.shape !== 'block' && rimLight(cx, cy, rr * 0.96, rr * 0.03, 0.3)}
        </>
      );
    },
  },
  japaneseMaple: {
    label: 'Japanese maple',
    group: 'trees',
    round: true,
    variants: choices(MAPLES),
    size: [1.2, 4],
    many: true,
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'maple');
      const c = pick(o, MAPLES).c;
      // a low wide crown of fine hand-shaped leaves, lighter on top where the light falls
      const star = (x: number, y: number, s: number, turn: number) =>
        'M' +
        Array.from({length: 14}, (_, k) => {
          const a = turn + (k / 14) * 2 * PI;
          const rr = k % 2 ? s * 0.42 : s;
          return `${n2(x + Math.cos(a) * rr)} ${n2(y + Math.sin(a) * rr)}`;
        }).join('L') +
        'Z';
      const leaves = scatter(rnd, 70, cx, cy, r * 0.82, [r * 0.06, r * 0.085]);
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.98, r * 0.92)}
          {crown(p, cx, cy, r * 0.88, c, rnd, 12, 0.3, 0)}
          <path d={leaves.filter((l) => !litSide(l, cx, cy)).map(([x, y, s]) => star(x, y, s, x)).join('')} fill={tone(c, -0.22)} />
          <path d={leaves.filter((l) => litSide(l, cx, cy)).map(([x, y, s]) => star(x, y, s, y)).join('')} fill={tone(c, 0.24)} />
        </>
      );
    },
  },
  bamboo: {
    label: 'Bamboo',
    group: 'trees',
    round: true,
    size: [1, 4],
    many: true,
    around: 'mulch',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'bamboo');
      // a clump of canes in the middle, narrow leaves on twigs all round it, lighter where the light falls
      const canes = scatter(rnd, 16, cx, cy, r * 0.28, [r * 0.035, r * 0.05]);
      const twigs = Array.from({length: 22}, () => ({a: rnd() * 2 * PI, l: r * (0.55 + rnd() * 0.4), bend: (rnd() - 0.5) * 0.4}));
      const leaves = twigs.flatMap((tw) =>
        Array.from({length: 6}, (_, k) => {
          const [x, y, a] = onStalk(cx, cy, tw.a, tw.l, tw.bend, 0.35 + k * 0.12);
          return {d: leaf(x, y, a + (k % 2 ? 0.6 : -0.6), r * 0.2, r * 0.035), lit: Math.cos(a + (3 * PI) / 4) > 0};
        }),
      );
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.95, r * 0.9)}
          <path d={leaves.filter((l) => !l.lit).map((l) => l.d).join('')} fill="#4f7f2f" stroke="#2f5a1f" strokeWidth={n2(r * 0.004)} />
          <path d={twigs.map((tw) => stalk(cx, cy, tw.a, tw.l * 0.9, tw.bend * 0.9)).join('')} stroke="#7a8a3a" strokeWidth={n2(r * 0.008)} fill="none" />
          <path d={leaves.filter((l) => l.lit).map((l) => l.d).join('')} fill="#7aa84a" stroke="#4f7f2f" strokeWidth={n2(r * 0.004)} />
          <path d={circles(canes)} fill="#a8b04a" stroke="#5f6a22" strokeWidth={n2(r * 0.01)} />
          <path d={circles(canes.map(([x, y, s]) => [x - s * 0.25, y - s * 0.25, s * 0.45]))} fill="#d4d88a" opacity={0.8} />
        </>
      );
    },
  },
  stump: {
    label: 'Tree stump',
    group: 'trees',
    round: true,
    variants: choices(STUMPS),
    size: [0.4, 1.4],
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'stump');
      const kind = pick(o, STUMPS);
      // the roots running off into the grass, the bark round the cut, growth rings round the heart a little off the
      // middle, cracks out from it, moss on the side in the shade
      const rs = r * 0.66;
      const [hx, hy] = [cx + rs * 0.1, cy + rs * 0.06];
      const roots = Array.from({length: 5}, (_, i) => {
        const a = ((i + rnd() * 0.6) / 5) * 2 * PI;
        const [ca, sa] = [Math.cos(a), Math.sin(a)];
        const len = r * (0.78 + rnd() * 0.16);
        const w = rs * (0.5 + rnd() * 0.16);
        const bend = (rnd() - 0.5) * 0.5;
        const at = (t: number, side: number): Pt => {
          const dd = rs * 0.55 + (len - rs * 0.55) * t;
          const off = (side * w * (1 - t * 0.7)) / 2 + bend * len * t * t * 0.25;
          return [cx + ca * dd - sa * off, cy + sa * dd + ca * off];
        };
        return {d: smooth([at(0, -1), at(0.35, -1), at(0.7, -1), at(0.95, -0.6), at(1, 0), at(0.95, 0.6), at(0.7, 1), at(0.35, 1), at(0, 1)]), end: at(0.92, 0)};
      });
      const bark = blob(cx, cy, rs, rs * 0.96, rnd, 16, 0.07);
      const cut = blob(cx, cy, rs * 0.83, rs * 0.8, rnd, 14, 0.05);
      const rings = [0.18, 0.34, 0.5, 0.64, 0.76].map((f) => smooth(blob(hx + (cx - hx) * f, hy + (cy - hy) * f, rs * 0.83 * f, rs * 0.8 * f, rnd, 12, 0.06)));
      const cracks = Array.from({length: 3}, () => {
        const a = rnd() * 2 * PI;
        const [r0, r1] = [rs * 0.08, rs * (0.45 + rnd() * 0.32)];
        return `M${n2(hx + Math.cos(a) * r0)} ${n2(hy + Math.sin(a) * r0)}L${n2(hx + Math.cos(a + 0.08) * (r0 + r1) / 2)} ${n2(hy + Math.sin(a + 0.08) * (r0 + r1) / 2)}L${n2(hx + Math.cos(a) * r1)} ${n2(hy + Math.sin(a) * r1)}`;
      });
      const barkLines = Array.from({length: 26}, (_, i) => {
        const a = (i / 26) * 2 * PI + rnd() * 0.1;
        const [r0, r1] = [rs * 0.86, rs * (0.95 + rnd() * 0.05)];
        return `M${n2(cx + Math.cos(a) * r0)} ${n2(cy + Math.sin(a) * r0)}L${n2(cx + Math.cos(a) * r1)} ${n2(cy + Math.sin(a) * r1)}`;
      }).join('');
      const moss = kind.moss
        ? Array.from({length: Math.round(10 * kind.moss) + 2}, (): Dot => {
            const a = PI * (0.05 + rnd() * 0.75);
            const dd = rs * (0.7 + rnd() * 0.32);
            return [cx + Math.cos(a) * dd, cy + Math.sin(a) * dd, rs * (0.07 + rnd() * 0.07)];
          })
        : [];
      const caps: Dot[] = kind.moss > 0.5 ? [[cx + rs * 0.95, cy + rs * 0.55, rs * 0.11], [cx + rs * 0.78, cy + rs * 0.82, rs * 0.08]] : [];
      return (
        <>
          <defs>
            {ball(p + 'c', kind.cut, 0.18, -0.2)}
          </defs>
          {halo(p + 'h', cx, cy, rs * 1.25, rs * 1.2)}
          {roots.map(({d}, i) => (
            <path key={i} d={d} fill={tone(kind.bark, 0.04)} stroke={tone(kind.bark, -0.4)} strokeWidth={n2(rs * 0.02)} />
          ))}
          <path d={roots.map(({end}) => tuft(1, end[0], end[1], rs * 1.4)).join('')} fill="#4c8a3a" />
          <path d={smooth(bark)} fill={kind.bark} stroke={tone(kind.bark, -0.45)} strokeWidth={n2(rs * 0.025)} />
          <path d={barkLines} stroke={tone(kind.bark, -0.4)} strokeWidth={n2(rs * 0.025)} strokeLinecap="round" />
          {rimLight(cx, cy, rs * 0.97, rs * 0.04, 0.25)}
          <path d={smooth(cut)} fill={`url(#${p}c)`} stroke={tone(kind.cut, -0.3)} strokeWidth={n2(rs * 0.02)} />
          <path d={rings.join('')} fill="none" stroke={tone(kind.cut, -0.2)} strokeOpacity={0.55} strokeWidth={n2(rs * 0.012)} />
          <path d={cracks.join('')} fill="none" stroke={tone(kind.cut, -0.55)} strokeWidth={n2(rs * 0.025)} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={n2(hx)} cy={n2(hy)} r={n2(rs * 0.04)} fill={tone(kind.cut, -0.4)} />
          {moss.length > 0 && (
            <>
              <path d={circles(moss)} fill="#5f8a3a" />
              <path d={circles(moss.map(([x, y, rr]): Dot => [x - rr * 0.25, y - rr * 0.25, rr * 0.5]))} fill="#86b04f" opacity={0.7} />
            </>
          )}
          {caps.length > 0 && (
            <>
              <path d={circles(caps)} fill="#b98d5a" stroke="#7a5a37" strokeWidth={n2(rs * 0.012)} />
              <path d={circles(caps.map(([x, y, rr]): Dot => [x - rr * 0.25, y - rr * 0.25, rr * 0.4]))} fill="#e2c495" />
            </>
          )}
        </>
      );
    },
  },
  hedge: {
    label: 'Hedge',
    group: 'trees',
    tile: {
      w: 2.4,
      h: 2.4,
      base: '#285824',
      draw: (m) => {
        const rnd = random('hedge');
        const body: Dot[] = Array.from({length: 46}, () => [rnd() * 2.4 * m, rnd() * 2.4 * m, (0.13 + rnd() * 0.14) * m]);
        // repeated over the edges too, the tile joins up without a seam
        const wrap = (list: Dot[]) =>
          list.flatMap(([x, y, r]) => [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j): Dot => [x + i * 2.4 * m, y + j * 2.4 * m, r])));
        return (
          <>
            <path d={circles(wrap(body.map(([x, y, r]) => [x + r * 0.15, y + r * 0.2, r])))} fill="#1d451b" />
            <path d={circles(wrap(body))} fill="#3a7633" />
            <path d={circles(wrap(body.map(([x, y, r]) => [x - r * 0.22, y - r * 0.25, r * 0.6])))} fill="#4a8b3d" />
            <path d={circles(wrap(body.map(([x, y, r]) => [x - r * 0.36, y - r * 0.38, r * 0.25])))} fill="#68a650" opacity={0.85} />
            <path d={circles(wrap(body.map(([x, y, r]) => [x + r * 0.3, y + r * 0.32, r * 0.18])))} fill="#24501f" opacity={0.6} />
          </>
        );
      },
    },
  },
  bed: {
    label: 'Mixed bed',
    group: 'beds',
    variants: choices(MIXED),
    fill: true,
    span: 3.6,
    around: 'mulch',
    thing: (b, p, o) => {
      const rnd = random(o.seed + 'mixed');
      const m = o.m ?? Math.max(b.w, b.h) / 1.6;
      const colors = pick(o, MIXED).c;
      // planted in drifts like a border, each of one kind: perennials with daisies, spikes or flat heads in one color,
      // grasses, low cushions and now and then a small shrub, about one drift per square meter
      const drifts = Array.from({length: Math.max(4, Math.round((b.w * b.h) / (m * m)))}, () => ({
        x: b.x + rnd() * b.w,
        y: b.y + rnd() * b.h,
        kind: MIXED_KINDS[Math.floor(rnd() * MIXED_KINDS.length)],
        c: colors[Math.floor(rnd() * colors.length)],
        s: 0.85 + rnd() * 0.35,
      }));
      // the drift a plant is in, round the tile's edges when it repeats
      const gap = (d: {x: number; y: number}, x: number, y: number) => {
        const [dx, dy] = [Math.abs(d.x - x), Math.abs(d.y - y)];
        return o.tile ? Math.hypot(Math.min(dx % b.w, b.w - (dx % b.w)), Math.min(dy % b.h, b.h - (dy % b.h))) : Math.hypot(dx, dy);
      };
      // a small shrub in the middle of its drift, low cushions round it
      const bushes = drifts
        .filter((d) => d.kind === 'shrub')
        .map((d, k) => ({x: d.x, y: d.y, r: (0.3 + (d.s - 0.85) * 0.4) * m, c: d.s > 1.15 ? '#6e3a3c' : d.s > 1 ? '#2f5e2a' : '#4a7f36', bloom: d.s <= 0.92, k}));
      const shadow: Dot[] = [];
      const low: [Dot, string][] = [];
      const leaves: [Dot, string][] = [];
      const flowers: [Dot, string][] = [];
      const hearts: [Dot, string][] = [];
      const grass: string[] = [];
      const lit = (list: [Dot, string][], ds: Dot[][], c: string) => {
        list.push(...ds[1].map((d): [Dot, string] => [d, c]), ...ds[2].map((d): [Dot, string] => [d, tone(c, 0.22)]));
        shadow.push(...ds[0]);
      };
      for (const {x, y, r: rnd} of spots(b, 0.3 * m, o.seed + 'mixed', o.tile, 320)) {
        if (bushes.some((q) => gap(q, x, y) < q.r * 0.8)) continue;
        const d = drifts.reduce((best, q) => (gap(q, x, y) < gap(best, x, y) ? q : best));
        const kind = d.kind === 'shrub' ? 'cushion' : d.kind;
        const s = (kind === 'cushion' ? 0.21 : 0.28) * (d.s + rnd() * 0.2) * m;
        if (kind === 'grass') {
          // a clump of grass, its blades fanning out over it
          lit(leaves, mound(x, y, s * 0.6, rnd), '#6d8f3a');
          for (let k = 0; k < 12; k++) grass.push(stalk(x, y, rnd() * 2 * PI, s * (0.9 + rnd() * 0.5), (rnd() - 0.5) * 0.5));
          continue;
        }
        if (kind === 'cushion') {
          lit(low, mound(x, y, s, rnd), '#5d7f4c');
          for (let k = 0; k < 6; k++) {
            const [a, r] = [rnd() * 2 * PI, s * 0.7 * Math.sqrt(rnd())];
            flowers.push([[x + Math.cos(a) * r, y + Math.sin(a) * r, s * 0.1], d.c]);
          }
          continue;
        }
        lit(leaves, mound(x, y, s, rnd), kind === 'spike' ? '#3f7d3a' : kind === 'heads' ? '#5a9440' : '#4a8a3a');
        if (kind === 'daisy') {
          for (let k = 0; k < 3; k++) {
            const [a, r] = [rnd() * 2 * PI, s * 0.6 * Math.sqrt(rnd())];
            const [fx, fy, fs] = [x + Math.cos(a) * r, y + Math.sin(a) * r, s * 0.24];
            for (let q = 0; q < 6; q++) flowers.push([[fx + Math.cos(q * 1.047 + fx) * fs * 0.6, fy + Math.sin(q * 1.047 + fx) * fs * 0.6, fs * 0.38], d.c]);
            hearts.push([[fx, fy, fs * 0.3], d.c === '#f2c230' || d.c === '#e8762a' ? '#5a3418' : '#f2c230']);
          }
        } else if (kind === 'spike') {
          for (let k = 0; k < 5; k++) {
            const a = rnd() * 2 * PI;
            for (let q = 0; q < 3; q++) flowers.push([[x + Math.cos(a) * s * (0.4 + q * 0.2), y + Math.sin(a) * s * (0.4 + q * 0.2), s * (0.09 - q * 0.015)], d.c]);
          }
        } else {
          for (let k = 0; k < 3; k++) {
            const [a, r] = [rnd() * 2 * PI, s * 0.5 * Math.sqrt(rnd())];
            const [fx, fy] = [x + Math.cos(a) * r, y + Math.sin(a) * r];
            for (let q = 0; q < 5; q++) flowers.push([[fx + (rnd() - 0.5) * s * 0.32, fy + (rnd() - 0.5) * s * 0.32, s * 0.07], d.c]);
          }
        }
      }
      // the shrubs once more past the other edge when the tile repeats
      const shifts = (q: {x: number; y: number; r: number}) =>
        (o.tile ? [-b.w, 0, b.w] : [0]).flatMap((dx) => (o.tile ? [-b.h, 0, b.h] : [0]).map((dy): Pt => [dx, dy]))
          .filter(([dx, dy]) => q.x + dx + q.r > b.x && q.x + dx - q.r < b.x + b.w && q.y + dy + q.r > b.y && q.y + dy - q.r < b.y + b.h);
      return (
        <>
          <rect x={n2(b.x)} y={n2(b.y)} width={n2(b.w)} height={n2(b.h)} fill="#3a3a26" />
          <path d={circles(shadow)} fill="#141f0e" opacity={0.4} />
          {byColor(low)}
          {byColor(leaves)}
          {byColor(flowers)}
          {byColor(hearts)}
          {grass.length > 0 && <path d={grass.join('')} stroke="#bcc47a" strokeWidth={n2(0.014 * m)} fill="none" strokeLinecap="round" />}
          {bushes.flatMap((q) =>
            shifts(q).map(([dx, dy], j) => {
              const [x, y] = [q.x + dx, q.y + dy];
              const rnd = random(o.seed + 'shrub' + q.k);
              const dots = q.bloom ? scatter(random(o.seed + 'bloom' + q.k), 9, x, y, q.r * 0.7, [q.r * 0.05, q.r * 0.08]) : [];
              return (
                <g key={`${q.k}_${j}`}>
                  <circle cx={n2(x + q.r * 0.12)} cy={n2(y + q.r * 0.16)} r={n2(q.r)} fill="#141f0e" opacity={0.4} />
                  {crown(`${p}s${q.k}_${j}`, x, y, q.r, q.c, rnd, 9, 0.33, 6)}
                  {dots.length > 0 && <path d={circles(dots)} fill="#f4f1ea" />}
                </g>
              );
            }),
          )}
        </>
      );
    },
  },
  perennialBed: {
    label: 'Perennial bed',
    group: 'beds',
    variants: choices(PERENNIALS),
    fill: true,
    around: 'mulch',
    thing: (b, p, o) => {
      const m = o.m ?? Math.max(b.w, b.h) / 1.6;
      const kind = pick(o, PERENNIALS);
      // clumps of perennials about 45 cm apart on dark soil, each a mound of leaves with its own kind of flowers: daisies,
      // spikes or flat heads, and in a prairie bed tufts of grass between them
      const leaves: Dot[][] = [[], [], []];
      const flowers: [Dot, string][] = [];
      const hearts: [Dot, string][] = [];
      const grass: string[] = [];
      for (const {x, y, r: rnd} of spots(b, 0.32 * m, o.seed + 'perennials', o.tile, 260)) {
        const s = (0.22 + rnd() * 0.08) * m;
        const what = rnd();
        const c = kind.c[Math.floor(rnd() * kind.c.length)];
        if (kind.grass && what < 0.25) {
          for (let k = 0; k < 14; k++) grass.push(stalk(x, y, rnd() * 2 * PI, s * (1 + rnd() * 0.5), (rnd() - 0.5) * 0.5));
          continue;
        }
        mound(x, y, s, rnd).forEach((d, i) => leaves[i].push(...d));
        if (what < 0.45) {
          for (let k = 0; k < 3; k++) {
            const [a, d] = [rnd() * 2 * PI, s * 0.6 * Math.sqrt(rnd())];
            const [fx, fy, fs] = [x + Math.cos(a) * d, y + Math.sin(a) * d, s * 0.24];
            for (let q = 0; q < 6; q++) flowers.push([[fx + Math.cos(q * 1.047 + fx) * fs * 0.6, fy + Math.sin(q * 1.047 + fx) * fs * 0.6, fs * 0.38], c]);
            hearts.push([[fx, fy, fs * 0.3], c === '#f2c230' || c === '#e8762a' ? '#5a3418' : '#f2c230']);
          }
        } else if (what < 0.75) {
          for (let k = 0; k < 5; k++) {
            const a = rnd() * 2 * PI;
            for (let q = 0; q < 3; q++) flowers.push([[x + Math.cos(a) * s * (0.4 + q * 0.2), y + Math.sin(a) * s * (0.4 + q * 0.2), s * (0.09 - q * 0.015)], c]);
          }
        } else {
          for (let k = 0; k < 3; k++) {
            const [a, d] = [rnd() * 2 * PI, s * 0.5 * Math.sqrt(rnd())];
            const [fx, fy] = [x + Math.cos(a) * d, y + Math.sin(a) * d];
            for (let q = 0; q < 5; q++) flowers.push([[fx + (rnd() - 0.5) * s * 0.32, fy + (rnd() - 0.5) * s * 0.32, s * 0.07], c]);
          }
        }
      }
      return (
        <>
          <rect x={n2(b.x)} y={n2(b.y)} width={n2(b.w)} height={n2(b.h)} fill="#33482a" />
          <path d={circles(leaves[0])} fill="#1f3a18" opacity={0.45} />
          <path d={circles(leaves[1])} fill="#4a8a3a" />
          <path d={circles(leaves[2])} fill="#6fa852" opacity={0.7} />
          {grass.length > 0 && <path d={grass.join('')} stroke="#b0b46e" strokeWidth={n2(0.018 * m)} fill="none" strokeLinecap="round" />}
          {byColor(flowers)}
          {byColor(hearts)}
        </>
      );
    },
  },
  roseBed: {
    label: 'Rose bed',
    group: 'beds',
    variants: choices(ROSES),
    fill: true,
    around: 'mulch',
    thing: (b, p, o) => {
      const rnd = random(o.seed + 'rosebed');
      const m = o.m ?? Math.max(b.w, b.h) / 1.6;
      const [c, light] = pick(o, ROSES, true).c;
      // rose bushes about half a meter apart on bark, dark leaves with open roses on them
      const leaves: Dot[][] = [[], [], []];
      const blooms: Dot[] = [];
      for (const {x, y, r: rnd} of spots(b, 0.36 * m, o.seed + 'rosebed', o.tile, 240)) {
        const s = (0.26 + rnd() * 0.06) * m;
        mound(x, y, s, rnd).forEach((d, i) => leaves[i].push(...d));
        for (let k = 0; k < 4; k++) {
          const [a, d] = [rnd() * 2 * PI, s * 0.55 * Math.sqrt(rnd())];
          blooms.push([x + Math.cos(a) * d, y + Math.sin(a) * d, s * (0.16 + rnd() * 0.05)]);
        }
      }
      return (
        <>
          {strewn('bark', b.x, b.y, b.w, b.h, m, rnd)}
          <path d={circles(leaves[0])} fill="#14260f" opacity={0.45} />
          <path d={circles(leaves[1])} fill="#30572a" />
          <path d={circles(leaves[2])} fill="#4a7a3a" opacity={0.7} />
          <path d={circles(blooms.map(([x, y, s]) => [x + s * 0.2, y + s * 0.3, s]))} fill="#0f1f0c" opacity={0.35} />
          <path d={circles(blooms)} fill={c} />
          <path d={circles(blooms.map(([x, y, s]) => [x - s * 0.2, y - s * 0.2, s * 0.55]))} fill={light} opacity={0.65} />
          <path d={circles(blooms.map(([x, y, s]) => [x + s * 0.05, y + s * 0.05, s * 0.22]))} fill={tone(c, -0.4)} opacity={0.6} />
        </>
      );
    },
  },
  springBed: {
    label: 'Spring bed',
    group: 'beds',
    variants: choices(SPRING),
    fill: true,
    around: 'soil',
    thing: (b, p, o) => {
      const rnd = random(o.seed + 'spring');
      const m = o.m ?? Math.max(b.w, b.h) / 1.6;
      const colors = pick(o, SPRING).c;
      // tulips in drifts of one color each, two broad grey-green leaves under each cup
      const drifts = Array.from({length: 6}, () => ({x: b.x + rnd() * b.w, y: b.y + rnd() * b.h, c: colors[Math.floor(rnd() * colors.length)]}));
      const leaves: string[] = [];
      const cups: [Dot, string][] = [];
      for (const {x, y, r: rnd} of spots(b, 0.12 * m, o.seed + 'spring', o.tile, 520)) {
        // the drift a tulip is in, round the tile's edges when it repeats
        const gap = (d: {x: number; y: number}) => {
          const [dx, dy] = [Math.abs(d.x - x), Math.abs(d.y - y)];
          return o.tile ? Math.hypot(Math.min(dx % b.w, b.w - (dx % b.w)), Math.min(dy % b.h, b.h - (dy % b.h))) : Math.hypot(dx, dy);
        };
        const near = drifts.reduce((best, d) => (gap(d) < gap(best) ? d : best));
        const s = (0.035 + rnd() * 0.01) * m;
        const a = rnd() * PI;
        leaves.push(leaf(x, y, a, s * 3.8, s * 1.1), leaf(x, y, a + PI + (rnd() - 0.5), s * 3.4, s * 1));
        cups.push([[x, y, s], near.c]);
      }
      return (
        <>
          <rect x={n2(b.x)} y={n2(b.y)} width={n2(b.w)} height={n2(b.h)} fill="#4a4f30" />
          <path d={leaves.join('')} fill="#7f9a6a" stroke="#56704a" strokeWidth={n2(0.004 * m)} />
          <path d={circles(cups.map(([[x, y, s]]) => [x + s * 0.25, y + s * 0.35, s]))} fill="#000" opacity={0.25} />
          {byColor(cups)}
          {byColor(cups.map(([[x, y, s], c]) => [[x - s * 0.15, y - s * 0.15, s * 0.55], tone(c, 0.3)]))}
          <path d={circles(cups.map(([[x, y, s]]) => [x + s * 0.05, y + s * 0.05, s * 0.22]))} fill="#2a2018" opacity={0.6} />
        </>
      );
    },
  },
  summerBed: {
    label: 'Summer flowers',
    group: 'beds',
    variants: choices(SUMMER),
    fill: true,
    around: 'soil',
    thing: (b, p, o) => {
      const m = o.m ?? Math.max(b.w, b.h) / 1.6;
      const colors = pick(o, SUMMER).c;
      // a dense carpet of low leaves covered in flowers of every color
      const leaves: Dot[][] = [[], [], []];
      const flowers: [number, number, number, string][] = [];
      for (const {x, y, r: rnd} of spots(b, 0.2 * m, o.seed + 'summer', o.tile, 340)) {
        const s = (0.14 + rnd() * 0.03) * m;
        mound(x, y, s, rnd).forEach((d, i) => leaves[i].push(...d));
        for (let k = 0; k < 3; k++) {
          const [a, d] = [rnd() * 2 * PI, s * 0.6 * Math.sqrt(rnd())];
          flowers.push([x + Math.cos(a) * d, y + Math.sin(a) * d, s * (0.32 + rnd() * 0.1), colors[Math.floor(rnd() * colors.length)]]);
        }
      }
      return (
        <>
          <rect x={n2(b.x)} y={n2(b.y)} width={n2(b.w)} height={n2(b.h)} fill="#33482a" />
          <path d={circles(leaves[0])} fill="#1f3a18" opacity={0.4} />
          <path d={circles(leaves[1])} fill="#4f8f3c" />
          <path d={circles(leaves[2])} fill="#72ad55" opacity={0.6} />
          {blossoms(flowers)}
        </>
      );
    },
  },
  groundCover: {
    label: 'Ground cover',
    group: 'beds',
    variants: choices(GROUND_COVERS),
    fill: true,
    around: 'soil',
    thing: (b, p, o) => {
      const m = o.m ?? Math.max(b.w, b.h) / 1.6;
      const kind = pick(o, GROUND_COVERS);
      // small leaves close together in three shades, little flowers here and there
      const shades: string[][] = [[], [], []];
      const flowers: [number, number, number, string][] = [];
      for (const {x, y, r: rnd} of spots(b, 0.075 * m, o.seed + 'cover', o.tile, 1100)) {
        const s = (0.045 + rnd() * 0.02) * m;
        const [jx, jy] = [x + (rnd() - 0.5) * 0.05 * m, y + (rnd() - 0.5) * 0.05 * m];
        shades[Math.floor(rnd() * 3)].push(leaf(jx, jy, rnd() * 2 * PI, s, s * 0.45));
        if (kind.bloom && rnd() < 0.16) flowers.push([jx, jy, s * 0.55, kind.bloom]);
      }
      return (
        <>
          <rect x={n2(b.x)} y={n2(b.y)} width={n2(b.w)} height={n2(b.h)} fill={tone(kind.c, -0.45)} />
          {shades.map((d, k) => (
            <path key={k} d={d.join('')} fill={tone(kind.c, (k - 1) * 0.18)} />
          ))}
          {flowers.length > 0 && blossoms(flowers)}
        </>
      );
    },
  },
  flowerMeadow: {
    label: 'Wildflowers',
    group: 'beds',
    tile: {
      w: 1.6,
      h: 1.6,
      base: '#5e8f3b',
      draw: (m) => {
        const grass = tileScatter('wild', 26, 1.6, 1.6);
        const flowers = tileScatter('wildflowers', 30, 1.6, 1.6);
        const colors = ['#f7f4ec', '#d9382e', '#4f7fd6', '#f2c230', '#f7f4ec', '#b56ad6', '#f7f4ec', '#e98bb5'];
        return (
          <>
            {grass.map(([x, y], i) => (
              <path key={i} d={tuft(m, x, y, 1 + (i % 3) * 0.25)} fill={['#4a7a2e', '#78a64e', '#5d8f3c'][i % 3]} />
            ))}
            {blossoms(flowers.map(([x, y], i) => [x * m, y * m, (0.032 + (i % 4) * 0.008) * m, colors[i % colors.length]]))}
          </>
        );
      },
    },
  },
  vegetables: {
    label: 'Vegetable patch',
    group: 'beds',
    tile: {
      w: 0.9,
      h: 0.6,
      base: '#5a3e2c',
      draw: (m) => (
        <>
          <rect y={0.25 * m} width={0.9 * m} height={0.1 * m} fill="#6e4d37" />
          <rect y={0.55 * m} width={0.9 * m} height={0.05 * m} fill="#6e4d37" />
          <rect width={0.9 * m} height={0.05 * m} fill="#6e4d37" />
          {[0.15, 0.45, 0.75].map((x, i) => (
            <g key={x}>
              <circle cx={n2(x * m + 0.02 * m)} cy={n2(0.155 * m)} r={n2(0.11 * m)} fill="#000" opacity={0.2} />
              {rosette(x * m, 0.13 * m, 0.11 * m, i === 1 ? '#6f9b8b' : '#62a845', i === 1 ? 9 : 7)}
            </g>
          ))}
          {[0.08, 0.22, 0.36, 0.5, 0.64, 0.78].map((x) => (
            <path
              key={x}
              d={`M${n2(x * m)} ${n2(0.45 * m)}l${n2(-0.035 * m)} ${n2(-0.06 * m)}M${n2(x * m)} ${n2(0.45 * m)}l${n2(0.035 * m)} ${n2(-0.06 * m)}M${n2(x * m)} ${n2(0.45 * m)}l0 ${n2(-0.075 * m)}M${n2(x * m)} ${n2(0.45 * m)}l${n2(-0.05 * m)} ${n2(-0.02 * m)}M${n2(x * m)} ${n2(0.45 * m)}l${n2(0.05 * m)} ${n2(-0.02 * m)}`}
              stroke="#3d7a2c"
              strokeWidth={n2(0.012 * m)}
              strokeLinecap="round"
            />
          ))}
          {dots(m, [
            [0.08, 0.452, 0.014, '#e57c27'],
            [0.36, 0.452, 0.014, '#e57c27'],
            [0.64, 0.452, 0.014, '#e57c27'],
          ])}
        </>
      ),
    },
  },
  raisedBed: {
    label: 'Raised bed',
    group: 'beds',
    deep: 1.4,
    long: true,
    around: 'meadow',
    thing: (b, p, o) =>
      along(inset(b, 0.05), (l, d) => {
        const rnd = random(o.seed + 'raised');
        const f = d * 0.1;
        const [sx, sy, sw, sh] = [-l / 2 + f, -d / 2 + f, l - 2 * f, d - 2 * f];
        const n = Math.max(2, Math.round(sw / (sh / 2)));
        const plants = [-1, 1].flatMap((row) =>
          Array.from({length: n}, (_, i) => ({x: sx + (sw * (i + 0.5)) / n, y: (row * sh) / 4, kind: (i + (row > 0 ? 1 : 0)) % 3})),
        );
        const s = Math.min(sw / n, sh / 2) * 0.42;
        return (
          <>
            <defs>
              {face(p + 'w', WOOD, 0.14, -0.14)}
              {face(p + 's', '#5a3d2b', 0.05, -0.12)}
            </defs>
            {softBox(-l / 2, -d / 2, l, d, f * 0.3, d * 0.06)}
            <rect x={n2(-l / 2)} y={n2(-d / 2)} width={n2(l)} height={n2(d)} rx={n2(f * 0.3)} fill={`url(#${p}w)`} />
            <path
              d={`M${n2(-l / 2 + f * 0.5)} ${n2(-d / 2 + f * 0.5)}H${n2(l / 2 - f * 0.5)}V${n2(d / 2 - f * 0.5)}H${n2(-l / 2 + f * 0.5)}Z`}
              fill="none"
              stroke={tone(WOOD, -0.3)}
              strokeOpacity={0.5}
              strokeWidth={n2(f * 0.08)}
            />
            <rect x={n2(sx)} y={n2(sy)} width={n2(sw)} height={n2(sh)} fill={`url(#${p}s)`} />
            <path d={circles(scatter(rnd, 24, 0, 0, Math.min(sw, sh) * 0.5, [f * 0.05, f * 0.1]).map(([x, y, r]) => [x * (sw / sh), y, r]))} fill="#7a5640" opacity={0.6} />
            <rect x={n2(sx)} y={n2(sy)} width={n2(sw)} height={n2(f * 0.45)} fill="#000" opacity={0.25} />
            <rect x={n2(sx)} y={n2(sy)} width={n2(f * 0.45)} height={n2(sh)} fill="#000" opacity={0.2} />
            {[-1, 1].flatMap((i) =>
              [-1, 1].map((j) => (
                <rect key={`${i}${j}`} x={n2(i * (l / 2 - f / 2) - f / 2)} y={n2(j * (d / 2 - f / 2) - f / 2)} width={n2(f)} height={n2(f)} fill={tone(WOOD, -0.22)} />
              )),
            )}
            {plants.map(({x, y, kind}, i) =>
              kind === 2 ? (
                <g key={i}>
                  <path d={circles(scatter(rnd, 7, x, y, s * 0.9, [s * 0.18, s * 0.3]))} fill="#2f6b2c" />
                  <path d={circles(scatter(rnd, 5, x - s * 0.15, y - s * 0.15, s * 0.6, [s * 0.1, s * 0.18]))} fill="#5a9c45" />
                </g>
              ) : (
                rosette(x, y, s, kind ? '#6db04f' : '#8a3f5a', 8)
              ),
            )}
          </>
        );
      }),
  },
  lavender: {
    label: 'Lavender',
    group: 'plants',
    round: true,
    variants: choices(LAVENDERS),
    size: [0.4, 1],
    many: true,
    around: 'gravel',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'lavender');
      const c = pick(o, LAVENDERS).c;
      // a round silvery cushion of fine leaves, flower spikes on thin stalks out all round it
      const stalks = Array.from({length: 34}, () => ({a: rnd() * 2 * PI, l: r * (0.62 + rnd() * 0.3), bend: (rnd() - 0.5) * 0.3}));
      const spikes = stalks.flatMap((st) =>
        Array.from({length: 5}, (_, k): Dot => {
          const [x, y] = onStalk(cx, cy, st.a, st.l, st.bend, 0.72 + k * 0.07);
          return [x, y, r * (0.04 - k * 0.004)];
        }),
      );
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.9, r * 0.86)}
          {crown(p, cx, cy, r * 0.6, '#8aa085', rnd, 9, 0.32, 0)}
          <path d={stalks.map((st) => stalk(cx, cy, st.a, st.l * 0.72, st.bend * 0.72)).join('')} stroke="#a3b59e" strokeWidth={n2(r * 0.012)} fill="none" />
          <path d={circles(spikes.map(([x, y, s]) => [x + s * 0.3, y + s * 0.4, s]))} fill="#000" opacity={0.18} />
          <path d={circles(spikes)} fill={tone(c, -0.15)} />
          <path d={circles(spikes.filter((_, i) => i % 2).map(([x, y, s]) => [x - s * 0.3, y - s * 0.3, s * 0.6]))} fill={tone(c, 0.3)} />
        </>
      );
    },
  },
  fern: {
    label: 'Fern',
    group: 'plants',
    round: true,
    variants: choices(FERNS),
    size: [0.4, 1.5],
    many: true,
    around: 'mulch',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'fern');
      const c = pick(o, FERNS).c;
      // fronds from the middle, leaflets in pairs along each, longest a third of the way out, young ones curled up in the
      // middle
      const fronds = Array.from({length: 11}, (_, i) => ({a: ((i + rnd() * 0.6) / 11) * 2 * PI, l: r * (0.78 + rnd() * 0.18), bend: (rnd() - 0.5) * 0.35}));
      const pinnae = (f: (typeof fronds)[number]) =>
        Array.from({length: 13}, (_, k) => {
          const t = 0.12 + (k / 12) * 0.86;
          const [x, y, a] = onStalk(cx, cy, f.a, f.l, f.bend, t);
          const len = r * 0.2 * Math.sin(PI * Math.min(1, t * 1.1)) * (1 - t * 0.35);
          return [-1, 1].map((sd) => leaf(x, y, a + sd * 1.05, len, len * 0.22)).join('');
        }).join('');
      const lit = (f: (typeof fronds)[number]) => Math.cos(f.a + (3 * PI) / 4) > 0;
      const curls = Array.from({length: 3}, (_, k) => {
        const a = (k / 3) * 2 * PI + rnd();
        const [x, y] = [cx + Math.cos(a) * r * 0.07, cy + Math.sin(a) * r * 0.07];
        const s = r * 0.035;
        return `M${n2(x + s)} ${n2(y)}A${n2(s)} ${n2(s)} 0 1 1 ${n2(x)} ${n2(y - s)}A${n2(s * 0.5)} ${n2(s * 0.5)} 0 1 1 ${n2(x + s * 0.2)} ${n2(y + s * 0.4)}`;
      });
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.85, r * 0.8)}
          <path d={fronds.filter((f) => !lit(f)).map(pinnae).join('')} fill={tone(c, -0.15)} stroke={tone(c, -0.42)} strokeWidth={n2(r * 0.004)} />
          <path d={fronds.filter(lit).map(pinnae).join('')} fill={tone(c, 0.14)} stroke={tone(c, -0.3)} strokeWidth={n2(r * 0.004)} />
          <path d={fronds.map((f) => stalk(cx, cy, f.a, f.l, f.bend)).join('')} stroke={tone(c, -0.35)} strokeWidth={n2(r * 0.012)} fill="none" />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.09)} fill={tone(c, -0.3)} />
          <path d={curls.join('')} fill="none" stroke={tone(c, 0.35)} strokeWidth={n2(r * 0.018)} strokeLinecap="round" />
        </>
      );
    },
  },
  grass: {
    label: 'Ornamental grass',
    group: 'plants',
    round: true,
    variants: choices(GRASSES),
    size: [0.4, 2.2],
    many: true,
    around: 'gravel',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'grass');
      const kind = pick(o, GRASSES);
      // blades arching out from the middle in three shades, feathery plumes over them (the low blue fescue has none)
      const blades = Array.from({length: kind.low ? 70 : 54}, () => ({
        a: rnd() * 2 * PI,
        l: r * (kind.low ? 0.55 + rnd() * 0.35 : 0.6 + rnd() * 0.38),
        bend: (rnd() - 0.5) * 0.5,
        k: Math.floor(rnd() * 3),
      }));
      const plumes = kind.plume ? Array.from({length: 9}, () => ({a: rnd() * 2 * PI, l: r * (0.55 + rnd() * 0.35), bend: (rnd() - 0.5) * 0.3})) : [];
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.85, r * 0.8)}
          {[-0.25, 0, 0.25].map((t, k) => (
            <path
              key={k}
              d={blades
                .filter((bl) => bl.k === k)
                .map((bl) => stalk(cx, cy, bl.a, bl.l, bl.bend))
                .join('')}
              stroke={tone(kind.c, t)}
              strokeWidth={n2(r * (kind.low ? 0.016 : 0.02))}
              fill="none"
              strokeLinecap="round"
            />
          ))}
          {kind.plume && (
            <path
              d={plumes
                .map((pl) => {
                  const [x, y, a] = onStalk(cx, cy, pl.a, pl.l, pl.bend, 0.68);
                  return leaf(x, y, a, r * 0.34, r * 0.08);
                })
                .join('')}
              fill={kind.plume}
              opacity={0.88}
              stroke={tone(kind.plume, -0.22)}
              strokeWidth={n2(r * 0.006)}
            />
          )}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.1)} fill={tone(kind.c, -0.35)} />
        </>
      );
    },
  },
  hosta: {
    label: 'Hosta',
    group: 'plants',
    round: true,
    variants: choices(HOSTAS),
    size: [0.4, 1.2],
    many: true,
    around: 'mulch',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'hosta');
      const kind = pick(o, HOSTAS);
      // broad leaves from the middle in two rings, the inner ones over them, veins curving along each
      const ring = (n: number, l: number) => {
        const turn = rnd() * 2 * PI;
        return Array.from({length: n}, (_, k) => ({a: turn + ((k + rnd() * 0.3) / n) * 2 * PI, l: r * l * (0.9 + rnd() * 0.15)}));
      };
      const veins = (ls: {a: number; l: number}[]) =>
        ls
          .map(({a, l}) => {
            const [x, y] = [cx + Math.cos(a) * r * 0.08, cy + Math.sin(a) * r * 0.08];
            const side = [0.3, 0.55].flatMap((t) => [-1, 1].map((sd) => stalk(x + Math.cos(a) * l * t, y + Math.sin(a) * l * t, a + sd * 0.55, l * 0.24, -sd * 0.1)));
            return stalk(x, y, a, l * 0.88, 0) + side.join('');
          })
          .join('');
      const layer = (ls: {a: number; l: number}[], c: string) => (
        <>
          <path
            d={ls.map(({a, l}) => leaf(cx + Math.cos(a) * r * 0.08, cy + Math.sin(a) * r * 0.08, a, l, l * 0.5)).join('')}
            fill={c}
            stroke={kind.edge ?? tone(c, -0.35)}
            strokeWidth={n2(kind.edge ? r * 0.022 : r * 0.008)}
          />
          <path d={veins(ls)} fill="none" stroke={tone(c, 0.3)} strokeOpacity={0.55} strokeWidth={n2(r * 0.008)} />
        </>
      );
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.95, r * 0.9)}
          {layer(ring(9, 0.88), tone(kind.c, -0.1))}
          {layer(ring(6, 0.6), tone(kind.c, 0.1))}
        </>
      );
    },
  },
  pot: {
    label: 'Planter',
    group: 'plants',
    round: true,
    size: [0.4, 1.2],
    many: true,
    variants: choices(POTS),
    around: 'paving',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'pot');
      const rp = r * 0.82;
      const flowers = scatter(rnd, 7, cx, cy, rp * 0.55, [rp * 0.07, rp * 0.09]);
      return (
        <>
          <defs>{ball(p + 't', '#c56a3d', 0.28, -0.35)}</defs>
          {halo(p + 'h', cx, cy, r, r)}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(rp)} fill={`url(#${p}t)`} />
          {rimLight(cx, cy, rp * 0.95, rp * 0.03)}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(rp * 0.84)} fill={tone('#c56a3d', -0.35)} />
          <circle cx={n2(cx + rp * 0.03)} cy={n2(cy + rp * 0.04)} r={n2(rp * 0.78)} fill="#4a3324" />
          {crown(p, cx, cy, rp * 0.7, '#4f8f3c', rnd, 7, 0.38, 4)}
          {blossoms(flowers.map(([x, y, s]) => [x, y, s, pick(o, POTS, true).c]))}
        </>
      );
    },
  },
  herbSpiral: {
    label: 'Herb spiral',
    group: 'beds',
    size: [1.4, 3.5],
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'herbs');
      const turns = 2.1;
      const path: Pt[] = Array.from({length: 90}, (_, i) => {
        const t = i / 89;
        const a = t * turns * 2 * PI - PI / 2;
        const rr = r * (0.1 + 0.78 * t);
        return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
      });
      const line = 'M' + path.map(([x, y]) => `${n2(x)} ${n2(y)}`).join('L');
      // the herbs in the bed between the turns of the wall
      const herbs = Array.from({length: 16}, (_, i) => {
        const t = 0.04 + (i / 16) * 0.86;
        const a = t * turns * 2 * PI - PI / 2 + 0.4;
        const rr = r * (0.1 + 0.78 * t) - r * 0.15;
        return {x: cx + Math.cos(a) * Math.max(r * 0.06, rr), y: cy + Math.sin(a) * Math.max(r * 0.06, rr), kind: i % 5};
      });
      const end = path[path.length - 1];
      const s = r * 0.1;
      return (
        <>
          <defs>{deep(p + 'w', WATER)}</defs>
          {halo(p + 'h', cx, cy, r, r)}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.9)} fill="#5b3f2c" />
          <path d={line} stroke="#000" strokeOpacity={0.3} strokeWidth={n2(r * 0.12)} fill="none" strokeLinecap="round" transform={`translate(${n2(r * 0.025)} ${n2(r * 0.035)})`} />
          <path d={line} stroke="#9e9788" strokeWidth={n2(r * 0.11)} fill="none" strokeLinecap="round" />
          <path d={line} stroke="#cdc6b6" strokeWidth={n2(r * 0.075)} fill="none" strokeDasharray={`${n2(r * 0.06)} ${n2(r * 0.025)}`} strokeLinecap="round" />
          <path d={line} stroke="#e4ded1" strokeOpacity={0.6} strokeWidth={n2(r * 0.025)} fill="none" strokeDasharray={`${n2(r * 0.04)} ${n2(r * 0.045)}`} transform={`translate(${n2(-r * 0.012)} ${n2(-r * 0.016)})`} />
          {herbs.map(({x, y, kind}, i) =>
            kind === 0 ? (
              <g key={i}>
                <path d={circles(scatter(rnd, 6, x, y, s, [s * 0.25, s * 0.4]))} fill="#7f9878" />
                <path d={circles(scatter(rnd, 7, x, y, s * 1.1, [s * 0.1, s * 0.14]))} fill="#8a64c0" />
              </g>
            ) : kind === 1 ? (
              <path key={i} d={circles(scatter(rnd, 7, x, y, s * 0.9, [s * 0.2, s * 0.32]))} fill="#8faa86" stroke="#6b8563" strokeWidth={n2(s * 0.05)} />
            ) : kind === 2 ? (
              rosette(x, y, s * 1.1, '#5fb04a', 6)
            ) : kind === 3 ? (
              <path
                key={i}
                d={Array.from({length: 10}, (_, k) => `M${n2(x)} ${n2(y)}l${n2(Math.cos(k * 0.63) * s * 1.1)} ${n2(Math.sin(k * 0.63) * s * 1.1)}`).join('')}
                stroke="#3f6b45"
                strokeWidth={n2(s * 0.12)}
                strokeLinecap="round"
              />
            ) : (
              <path key={i} d={circles(scatter(rnd, 12, x, y, s, [s * 0.1, s * 0.16]))} fill="#55803a" />
            ),
          )}
          <path d={smooth(blob(end[0], end[1] + r * 0.02, r * 0.16, r * 0.11, rnd, 9, 0.12))} fill="#8f897b" />
          <path d={smooth(blob(end[0], end[1] + r * 0.02, r * 0.12, r * 0.08, rnd, 9, 0.1))} fill={`url(#${p}w)`} />
        </>
      );
    },
  },
  herbGarden: {
    label: 'Herb garden',
    group: 'beds',
    variants: choices(EDGINGS),
    fill: true,
    edged: true,
    around: 'soil',
    thing: (b, p, o) => {
      const rnd = random(o.seed + 'herbs');
      const m = o.m ?? Math.max(b.w, b.h) / 1.6;
      const edging = pick(o, EDGINGS);
      // herbs about 30 cm apart on dark soil (basil, sage, parsley, chives with their purple balls, thyme, rosemary) and a
      // border of stones, bricks or logs along the edge
      // the border: along the area's edge, half of it inside (the map cuts the rest), round the box without one
      const edge = o.edge?.length
        ? 'M' + o.edge.map(([x, y]) => `${n2(x)} ${n2(y)}`).join('L') + 'Z'
        : `M${n2(b.x)} ${n2(b.y)}h${n2(b.w)}v${n2(b.h)}h${n2(-b.w)}Z`;
      const c = edging.c;
      const border =
        edging.kind === 'wood' ? (
          <>
            <path d={edge} fill="none" stroke={tone(c, -0.4)} strokeWidth={n2(0.24 * m)} strokeLinecap="round" strokeDasharray={`0.001 ${n2(0.13 * m)}`} />
            <path d={edge} fill="none" stroke={c} strokeWidth={n2(0.2 * m)} strokeLinecap="round" strokeDasharray={`0.001 ${n2(0.13 * m)}`} />
            <path d={edge} fill="none" stroke={tone(c, 0.3)} strokeWidth={n2(0.1 * m)} strokeLinecap="round" strokeDasharray={`0.001 ${n2(0.13 * m)}`} />
          </>
        ) : (
          <>
            <path d={edge} fill="none" stroke={edging.kind === 'brick' ? '#cfc5b5' : tone(c, -0.45)} strokeWidth={n2(0.34 * m)} strokeLinejoin="round" />
            <path
              d={edge}
              fill="none"
              stroke={c}
              strokeWidth={n2(0.3 * m)}
              strokeLinejoin="round"
              strokeDasharray={edging.kind === 'brick' ? `${n2(0.22 * m)} ${n2(0.015 * m)}` : `${n2(0.17 * m)} ${n2(0.04 * m)} ${n2(0.23 * m)} ${n2(0.035 * m)}`}
            />
            <path
              d={edge}
              fill="none"
              stroke={tone(c, 0.28)}
              strokeOpacity={0.7}
              strokeWidth={n2(0.12 * m)}
              strokeLinejoin="round"
              strokeDasharray={edging.kind === 'brick' ? `${n2(0.22 * m)} ${n2(0.015 * m)}` : `${n2(0.17 * m)} ${n2(0.04 * m)} ${n2(0.23 * m)} ${n2(0.035 * m)}`}
            />
          </>
        );
      if (o.border) return border;
      const leaves = new Map<string, string[]>();
      const lines = new Map<string, string[]>();
      const dotsOf: [Dot, string][] = [];
      const add = (map: Map<string, string[]>, c: string, d: string) => map.set(c, [...(map.get(c) ?? []), d]);
      for (const {x, y, r: rnd} of spots(b, 0.25 * m, o.seed + 'herbs', o.tile, 300)) {
        const s = (0.13 + rnd() * 0.04) * m;
        const turn = rnd() * 2 * PI;
        const kind = Math.floor(rnd() * 6);
        const ring = (n: number, f: (a: number) => void) => Array.from({length: n}, (_, k) => f(turn + (k / n) * 2 * PI));
        if (kind === 0) ring(6, (a) => add(leaves, '#5fae3f', leaf(x, y, a, s, s * 0.55)));
        else if (kind === 1) ring(7, (a) => add(leaves, '#93a98d', leaf(x, y, a, s * 0.9, s * 0.42)));
        else if (kind === 2) {
          for (let k = 0; k < 12; k++) {
            const [a, d] = [rnd() * 2 * PI, s * 0.7 * Math.sqrt(rnd())];
            dotsOf.push([[x + Math.cos(a) * d, y + Math.sin(a) * d, s * 0.2], k % 3 ? '#3f7f2f' : '#5a9a3f']);
          }
        } else if (kind === 3) {
          ring(14, (a) => add(lines, '#5f9a3f', stalk(x, y, a, s * (0.8 + rnd() * 0.3), (rnd() - 0.5) * 0.3)));
          for (let k = 0; k < 3; k++) dotsOf.push([[x + Math.cos(turn + k * 2.1) * s * 0.6, y + Math.sin(turn + k * 2.1) * s * 0.6, s * 0.14], '#b48ad8']);
        } else if (kind === 4) {
          for (let k = 0; k < 16; k++) {
            const [a, d] = [rnd() * 2 * PI, s * 0.75 * Math.sqrt(rnd())];
            dotsOf.push([[x + Math.cos(a) * d, y + Math.sin(a) * d, s * 0.12], k % 5 ? '#7f9a6a' : '#d9a3d0']);
          }
        } else {
          ring(22, (a) => add(lines, '#4f6f4a', stalk(x, y, a, s * (0.7 + rnd() * 0.3), 0)));
          for (let k = 0; k < 3; k++) dotsOf.push([[x + Math.cos(turn + k * 2) * s * 0.4, y + Math.sin(turn + k * 2) * s * 0.4, s * 0.08], '#a9bde8']);
        }
      }
      return (
        <>
          <rect x={n2(b.x)} y={n2(b.y)} width={n2(b.w)} height={n2(b.h)} fill="#4f3a2a" />
          {dots(1, Array.from({length: Math.min(300, Math.round(((b.w * b.h) / (m * m)) * 60))}, (): [number, number, number, string] => [b.x + rnd() * b.w, b.y + rnd() * b.h, (0.01 + rnd() * 0.01) * m, rnd() < 0.5 ? '#3f2e22' : '#6a4f3a']))}
          {[...leaves].map(([lc, ds]) => (
            <g key={lc}>
              <path d={ds.join('')} fill="#000" opacity={0.25} transform={`translate(${n2(0.012 * m)} ${n2(0.018 * m)})`} />
              <path d={ds.join('')} fill={lc} stroke={tone(lc, -0.3)} strokeWidth={n2(0.004 * m)} />
            </g>
          ))}
          {[...lines].map(([lc, ds]) => (
            <path key={lc} d={ds.join('')} fill="none" stroke={lc} strokeWidth={n2(0.012 * m)} strokeLinecap="round" />
          ))}
          {byColor(dotsOf)}
          {!o.tile && border}
        </>
      );
    },
  },
  rockGarden: {
    label: 'Rock garden',
    group: 'beds',
    tile: {
      w: 2,
      h: 2,
      base: '#bcb4a5',
      draw: (m) => {
        const pebbles = tileScatter('rockgravel', 40, 2, 2);
        const rocks = [
          [0.45, 0.4, 0.26, 0.19],
          [1.45, 0.75, 0.2, 0.15],
          [0.9, 1.5, 0.3, 0.22],
          [1.7, 1.7, 0.14, 0.11],
        ] as const;
        const cushions = [
          [1.05, 0.35, '#b56ad6'],
          [0.35, 1.05, '#f2c230'],
          [1.6, 1.25, '#f0f0ea'],
          [0.25, 1.75, '#e98bb5'],
          [1.25, 1.05, '#b56ad6'],
        ] as const;
        return (
          <>
            {dots(m, pebbles.map(([x, y], i): [number, number, number, string] => [x, y, 0.014 + (i % 3) * 0.006, i % 2 ? '#a69d8d' : '#d3cdc0']))}
            {rocks.map(([x, y, rx, ry]) => (
              <g key={x}>
                <ellipse cx={n2((x + 0.03) * m)} cy={n2((y + 0.04) * m)} rx={n2(rx * m)} ry={n2(ry * m)} fill="#000" opacity={0.2} />
                <ellipse cx={n2(x * m)} cy={n2(y * m)} rx={n2(rx * m)} ry={n2(ry * m)} fill="#8f8a80" />
                <ellipse cx={n2((x - rx * 0.2) * m)} cy={n2((y - ry * 0.25) * m)} rx={n2(rx * 0.7 * m)} ry={n2(ry * 0.6 * m)} fill="#a9a398" />
                <ellipse cx={n2((x - rx * 0.35) * m)} cy={n2((y - ry * 0.4) * m)} rx={n2(rx * 0.3 * m)} ry={n2(ry * 0.25 * m)} fill="#c4bfb3" />
              </g>
            ))}
            {cushions.map(([x, y, c]) => (
              <g key={x}>
                <circle cx={n2((x + 0.015) * m)} cy={n2((y + 0.02) * m)} r={n2(0.1 * m)} fill="#000" opacity={0.18} />
                <circle cx={n2(x * m)} cy={n2(y * m)} r={n2(0.1 * m)} fill="#4f7f3c" />
                <circle cx={n2((x - 0.025) * m)} cy={n2((y - 0.025) * m)} r={n2(0.055 * m)} fill="#6a9a4f" />
                {dots(m, [0, 1, 2, 3, 4, 5].map((k): [number, number, number, string] => [x + Math.cos(k * 1.1) * 0.055, y + Math.sin(k * 1.1) * 0.055, 0.014, c]))}
              </g>
            ))}
          </>
        );
      },
    },
  },
  meadow: {
    label: 'Meadow',
    group: 'beds',
    tile: {
      w: 0.9,
      h: 0.9,
      base: '#5b8b3a',
      draw: (m) => (
        <>
          {tileScatter('meadow', 12, 0.9, 0.9).map(([x, y], i) => (
            <path key={i} d={tuft(m, x, y, 0.9 + (i % 3) * 0.15)} fill={['#4a7a2e', '#6c9a45', '#55843a'][i % 3]} />
          ))}
        </>
      ),
    },
  },

  // water
  pond: {
    label: 'Pond',
    group: 'water',
    long: true,
    around: 'meadow',
    thing: ({x, y, w, h}, p, o) => {
      const {cx, cy} = middle({x, y, w, h});
      const rnd = random(o.seed + 'pond');
      const shore = blob(cx, cy, w * 0.47, h * 0.45, rnd, 14, 0.1);
      const water = shore.map(([px, py]): Pt => [cx + (px - cx) * 0.88, cy + (py - cy) * 0.85]);
      const s = Math.min(w, h);
      const pebbles: Dot[] = shore.flatMap(([px, py], i) => {
        const [qx, qy] = water[i];
        return [0.2, 0.5, 0.8].map((t): Dot => [px + (qx - px) * t + (rnd() - 0.5) * s * 0.02, py + (qy - py) * t + (rnd() - 0.5) * s * 0.02, s * (0.018 + rnd() * 0.016)]);
      });
      const pads = Array.from({length: 5}, () => {
        const a = rnd() * 2 * PI;
        return {x: cx + Math.cos(a) * w * 0.28 * (0.6 + rnd() * 0.4), y: cy + Math.sin(a) * h * 0.26 * (0.6 + rnd() * 0.4), r: s * (0.045 + rnd() * 0.03), turn: rnd() * 360};
      });
      const reed = water[Math.floor(rnd() * water.length)];
      return (
        <>
          <defs>
            {deep(p + 'w', WATER)}
            <clipPath id={p + 'c'}>
              <path d={smooth(water)} />
            </clipPath>
          </defs>
          <path d={smooth(shore)} fill="#a39a87" />
          <path d={circles(pebbles)} fill="#c9c2b3" stroke="#8a8272" strokeWidth={n2(s * 0.004)} />
          <path d={smooth(water)} fill="#1b5276" />
          <path d={smooth(water)} fill={`url(#${p}w)`} clipPath={`url(#${p}c)`} transform={`translate(${n2(s * 0.016)} ${n2(s * 0.022)})`} />
          {pads.map((pad, i) => (
            <g key={i} transform={`rotate(${n2(pad.turn)} ${n2(pad.x)} ${n2(pad.y)})`}>
              <path
                d={`M${n2(pad.x)} ${n2(pad.y)}L${n2(pad.x + pad.r)} ${n2(pad.y - pad.r * 0.18)}A${n2(pad.r)} ${n2(pad.r)} 0 1 1 ${n2(pad.x + pad.r)} ${n2(pad.y + pad.r * 0.18)}Z`}
                fill={i % 2 ? '#4f8f3c' : '#5c9c45'}
                stroke="#2f6128"
                strokeWidth={n2(pad.r * 0.06)}
              />
              <path d={`M${n2(pad.x)} ${n2(pad.y)}l${n2(-pad.r * 0.7)} ${n2(-pad.r * 0.4)}M${n2(pad.x)} ${n2(pad.y)}l${n2(-pad.r * 0.7)} ${n2(pad.r * 0.4)}`} stroke="#7fbf5f" strokeOpacity={0.5} strokeWidth={n2(pad.r * 0.05)} />
            </g>
          ))}
          {blossoms(pads.slice(0, 2).map((pad, i) => [pad.x - pad.r * 0.2, pad.y + pad.r * 0.1, pad.r * 0.7, i ? '#f7f1f4' : '#f2a6c4']), 8)}
          <path
            d={`M${n2(cx - w * 0.2)} ${n2(cy - h * 0.18)}q${n2(w * 0.08)} ${n2(-h * 0.04)} ${n2(w * 0.16)} 0M${n2(cx + w * 0.02)} ${n2(cy + h * 0.12)}q${n2(w * 0.06)} ${n2(-h * 0.03)} ${n2(w * 0.12)} 0`}
            stroke="#fff"
            strokeOpacity={0.45}
            strokeWidth={n2(s * 0.012)}
            fill="none"
            strokeLinecap="round"
          />
          <path
            d={Array.from({length: 14}, (_, k) => {
              const a = -PI / 2 + (k / 13 - 0.5) * 1.8;
              const len = s * (0.07 + rnd() * 0.08);
              return `M${n2(reed[0])} ${n2(reed[1])}l${n2(Math.cos(a) * len)} ${n2(Math.sin(a) * len)}`;
            }).join('')}
            stroke="#3d6b2f"
            strokeWidth={n2(s * 0.01)}
            strokeLinecap="round"
          />
          <path d={circles([0, 1, 2].map((k): Dot => [reed[0] + (k - 1) * s * 0.025, reed[1] - s * (0.07 + (k % 2) * 0.03), s * 0.012]))} fill="#6b4a2c" />
        </>
      );
    },
  },
  pool: {
    label: 'Pool',
    group: 'water',
    long: true,
    around: 'paving',
    thing: (b, p) =>
      along(b, (l, d) => {
        const rim = d * 0.09;
        const [wx, wy, ww, wh] = [-l / 2 + rim, -d / 2 + rim, l - 2 * rim, d - 2 * rim];
        const waves = (n: number, vertical: boolean) =>
          Array.from({length: n}, (_, i) => {
            const k = (i + 0.5) / n;
            if (vertical) {
              const x = wx + ww * k;
              return `M${n2(x)} ${n2(wy)}` + Array.from({length: 6}, (_, j) => `q${n2(ww * 0.03 * (j % 2 ? 1 : -1))} ${n2(wh / 12)} 0 ${n2(wh / 6)}`).join('');
            }
            const y = wy + wh * k;
            return `M${n2(wx)} ${n2(y)}` + Array.from({length: 10}, (_, j) => `q${n2(ww / 20)} ${n2(wh * 0.05 * (j % 2 ? 1 : -1))} ${n2(ww / 10)} 0`).join('');
          }).join('');
        const joints = [
          ...Array.from({length: Math.floor(l / (rim * 1.6))}, (_, i) => {
            const x = -l / 2 + (i + 1) * rim * 1.6;
            return `M${n2(x)} ${n2(-d / 2)}v${n2(rim)}M${n2(x)} ${n2(d / 2 - rim)}v${n2(rim)}`;
          }),
          ...Array.from({length: Math.floor(d / (rim * 1.6))}, (_, i) => {
            const y = -d / 2 + (i + 1) * rim * 1.6;
            return `M${n2(-l / 2)} ${n2(y)}h${n2(rim)}M${n2(l / 2 - rim)} ${n2(y)}h${n2(rim)}`;
          }),
        ].join('');
        return (
          <>
            <defs>
              <linearGradient id={p + 'w'} x1={0} y1={0} x2={1} y2={1}>
                <stop offset={0} stopColor="#64cdef" />
                <stop offset={1} stopColor="#1b7dbf" />
              </linearGradient>
              {face(p + 'r', '#ece8df', 0.06, -0.1)}
              <clipPath id={p + 'c'}>
                <rect x={n2(wx)} y={n2(wy)} width={n2(ww)} height={n2(wh)} rx={n2(rim * 0.4)} />
              </clipPath>
            </defs>
            <rect x={n2(-l / 2)} y={n2(-d / 2)} width={n2(l)} height={n2(d)} rx={n2(rim * 0.6)} fill={`url(#${p}r)`} />
            <path d={joints} stroke="#b9b3a6" strokeWidth={n2(rim * 0.06)} />
            <rect x={n2(wx)} y={n2(wy)} width={n2(ww)} height={n2(wh)} rx={n2(rim * 0.4)} fill={`url(#${p}w)`} />
            <g clipPath={`url(#${p}c)`}>
              {[0, 1, 2].map((k) => (
                <rect key={k} x={n2(wx)} y={n2(wy + wh * (0.18 + k * 0.13))} width={n2(ww * (0.09 - k * 0.022))} height={n2(wh * (0.64 - k * 0.26))} rx={n2(rim * 0.3)} fill="#fff" opacity={0.18} />
              ))}
              <path d={waves(5, false) + waves(9, true)} stroke="#fff" strokeOpacity={0.2} strokeWidth={n2(rim * 0.09)} fill="none" />
              <rect x={n2(wx)} y={n2(wy)} width={n2(ww)} height={n2(rim * 0.55)} fill="#05324f" opacity={0.3} />
              <rect x={n2(wx)} y={n2(wy)} width={n2(rim * 0.55)} height={n2(wh)} fill="#05324f" opacity={0.22} />
              <ellipse cx={n2(wx + ww * 0.3)} cy={n2(wy + wh * 0.3)} rx={n2(ww * 0.12)} ry={n2(wh * 0.05)} fill="#fff" opacity={0.25} />
            </g>
            <path
              d={`M${n2(wx + ww * 0.8)} ${n2(d / 2 - rim * 0.3)}v${n2(-rim * 1.6)}M${n2(wx + ww * 0.8 + rim * 0.9)} ${n2(d / 2 - rim * 0.3)}v${n2(-rim * 1.6)}`}
              stroke="#d5dadd"
              strokeWidth={n2(rim * 0.16)}
              strokeLinecap="round"
            />
            <path d={`M${n2(wx + ww * 0.8)} ${n2(wy + wh - rim * 0.5)}h${n2(rim * 0.9)}M${n2(wx + ww * 0.8)} ${n2(wy + wh - rim * 0.95)}h${n2(rim * 0.9)}`} stroke="#fff" strokeOpacity={0.5} strokeWidth={n2(rim * 0.1)} />
            <rect x={n2(l / 2 - rim * 2.6)} y={n2(-d / 2 + rim * 0.2)} width={n2(rim * 1.2)} height={n2(rim * 0.6)} rx={n2(rim * 0.1)} fill="#d6d9dc" stroke="#9aa2a8" strokeWidth={n2(rim * 0.05)} />
          </>
        );
      }),
  },
  roundPool: {
    label: 'Round pool',
    group: 'water',
    round: true,
    size: [2, 7],
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const legs = Array.from({length: 14}, (_, i) => (i / 14) * 2 * PI);
      return (
        <>
          <defs>
            {ball(p + 'f', '#4f7fa8', 0.25, -0.35)}
            {deep(p + 'w', '#2a9ad4')}
            <clipPath id={p + 'c'}>
              <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.84)} />
            </clipPath>
          </defs>
          {halo(p + 'h', cx, cy, r, r)}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.93)} fill={`url(#${p}f)`} />
          {legs.map((a, i) => (
            <rect key={i} x={n2(cx + Math.cos(a) * r * 0.9 - r * 0.03)} y={n2(cy + Math.sin(a) * r * 0.9 - r * 0.03)} width={n2(r * 0.06)} height={n2(r * 0.06)} rx={n2(r * 0.01)} fill="#24425c" />
          ))}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.875)} fill="none" stroke="#dfe7ec" strokeWidth={n2(r * 0.045)} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.84)} fill="#0e3d5e" />
          <circle cx={n2(cx + r * 0.03)} cy={n2(cy + r * 0.045)} r={n2(r * 0.84)} fill={`url(#${p}w)`} clipPath={`url(#${p}c)`} />
          <path d={`M${n2(cx - r * 0.5)} ${n2(cy - r * 0.25)}q${n2(r * 0.18)} ${n2(-r * 0.1)} ${n2(r * 0.36)} 0M${n2(cx - r * 0.1)} ${n2(cy + r * 0.2)}q${n2(r * 0.15)} ${n2(-r * 0.08)} ${n2(r * 0.3)} 0`} stroke="#fff" strokeOpacity={0.4} strokeWidth={n2(r * 0.025)} fill="none" strokeLinecap="round" />
          <g transform={`rotate(35 ${n2(cx)} ${n2(cy)})`}>
            <path d={`M${n2(cx + r * 0.72)} ${n2(cy - r * 0.09)}h${n2(r * 0.3)}M${n2(cx + r * 0.72)} ${n2(cy + r * 0.09)}h${n2(r * 0.3)}`} stroke="#cfd6db" strokeWidth={n2(r * 0.03)} strokeLinecap="round" />
            <path d={`M${n2(cx + r * 0.78)} ${n2(cy - r * 0.09)}v${n2(r * 0.18)}M${n2(cx + r * 0.9)} ${n2(cy - r * 0.09)}v${n2(r * 0.18)}`} stroke="#cfd6db" strokeWidth={n2(r * 0.02)} />
          </g>
        </>
      );
    },
  },
  hotTub: {
    label: 'Hot tub',
    group: 'water',
    size: [1.6, 2.6],
    variants: choices(CABINETS),
    around: 'wood',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'tub');
      const s = r * 0.86;
      const t = s * 0.7;
      const bubbles = scatter(rnd, 26, cx, cy, t * 0.8, [s * 0.008, s * 0.02]);
      const jets: Dot[] = [-1, 1].flatMap((i) => [-0.4, 0.4].map((j): Dot => [cx + i * t * 0.86, cy + j * t, s * 0.025]));
      return (
        <>
          <defs>
            {face(p + 'c', pick(o, CABINETS).c, 0.12, -0.15)}
            {face(p + 's', '#e7e9ea', 0.05, -0.12)}
            <radialGradient id={p + 'w'} cx={0.5} cy={0.5} r={0.6}>
              <stop offset={0} stopColor="#58d1e8" />
              <stop offset={1} stopColor="#1e9cc6" />
            </radialGradient>
          </defs>
          {softBox(cx - s, cy - s, 2 * s, 2 * s, s * 0.22, s * 0.08)}
          <rect x={n2(cx - s)} y={n2(cy - s)} width={n2(2 * s)} height={n2(2 * s)} rx={n2(s * 0.22)} fill={`url(#${p}c)`} />
          <path
            d={Array.from({length: 9}, (_, i) => `M${n2(cx - s + (2 * s * (i + 1)) / 10)} ${n2(cy - s)}v${n2(s * 0.12)}M${n2(cx - s + (2 * s * (i + 1)) / 10)} ${n2(cy + s - s * 0.12)}v${n2(s * 0.12)}`).join('')}
            stroke={tone(pick(o, CABINETS).c, -0.3)}
            strokeWidth={n2(s * 0.012)}
          />
          <rect x={n2(cx - s * 0.88)} y={n2(cy - s * 0.88)} width={n2(s * 1.76)} height={n2(s * 1.76)} rx={n2(s * 0.2)} fill={`url(#${p}s)`} />
          {[-1, 1].map((i) => (
            <rect key={i} x={n2(cx + i * t - (i > 0 ? s * 0.16 : 0) + (i > 0 ? 0 : -s * 0.02))} y={n2(cy - t * 0.7)} width={n2(s * 0.18)} height={n2(t * 1.4)} rx={n2(s * 0.06)} fill="#f6f7f7" />
          ))}
          <rect x={n2(cx - t)} y={n2(cy - t)} width={n2(2 * t)} height={n2(2 * t)} rx={n2(s * 0.14)} fill={`url(#${p}w)`} />
          <rect x={n2(cx - t)} y={n2(cy - t)} width={n2(2 * t)} height={n2(s * 0.08)} rx={n2(s * 0.04)} fill="#05324f" opacity={0.25} />
          <path d={circles(bubbles)} fill="#fff" opacity={0.7} />
          <path d={circles(jets)} fill="#d5f4fb" stroke="#7fbfd0" strokeWidth={n2(s * 0.008)} />
          {[-1, 1].map((i) => (
            <rect key={i} x={n2(cx + i * s * 0.62 - s * 0.12)} y={n2(cy - s * 0.84)} width={n2(s * 0.24)} height={n2(s * 0.1)} rx={n2(s * 0.05)} fill="#2d3236" />
          ))}
        </>
      );
    },
  },
  fountain: {
    label: 'Fountain',
    group: 'water',
    round: true,
    size: [0.8, 3],
    around: 'paving',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const drops = Array.from({length: 12}, (_, i): Dot => [cx + Math.cos((i / 12) * 2 * PI) * r * 0.3, cy + Math.sin((i / 12) * 2 * PI) * r * 0.3, r * 0.012]);
      return (
        <>
          <defs>
            {ball(p + 's', STONE, 0.3, -0.3)}
            {deep(p + 'w', WATER)}
            {ball(p + 'p', '#c9c2b2', 0.3, -0.35)}
          </defs>
          {halo(p + 'h', cx, cy, r, r)}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.93)} fill={`url(#${p}s)`} />
          {rimLight(cx, cy, r * 0.88, r * 0.025)}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.78)} fill={tone(STONE, -0.4)} />
          <circle cx={n2(cx + r * 0.03)} cy={n2(cy + r * 0.04)} r={n2(r * 0.75)} fill={`url(#${p}w)`} />
          {[0.42, 0.55, 0.68].map((k) => (
            <circle key={k} cx={n2(cx)} cy={n2(cy)} r={n2(r * k)} fill="none" stroke="#fff" strokeOpacity={0.3 - k * 0.25} strokeWidth={n2(r * 0.015)} />
          ))}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.24)} fill={`url(#${p}p)`} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.16)} fill="#4f9ccc" />
          <path d={circles(drops)} fill="#fff" opacity={0.8} />
          <polygon
            points={Array.from({length: 16}, (_, i) => {
              const a = (i / 16) * 2 * PI;
              const rr = r * (i % 2 ? 0.04 : 0.11);
              return `${n2(cx + Math.cos(a) * rr)},${n2(cy + Math.sin(a) * rr)}`;
            }).join(' ')}
            fill="#fff"
            opacity={0.85}
          />
        </>
      );
    },
  },
  rainBarrel: {
    label: 'Rain barrel',
    group: 'water',
    round: true,
    size: [0.5, 1.1],
    variants: choices(BARRELS),
    around: 'gravel',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rb = r * 0.78;
      const c = pick(o, BARRELS).c;
      return (
        <>
          <defs>
            {ball(p + 'b', c, 0.25, -0.4)}
            {ball(p + 'l', tone(c, 0.12), 0.2, -0.3)}
            {tube(p + 'd', '#9aa3a8', true)}
          </defs>
          {halo(p + 'h', cx, cy, r, r)}
          <rect x={n2(cx - r * 0.07)} y={n2(cy - r)} width={n2(r * 0.14)} height={n2(r * 0.4)} fill={`url(#${p}d)`} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(rb)} fill={`url(#${p}b)`} />
          {rimLight(cx, cy, rb * 0.96, rb * 0.03)}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(rb * 0.9)} fill="none" stroke={tone(c, 0.3)} strokeOpacity={0.6} strokeWidth={n2(rb * 0.03)} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(rb * 0.82)} fill={`url(#${p}l)`} stroke={tone(c, -0.3)} strokeWidth={n2(rb * 0.03)} />
          <path
            d={Array.from({length: 8}, (_, i) => {
              const a = (i / 8) * 2 * PI;
              return `M${n2(cx + Math.cos(a) * rb * 0.3)} ${n2(cy + Math.sin(a) * rb * 0.3)}L${n2(cx + Math.cos(a) * rb * 0.78)} ${n2(cy + Math.sin(a) * rb * 0.78)}`;
            }).join('')}
            stroke={tone(c, -0.3)}
            strokeOpacity={0.6}
            strokeWidth={n2(rb * 0.025)}
          />
          <rect x={n2(cx - rb * 0.32)} y={n2(cy - rb * 0.07)} width={n2(rb * 0.64)} height={n2(rb * 0.14)} rx={n2(rb * 0.07)} fill={tone(c, -0.3)} />
          <rect x={n2(cx - rb * 0.3)} y={n2(cy - rb * 0.07)} width={n2(rb * 0.6)} height={n2(rb * 0.05)} rx={n2(rb * 0.03)} fill={tone(c, 0.35)} opacity={0.6} />
          <rect x={n2(cx - r * 0.11)} y={n2(cy - rb * 1.02)} width={n2(r * 0.22)} height={n2(r * 0.16)} rx={n2(r * 0.03)} fill="#8a9398" />
        </>
      );
    },
  },
  water: {
    label: 'Water',
    group: 'water',
    tile: {
      w: 1.6,
      h: 1.2,
      base: '#3489c2',
      draw: (m) => (
        <>
          <path
            d={`M${n2(0.15 * m)} ${n2(0.3 * m)}q${n2(0.12 * m)} ${n2(-0.05 * m)} ${n2(0.24 * m)} 0M${n2(0.95 * m)} ${n2(0.75 * m)}q${n2(0.1 * m)} ${n2(-0.04 * m)} ${n2(0.2 * m)} 0M${n2(0.55 * m)} ${n2(1.0 * m)}q${n2(0.08 * m)} ${n2(-0.03 * m)} ${n2(0.16 * m)} 0`}
            stroke="#a9d8f2"
            strokeOpacity={0.6}
            strokeWidth={n2(0.02 * m)}
            fill="none"
            strokeLinecap="round"
          />
          {dots(m, [
            [1.3, 0.2, 0.015, '#d7effa'],
            [0.4, 0.8, 0.012, '#d7effa'],
          ])}
        </>
      ),
    },
  },

  // play
  trampoline: {
    label: 'Trampoline',
    group: 'play',
    round: true,
    size: [2.4, 4.6],
    variants: choices(PADS),
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const springs = Array.from({length: 48}, (_, i) => {
        const a = (i / 48) * 2 * PI;
        return `M${n2(cx + Math.cos(a) * r * 0.64)} ${n2(cy + Math.sin(a) * r * 0.64)}L${n2(cx + Math.cos(a) * r * 0.73)} ${n2(cy + Math.sin(a) * r * 0.73)}`;
      }).join('');
      const seams = Array.from({length: 12}, (_, i) => {
        const a = (i / 12) * 2 * PI;
        return `M${n2(cx + Math.cos(a) * r * 0.74)} ${n2(cy + Math.sin(a) * r * 0.74)}L${n2(cx + Math.cos(a) * r * 0.88)} ${n2(cy + Math.sin(a) * r * 0.88)}`;
      }).join('');
      const poles: Dot[] = Array.from({length: 8}, (_, i) => [cx + Math.cos(((i + 0.5) / 8) * 2 * PI) * r * 0.93, cy + Math.sin(((i + 0.5) / 8) * 2 * PI) * r * 0.93, r * 0.035]);
      return (
        <>
          <defs>
            {ball(p + 'p', pick(o, PADS).c, 0.3, -0.3)}
            <radialGradient id={p + 'm'} cx={0.4} cy={0.36} r={0.7}>
              <stop offset={0} stopColor="#3a3d42" />
              <stop offset={1} stopColor="#141517" />
            </radialGradient>
          </defs>
          {halo(p + 'h', cx, cy, r, r)}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.93)} fill="none" stroke="#2a2d31" strokeOpacity={0.45} strokeWidth={n2(r * 0.014)} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.88)} fill={`url(#${p}p)`} />
          <path d={seams} stroke={tone(pick(o, PADS).c, -0.35)} strokeOpacity={0.6} strokeWidth={n2(r * 0.012)} />
          {rimLight(cx, cy, r * 0.84, r * 0.02, 0.35)}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.73)} fill="#b9c0c6" />
          <path d={springs} stroke="#5b636a" strokeWidth={n2(r * 0.014)} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.64)} fill={`url(#${p}m)`} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.58)} fill="none" stroke="#8a9096" strokeOpacity={0.5} strokeWidth={n2(r * 0.008)} strokeDasharray={`${n2(r * 0.03)} ${n2(r * 0.02)}`} />
          <ellipse cx={n2(cx - r * 0.2)} cy={n2(cy - r * 0.22)} rx={n2(r * 0.25)} ry={n2(r * 0.12)} fill="#fff" opacity={0.06} transform={`rotate(-30 ${n2(cx - r * 0.2)} ${n2(cy - r * 0.22)})`} />
          <path d={circles(poles)} fill="#33373b" />
        </>
      );
    },
  },
  sandbox: {
    label: 'Sandbox',
    group: 'play',
    long: true,
    around: 'meadow',
    thing: (b, p, o) =>
      along(inset(b, 0.06), (l, d) => {
        const rnd = random(o.seed + 'sand');
        const f = d * 0.1;
        const [sx, sy, sw, sh] = [-l / 2 + f, -d / 2 + f, l - 2 * f, d - 2 * f];
        const grains = scatter(rnd, 40, 0, 0, 1, [f * 0.04, f * 0.08]).map(([x, y, r]): Dot => [x * sw * 0.48, y * sh * 0.48, r]);
        const corner = (i: number, j: number) => {
          const [x, y] = [i * (l / 2 - f), j * (d / 2 - f)];
          const k = f * 2.4;
          return poly([[x, y], [x - i * k, y], [x, y - j * k]]);
        };
        const castle = {x: l * 0.12, y: -d * 0.04, s: Math.min(sh * 0.32, sw * 0.18)};
        return (
          <>
            <defs>
              {face(p + 'w', '#a87d4c', 0.14, -0.14)}
              {face(p + 's', '#e6d6a5', 0.06, -0.1)}
            </defs>
            {softBox(-l / 2, -d / 2, l, d, f * 0.3, d * 0.05)}
            <rect x={n2(-l / 2)} y={n2(-d / 2)} width={n2(l)} height={n2(d)} rx={n2(f * 0.3)} fill={`url(#${p}w)`} />
            <path d={`M${n2(-l / 2 + f * 0.5)} ${n2(-d / 2 + f * 0.5)}H${n2(l / 2 - f * 0.5)}V${n2(d / 2 - f * 0.5)}H${n2(-l / 2 + f * 0.5)}Z`} fill="none" stroke="#7a5631" strokeOpacity={0.5} strokeWidth={n2(f * 0.07)} />
            <rect x={n2(sx)} y={n2(sy)} width={n2(sw)} height={n2(sh)} fill={`url(#${p}s)`} />
            <path d={circles(grains.filter((_, i) => i % 2))} fill="#c9b47f" />
            <path d={circles(grains.filter((_, i) => !(i % 2)))} fill="#f4e9c4" />
            <ellipse cx={n2(-l * 0.18)} cy={n2(d * 0.08)} rx={n2(sw * 0.14)} ry={n2(sh * 0.2)} fill="#b89c63" opacity={0.35} />
            <rect x={n2(sx)} y={n2(sy)} width={n2(sw)} height={n2(f * 0.45)} fill="#000" opacity={0.2} />
            <rect x={n2(sx)} y={n2(sy)} width={n2(f * 0.45)} height={n2(sh)} fill="#000" opacity={0.15} />
            {[-1, 1].flatMap((i) =>
              [-1, 1].map((j) => (
                <g key={`${i}${j}`}>
                  <polygon points={corner(i, j)} fill={tone('#a87d4c', 0.12)} stroke="#7a5631" strokeWidth={n2(f * 0.06)} />
                </g>
              )),
            )}
            <rect x={n2(castle.x - castle.s / 2 + castle.s * 0.08)} y={n2(castle.y - castle.s / 2 + castle.s * 0.12)} width={n2(castle.s)} height={n2(castle.s)} fill="#000" opacity={0.18} />
            <rect x={n2(castle.x - castle.s / 2)} y={n2(castle.y - castle.s / 2)} width={n2(castle.s)} height={n2(castle.s)} fill="#d8c48d" stroke="#b39a5c" strokeWidth={n2(castle.s * 0.04)} />
            <path d={circles([-1, 1].flatMap((i) => [-1, 1].map((j): Dot => [castle.x + (i * castle.s) / 2, castle.y + (j * castle.s) / 2, castle.s * 0.2])))} fill="#e3d29f" stroke="#b39a5c" strokeWidth={n2(castle.s * 0.04)} />
            <circle cx={n2(-l * 0.28)} cy={n2(-d * 0.12)} r={n2(sh * 0.12)} fill="#d6332b" />
            <circle cx={n2(-l * 0.28)} cy={n2(-d * 0.12)} r={n2(sh * 0.09)} fill="#9b1f19" />
            <path d={`M${n2(-l * 0.28 - sh * 0.12)} ${n2(-d * 0.12)}a${n2(sh * 0.12)} ${n2(sh * 0.12)} 0 0 1 ${n2(sh * 0.24)} 0`} stroke="#f2c230" strokeWidth={n2(sh * 0.025)} fill="none" />
            <path d={`M${n2(l * 0.3)} ${n2(d * 0.22)}l${n2(sw * 0.1)} ${n2(-sh * 0.06)}`} stroke="#2b6fd0" strokeWidth={n2(sh * 0.035)} strokeLinecap="round" />
            <ellipse cx={n2(l * 0.3 - sw * 0.02)} cy={n2(d * 0.22 + sh * 0.012)} rx={n2(sh * 0.07)} ry={n2(sh * 0.05)} fill="#2b6fd0" />
            <polygon points={Array.from({length: 10}, (_, i) => `${n2(-l * 0.05 + Math.cos((i * PI) / 5) * sh * (i % 2 ? 0.05 : 0.1))},${n2(d * 0.2 + Math.sin((i * PI) / 5) * sh * (i % 2 ? 0.05 : 0.1))}`).join(' ')} fill="#f2c230" stroke="#c49a1a" strokeWidth={n2(sh * 0.01)} />
          </>
        );
      }),
  },
  swing: {
    label: 'Swing',
    group: 'play',
    size: [2, 4.5],
    deep: 2.4,
    variants: choices(SEATS),
    long: true,
    around: 'meadow',
    thing: (b, p, o) =>
      along(inset(b, 0.04), (l, d) => {
        const post = l * 0.035;
        const seats = [
          {x: -l * 0.18, y: d * 0.16, c: pick(o, SEATS).c[0]},
          {x: l * 0.18, y: -d * 0.1, c: pick(o, SEATS).c[1]},
        ];
        return (
          <>
            <defs>
              {tube(p + 'b', WOOD)}
              <radialGradient id={p + 'g'}>
                <stop offset={0} stopColor="#8a6a48" stopOpacity={0.75} />
                <stop offset={1} stopColor="#8a6a48" stopOpacity={0} />
              </radialGradient>
            </defs>
            {seats.map((s) => (
              <ellipse key={s.x} cx={n2(s.x)} cy={n2(0)} rx={n2(l * 0.1)} ry={n2(d * 0.3)} fill={`url(#${p}g)`} data-halo="" />
            ))}
            {[-1, 1].map((i) => (
              <g key={i}>
                <rect x={n2(i * l * 0.44 - post / 2 + post * 0.3)} y={n2(-d * 0.46 + post * 0.4)} width={n2(post)} height={n2(d * 0.92)} fill="#000" opacity={0.2} data-halo="" />
                <rect x={n2(i * l * 0.44 - post / 2)} y={n2(-d * 0.46)} width={n2(post)} height={n2(d * 0.92)} rx={n2(post * 0.3)} fill={`url(#${p}b)`} />
                <rect x={n2(i * l * 0.44 - post * 1.4)} y={n2(-d * 0.015)} width={n2(post * 2.8)} height={n2(d * 0.03)} fill={tone(WOOD, -0.2)} />
              </g>
            ))}
            {seats.map((s) => (
              <g key={s.x}>
                <path d={`M${n2(s.x - l * 0.05)} 0L${n2(s.x - l * 0.05)} ${n2(s.y)}M${n2(s.x + l * 0.05)} 0L${n2(s.x + l * 0.05)} ${n2(s.y)}`} stroke="#5d6267" strokeWidth={n2(l * 0.006)} strokeDasharray={`${n2(l * 0.01)} ${n2(l * 0.006)}`} />
                <rect x={n2(s.x - l * 0.065 + l * 0.01)} y={n2(s.y - d * 0.05 + d * 0.02)} width={n2(l * 0.13)} height={n2(d * 0.1)} rx={n2(d * 0.03)} fill="#000" opacity={0.2} />
                <rect x={n2(s.x - l * 0.065)} y={n2(s.y - d * 0.05)} width={n2(l * 0.13)} height={n2(d * 0.1)} rx={n2(d * 0.03)} fill={s.c} />
                <rect x={n2(s.x - l * 0.055)} y={n2(s.y - d * 0.04)} width={n2(l * 0.11)} height={n2(d * 0.03)} rx={n2(d * 0.015)} fill="#fff" opacity={0.3} />
              </g>
            ))}
            <rect x={n2(-l * 0.47 + d * 0.02)} y={n2(-d * 0.04 + d * 0.03)} width={n2(l * 0.94)} height={n2(d * 0.08)} fill="#000" opacity={0.2} data-halo="" />
            <rect x={n2(-l * 0.47)} y={n2(-d * 0.04)} width={n2(l * 0.94)} height={n2(d * 0.08)} rx={n2(d * 0.02)} fill={`url(#${p}b)`} />
          </>
        );
      }),
  },
  playTower: {
    label: 'Play tower',
    group: 'play',
    size: [2.5, 6],
    deep: 4.5,
    variants: choices(TOWERS),
    long: true,
    around: 'sand',
    thing: (b, p, o) =>
      along(inset(b, 0.04), (l, d) => {
        const s = Math.min(d * 0.78, l * 0.42);
        const tx = -l / 2 + s / 2 + l * 0.05;
        const sw = s * 0.4;
        const end = l / 2 - l * 0.02;
        const tower = pick(o, TOWERS);
        return (
          <>
            <defs>
              <linearGradient id={p + 's'} x1={0} y1={0} x2={0} y2={1}>
                <stop offset={0} stopColor={tone(tower.slide, 0.25)} />
                <stop offset={0.5} stopColor={tower.slide} />
                <stop offset={1} stopColor={tone(tower.slide, -0.25)} />
              </linearGradient>
            </defs>
            {softBox(tx - s / 2, -s / 2, s, s, s * 0.02, s * 0.08)}
            <path d={`M${n2(tx + s * 0.45)} ${n2(-sw / 2)}L${n2(end - sw * 0.3)} ${n2(-sw * 0.6)}Q${n2(end)} ${n2(-sw * 0.6)} ${n2(end)} 0Q${n2(end)} ${n2(sw * 0.6)} ${n2(end - sw * 0.3)} ${n2(sw * 0.6)}L${n2(tx + s * 0.45)} ${n2(sw / 2)}Z`} fill="#000" opacity={0.18} transform={`translate(${n2(s * 0.03)} ${n2(s * 0.05)})`} data-halo="" />
            <path d={`M${n2(tx + s * 0.45)} ${n2(-sw / 2)}L${n2(end - sw * 0.3)} ${n2(-sw * 0.6)}Q${n2(end)} ${n2(-sw * 0.6)} ${n2(end)} 0Q${n2(end)} ${n2(sw * 0.6)} ${n2(end - sw * 0.3)} ${n2(sw * 0.6)}L${n2(tx + s * 0.45)} ${n2(sw / 2)}Z`} fill={`url(#${p}s)`} stroke={tone(tower.slide, -0.35)} strokeWidth={n2(sw * 0.06)} />
            <path d={`M${n2(tx + s * 0.5)} 0L${n2(end - sw * 0.35)} 0`} stroke="#fff" strokeOpacity={0.45} strokeWidth={n2(sw * 0.14)} strokeLinecap="round" />
            <path d={`M${n2(tx - s / 2 - l * 0.045)} ${n2(-s * 0.18)}h${n2(l * 0.045)}M${n2(tx - s / 2 - l * 0.045)} ${n2(s * 0.18)}h${n2(l * 0.045)}`} stroke={tone(WOOD, -0.1)} strokeWidth={n2(s * 0.05)} strokeLinecap="round" />
            <path d={Array.from({length: 4}, (_, i) => `M${n2(tx - s / 2 - l * 0.045 + (i * l * 0.045) / 3)} ${n2(-s * 0.18)}v${n2(s * 0.36)}`).join('')} stroke={WOOD} strokeWidth={n2(s * 0.03)} />
            <g transform={`translate(${n2(tx)} 0)`}>{gableRoof(p, s, s, tower.roof, s * 0.12)}</g>
          </>
        );
      }),
  },
  pingPong: {
    label: 'Table tennis',
    group: 'play',
    size: [2.8, 3.1],
    deep: 1.75,
    variants: choices(TABLES),
    long: true,
    around: 'paving',
    thing: (b, p, o) =>
      along(inset(b, 0.06), (l, d) => {
        const len = Math.min(l * 0.94, d * 0.94 * 1.8);
        const wid = len / 1.8;
        const line = wid * 0.02;
        return (
          <>
            <defs>{face(p + 't', pick(o, TABLES).c, 0.12, -0.15)}</defs>
            {softBox(-len / 2, -wid / 2, len, wid, wid * 0.02, wid * 0.08)}
            <rect x={n2(-len / 2)} y={n2(-wid / 2)} width={n2(len)} height={n2(wid)} rx={n2(wid * 0.015)} fill={`url(#${p}t)`} />
            <rect x={n2(-len / 2 + line / 2)} y={n2(-wid / 2 + line / 2)} width={n2(len - line)} height={n2(wid - line)} fill="none" stroke="#fff" strokeWidth={n2(line)} />
            <path d={`M${n2(-len / 2)} 0H${n2(len / 2)}`} stroke="#fff" strokeOpacity={0.9} strokeWidth={n2(line * 0.5)} />
            <path d={`M${n2(wid * 0.02)} ${n2(-wid / 2 - wid * 0.06)}V${n2(wid / 2 + wid * 0.06)}`} stroke="#000" strokeOpacity={0.3} strokeWidth={n2(wid * 0.03)} />
            <path d={`M0 ${n2(-wid / 2 - wid * 0.06)}V${n2(wid / 2 + wid * 0.06)}`} stroke="#2b2f33" strokeWidth={n2(wid * 0.025)} />
            <path d={`M0 ${n2(-wid / 2 - wid * 0.06)}V${n2(wid / 2 + wid * 0.06)}`} stroke="#f2f2f2" strokeWidth={n2(wid * 0.008)} />
            <rect x={n2(-wid * 0.025)} y={n2(-wid / 2 - wid * 0.09)} width={n2(wid * 0.05)} height={n2(wid * 0.05)} fill="#2b2f33" />
            <rect x={n2(-wid * 0.025)} y={n2(wid / 2 + wid * 0.04)} width={n2(wid * 0.05)} height={n2(wid * 0.05)} fill="#2b2f33" />
            {[
              {x: -len * 0.3, y: wid * 0.2, c: '#d0312d', turn: 30},
              {x: len * 0.32, y: -wid * 0.18, c: '#222', turn: 200},
            ].map((pad) => (
              <g key={pad.x} transform={`rotate(${pad.turn} ${n2(pad.x)} ${n2(pad.y)})`}>
                <rect x={n2(pad.x + wid * 0.07)} y={n2(pad.y - wid * 0.02)} width={n2(wid * 0.1)} height={n2(wid * 0.04)} rx={n2(wid * 0.015)} fill="#b8895a" />
                <circle cx={n2(pad.x + wid * 0.01)} cy={n2(pad.y + wid * 0.015)} r={n2(wid * 0.08)} fill="#000" opacity={0.25} />
                <circle cx={n2(pad.x)} cy={n2(pad.y)} r={n2(wid * 0.08)} fill={pad.c} />
              </g>
            ))}
            <circle cx={n2(len * 0.12 + wid * 0.006)} cy={n2(wid * 0.25 + wid * 0.008)} r={n2(wid * 0.02)} fill="#000" opacity={0.3} />
            <circle cx={n2(len * 0.12)} cy={n2(wid * 0.25)} r={n2(wid * 0.02)} fill="#fff" />
          </>
        );
      }),
  },
  goal: {
    label: 'Goal',
    group: 'play',
    size: [1.5, 5],
    deep: 2,
    long: true,
    around: 'meadow',
    thing: (b, p) =>
      along(inset(b, 0.05), (l, d) => {
        const back = d * 0.6;
        const [fx, bx] = [l * 0.44, l * 0.38];
        const net = poly([[-fx, d * 0.18], [fx, d * 0.18], [bx, d * 0.18 - back], [-bx, d * 0.18 - back]]);
        const mesh: string[] = [];
        for (let k = -l; k < l; k += l * 0.035) mesh.push(`M${n2(k)} ${n2(d * 0.2)}l${n2(back * 1.2)} ${n2(-back * 1.2)}M${n2(k)} ${n2(d * 0.2)}l${n2(-back * 1.2)} ${n2(-back * 1.2)}`);
        return (
          <>
            <defs>
              <clipPath id={p + 'n'}>
                <polygon points={net} />
              </clipPath>
              <radialGradient id={p + 'g'}>
                <stop offset={0} stopColor="#8a6a48" stopOpacity={0.6} />
                <stop offset={1} stopColor="#8a6a48" stopOpacity={0} />
              </radialGradient>
            </defs>
            <ellipse cx={0} cy={n2(d * 0.3)} rx={n2(l * 0.16)} ry={n2(d * 0.16)} fill={`url(#${p}g)`} data-halo="" />
            <polygon points={net} fill="#fff" opacity={0.12} />
            <path d={mesh.join('')} stroke="#fff" strokeOpacity={0.55} strokeWidth={n2(l * 0.003)} clipPath={`url(#${p}n)`} />
            <path d={`M${n2(-fx)} ${n2(d * 0.18)}L${n2(-bx)} ${n2(d * 0.18 - back)}H${n2(bx)}L${n2(fx)} ${n2(d * 0.18)}`} stroke="#e9eef0" strokeWidth={n2(l * 0.008)} fill="none" />
            <path d={`M${n2(-fx)} ${n2(d * 0.18 + l * 0.006)}H${n2(fx)}`} stroke="#000" strokeOpacity={0.25} strokeWidth={n2(l * 0.016)} />
            <path d={`M${n2(-fx)} ${n2(d * 0.18)}H${n2(fx)}`} stroke="#fbfbfb" strokeWidth={n2(l * 0.016)} strokeLinecap="round" />
            <path d={circles([-fx, fx].map((x): Dot => [x, d * 0.18, l * 0.014]))} fill="#d9dee1" />
          </>
        );
      }),
  },

  // buildings
  house: {label: 'House', group: 'buildings', around: 'paving', long: true, variants: choices(ROOFS), thing: (b, p, o) => hipRoof(p, b, pick(o, ROOFS).c)},
  shed: {
    label: 'Shed',
    group: 'buildings',
    variants: choices(SHEDS),
    around: 'gravel',
    long: true,
    thing: (b, p, o) =>
      along(inset(b, 0.05), (l, d) => (
        <>
          {softBox(-l / 2, -d / 2, l, d, d * 0.02, d * 0.06)}
          {gableRoof(p, l, d, pick(o, SHEDS).c)}
          <rect x={n2(-l / 2)} y={n2(-d / 2)} width={n2(d * 0.06)} height={n2(d)} fill={tone(WOOD, 0.1)} />
          <rect x={n2(l / 2 - d * 0.06)} y={n2(-d / 2)} width={n2(d * 0.06)} height={n2(d)} fill={tone(WOOD, -0.15)} />
          <rect x={n2(-l * 0.15)} y={n2(-d * 0.36)} width={n2(d * 0.18)} height={n2(d * 0.2)} rx={n2(d * 0.01)} fill="#d6dadd" />
          <rect x={n2(-l * 0.15 + d * 0.02)} y={n2(-d * 0.34)} width={n2(d * 0.14)} height={n2(d * 0.16)} fill="#3d556b" />
          <path d={`M${n2(-l * 0.15 + d * 0.035)} ${n2(-d * 0.2)}l${n2(d * 0.08)} ${n2(-d * 0.11)}`} stroke="#fff" strokeOpacity={0.5} strokeWidth={n2(d * 0.012)} />
        </>
      )),
  },
  greenhouse: {
    label: 'Greenhouse',
    group: 'buildings',
    long: true,
    around: 'gravel',
    thing: (b, p, o) =>
      along(inset(b, 0.05), (l, d) => {
        const rnd = random(o.seed + 'glass');
        const panes = Math.max(3, Math.round(l / (d * 0.32)));
        const plants = [-1, 1].flatMap((row) => Array.from({length: panes * 2}, (_, i): Dot => [-l / 2 + (l * (i + 0.5)) / (panes * 2), row * d * 0.26, d * (0.08 + rnd() * 0.03)]));
        return (
          <>
            {softBox(-l / 2, -d / 2, l, d, d * 0.02, d * 0.05)}
            <rect x={n2(-l / 2)} y={n2(-d / 2)} width={n2(l)} height={n2(d)} fill="#5e4a38" />
            <rect x={n2(-l / 2)} y={n2(-d * 0.08)} width={n2(l)} height={n2(d * 0.16)} fill="#c2baab" />
            <path d={circles(plants.map(([x, y, r]) => [x + r * 0.2, y + r * 0.25, r]))} fill="#1f3f1c" opacity={0.6} />
            <path d={circles(plants)} fill="#3f8a36" />
            <path d={circles(plants.map(([x, y, r]) => [x - r * 0.3, y - r * 0.3, r * 0.55]))} fill="#62a84a" />
            <path d={circles(plants.filter((_, i) => i % 2 === 0).map(([x, y, r]) => [x + r * 0.35, y + r * 0.25, r * 0.22]))} fill="#e2402f" />
            <path d={circles(plants.filter((_, i) => i % 2 === 1).map(([x, y, r]) => [x - r * 0.1, y + r * 0.35, r * 0.18]))} fill="#e2402f" />
            <rect x={n2(-l / 2)} y={n2(-d / 2)} width={n2(l)} height={n2(d / 2)} fill="#eaf6fc" opacity={0.22} />
            <rect x={n2(-l / 2)} y={0} width={n2(l)} height={n2(d / 2)} fill="#9fc3d4" opacity={0.28} />
            {Array.from({length: panes}, (_, i) => {
              const x = -l / 2 + (l * i) / panes;
              return <path key={i} d={`M${n2(x + (l / panes) * 0.15)} ${n2(-d * 0.42)}l${n2((l / panes) * 0.25)} ${n2(d * 0.3)}`} stroke="#fff" strokeOpacity={0.45} strokeWidth={n2(d * 0.02)} />;
            })}
            <rect x={n2(-l / 2 + (l * 1) / panes)} y={n2(-d / 2)} width={n2(l / panes)} height={n2(d / 2)} fill="#fff" opacity={0.25} />
            <path
              d={[...Array.from({length: panes - 1}, (_, i) => `M${n2(-l / 2 + (l * (i + 1)) / panes)} ${n2(-d / 2)}v${n2(d)}`), `M${n2(-l / 2)} ${n2(-d / 4)}h${n2(l)}M${n2(-l / 2)} ${n2(d / 4)}h${n2(l)}`].join('')}
              stroke="#e8edf0"
              strokeWidth={n2(d * 0.014)}
            />
            <rect x={n2(-l / 2)} y={n2(-d * 0.02)} width={n2(l)} height={n2(d * 0.04)} fill="#c9d1d6" />
            <rect x={n2(-l / 2)} y={n2(-d / 2)} width={n2(l)} height={n2(d)} fill="none" stroke="#dfe5e8" strokeWidth={n2(d * 0.03)} />
          </>
        );
      }),
  },
  gazebo: {
    label: 'Gazebo',
    group: 'buildings',
    size: [2.5, 6],
    variants: choices(CANVAS),
    around: 'paving',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const s = r * 0.84;
      const [l, t, rt, bt] = [cx - s, cy - s, cx + s, cy + s];
      const c = pick(o, CANVAS).c;
      const scallops = (x0: number, y0: number, dx: number, dy: number, nx: number, ny: number) =>
        Array.from({length: 8}, (_, i) => {
          const [x, y] = [x0 + (dx * (i + 0.5)) / 8, y0 + (dy * (i + 0.5)) / 8];
          return `M${n2(x - (dx / 16))} ${n2(y - dy / 16)}q${n2(dx / 16 + nx * s * 0.06)} ${n2(dy / 16 + ny * s * 0.06)} ${n2(dx / 8)} ${n2(dy / 8)}`;
        }).join('');
      return (
        <>
          {softBox(l, t, 2 * s, 2 * s, s * 0.04, s * 0.08)}
          <path d={scallops(l, t, 2 * s, 0, 0, -1) + scallops(rt, t, 0, 2 * s, 1, 0) + scallops(rt, bt, -2 * s, 0, 0, 1) + scallops(l, bt, 0, -2 * s, -1, 0)} fill={tone(c, -0.12)} stroke={tone(c, -0.3)} strokeWidth={n2(s * 0.01)} />
          <polygon points={poly([[l, t], [rt, t], [cx, cy]])} fill={tone(c, 0.08)} />
          <polygon points={poly([[rt, t], [rt, bt], [cx, cy]])} fill={tone(c, -0.1)} />
          <polygon points={poly([[rt, bt], [l, bt], [cx, cy]])} fill={tone(c, -0.18)} />
          <polygon points={poly([[l, bt], [l, t], [cx, cy]])} fill={tone(c, 0.02)} />
          <path d={`M${n2(l)} ${n2(t)}L${n2(rt)} ${n2(bt)}M${n2(rt)} ${n2(t)}L${n2(l)} ${n2(bt)}`} stroke={tone(c, -0.35)} strokeWidth={n2(s * 0.02)} />
          <path
            d={[1, 2].map((k) => `M${n2(cx)} ${n2(cy)}L${n2(l + (2 * s * k) / 3)} ${n2(t)}M${n2(cx)} ${n2(cy)}L${n2(rt)} ${n2(t + (2 * s * k) / 3)}M${n2(cx)} ${n2(cy)}L${n2(l + (2 * s * k) / 3)} ${n2(bt)}M${n2(cx)} ${n2(cy)}L${n2(l)} ${n2(t + (2 * s * k) / 3)}`).join('')}
            stroke={tone(c, -0.25)}
            strokeOpacity={0.35}
            strokeWidth={n2(s * 0.008)}
          />
          <rect x={n2(cx - s * 0.16)} y={n2(cy - s * 0.16)} width={n2(s * 0.32)} height={n2(s * 0.32)} fill={tone(c, -0.05)} stroke={tone(c, -0.35)} strokeWidth={n2(s * 0.015)} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(s * 0.06)} fill="#8a6a46" />
        </>
      );
    },
  },
  pergola: {
    label: 'Pergola',
    group: 'buildings',
    variants: choices(VINES),
    long: true,
    around: 'wood',
    thing: (b, p, o) =>
      along(inset(b, 0.04), (l, d) => {
        const rnd = random(o.seed + 'pergola');
        const n = Math.max(4, Math.round(l / (d * 0.16)));
        const vine = Array.from({length: 18}, (): Dot => {
          const along = rnd();
          const x = -l * 0.46 + along * l * 0.92;
          const y = (rnd() < 0.5 ? -1 : 1) * d * 0.38 + (rnd() - 0.5) * d * 0.3;
          return [x, y, d * (0.06 + rnd() * 0.05)];
        });
        const grapes = vine.filter((_, i) => i % 4 === 0);
        return (
          <>
            <defs>
              {tube(p + 'b', WOOD)}
              {tube(p + 'r', tone(WOOD, 0.08), true)}
            </defs>
            {[-1, 1].flatMap((i) =>
              [-1, 1].map((j) => (
                <rect key={`${i}${j}`} x={n2(i * l * 0.44 - d * 0.05)} y={n2(j * d * 0.38 - d * 0.05)} width={n2(d * 0.1)} height={n2(d * 0.1)} fill={tone(WOOD, -0.3)} />
              )),
            )}
            {Array.from({length: n}, (_, i) => {
              const x = -l * 0.47 + (l * 0.94 * (i + 0.5)) / n;
              return (
                <g key={i}>
                  <rect x={n2(x - d * 0.02 + d * 0.015)} y={n2(-d * 0.47 + d * 0.02)} width={n2(d * 0.04)} height={n2(d * 0.94)} fill="#000" opacity={0.18} />
                  <rect x={n2(x - d * 0.02)} y={n2(-d * 0.47)} width={n2(d * 0.04)} height={n2(d * 0.94)} rx={n2(d * 0.008)} fill={`url(#${p}r)`} />
                </g>
              );
            })}
            {[-1, 1].map((j) => (
              <rect key={j} x={n2(-l * 0.49)} y={n2(j * d * 0.38 - d * 0.035)} width={n2(l * 0.98)} height={n2(d * 0.07)} rx={n2(d * 0.01)} fill={`url(#${p}b)`} />
            ))}
            <path d={circles(vine.map(([x, y, r]) => [x + r * 0.2, y + r * 0.25, r]))} fill="#24501f" opacity={0.6} />
            <path d={circles(vine)} fill="#3f7d36" />
            <path d={circles(vine.map(([x, y, r]) => [x - r * 0.3, y - r * 0.3, r * 0.5]))} fill="#5e9c48" />
            <path d={circles(grapes.flatMap(([x, y, r]) => [0, 1, 2, 3].map((k): Dot => [x + (k % 2) * r * 0.4, y + r * 0.6 + Math.floor(k / 2) * r * 0.35, r * 0.2])))} fill={pick(o, VINES).c} />
          </>
        );
      }),
  },
  kennel: {
    label: 'Hutch',
    group: 'buildings',
    size: [0.8, 3],
    deep: 2,
    variants: choices(SMALL_ROOFS),
    long: true,
    around: 'meadow',
    thing: (b, p, o) =>
      along(inset(b, 0.05), (l, d) => {
        const s = Math.min(d * 0.86, l * 0.42);
        const hx = -l / 2 + s / 2;
        const [rx, rw] = [hx + s / 2, l / 2 - (hx + s / 2)];
        const rnd = random(o.seed + 'hutch');
        const straw = Array.from({length: 18}, () => {
          const [x, y] = [rx + rnd() * rw, (rnd() - 0.5) * d * 0.8];
          const a = rnd() * PI;
          return `M${n2(x)} ${n2(y)}l${n2(Math.cos(a) * d * 0.06)} ${n2(Math.sin(a) * d * 0.06)}`;
        }).join('');
        const mesh: string[] = [];
        for (let x = rx; x < rx + rw; x += d * 0.06) mesh.push(`M${n2(x)} ${n2(-d * 0.45)}v${n2(d * 0.9)}`);
        for (let y = -d * 0.45; y < d * 0.45; y += d * 0.06) mesh.push(`M${n2(rx)} ${n2(y)}h${n2(rw)}`);
        return (
          <>
            <rect x={n2(rx)} y={n2(-d * 0.45)} width={n2(rw)} height={n2(d * 0.9)} fill="#c9ad76" />
            <path d={straw} stroke="#e8d39a" strokeWidth={n2(d * 0.012)} strokeLinecap="round" />
            <circle cx={n2(rx + rw * 0.6)} cy={n2(d * 0.2)} r={n2(d * 0.07)} fill="#b9c2c8" stroke="#7f8a91" strokeWidth={n2(d * 0.012)} />
            <circle cx={n2(rx + rw * 0.6)} cy={n2(d * 0.2)} r={n2(d * 0.045)} fill="#c98a3a" />
            <circle cx={n2(rx + rw * 0.3)} cy={n2(-d * 0.22)} r={n2(d * 0.05)} fill="#4f9ccc" stroke="#2f6f9c" strokeWidth={n2(d * 0.012)} />
            <path d={mesh.join('')} stroke="#8d969c" strokeOpacity={0.55} strokeWidth={n2(d * 0.006)} />
            <rect x={n2(rx)} y={n2(-d * 0.45)} width={n2(rw)} height={n2(d * 0.9)} fill="none" stroke={tone(WOOD, -0.15)} strokeWidth={n2(d * 0.035)} />
            <g transform={`translate(${n2(hx)} 0)`}>
              {softBox(-s / 2, -s / 2, s, s, s * 0.02, s * 0.06)}
              {gableRoof(p, s, s, pick(o, SMALL_ROOFS).c, s * 0.13)}
            </g>
          </>
        );
      }),
  },
  car: {
    label: 'Car',
    group: 'buildings',
    size: [4.2, 5.2],
    deep: 2.3,
    variants: choices(CARS),
    long: true,
    around: 'paving',
    thing: (b, p, o) =>
      along(b, (l, d) => {
        const len = Math.min(l * 0.9, d * 0.9 * 2.2);
        const paint = pick(o, CARS, true).c;
        const wid = len / 2.2;
        const [x0, x1] = [-len / 2, len / 2];
        const body = `M${n2(x0 + wid * 0.25)} ${n2(-wid / 2)}H${n2(x1 - wid * 0.32)}Q${n2(x1)} ${n2(-wid / 2)} ${n2(x1)} ${n2(-wid * 0.2)}V${n2(wid * 0.2)}Q${n2(x1)} ${n2(wid / 2)} ${n2(x1 - wid * 0.32)} ${n2(wid / 2)}H${n2(x0 + wid * 0.25)}Q${n2(x0)} ${n2(wid / 2)} ${n2(x0)} ${n2(wid * 0.25)}V${n2(-wid * 0.25)}Q${n2(x0)} ${n2(-wid / 2)} ${n2(x0 + wid * 0.25)} ${n2(-wid / 2)}Z`;
        const glass = (x: number, w: number, k: number) => poly([[x, -wid * 0.36], [x + w, -wid * 0.38 * k], [x + w, wid * 0.38 * k], [x, wid * 0.36]]);
        return (
          <>
            <defs>
              <linearGradient id={p + 'b'} x1={0} y1={0} x2={0} y2={1}>
                <stop offset={0} stopColor={tone(paint, 0.28)} />
                <stop offset={0.45} stopColor={paint} />
                <stop offset={1} stopColor={tone(paint, -0.38)} />
              </linearGradient>
              <linearGradient id={p + 'g'} x1={0} y1={0} x2={1} y2={1}>
                <stop offset={0} stopColor="#3c4b5c" />
                <stop offset={1} stopColor="#151b22" />
              </linearGradient>
            </defs>
            {softBox(x0, -wid / 2, len, wid, wid * 0.3, wid * 0.1)}
            {[-1, 1].flatMap((i) =>
              [-1, 1].map((j) => (
                <rect key={`${i}${j}`} x={n2(i * len * 0.3 - wid * 0.16)} y={n2(j * wid * 0.5 - wid * 0.05 - (j > 0 ? wid * 0.02 : 0))} width={n2(wid * 0.32)} height={n2(wid * 0.12)} rx={n2(wid * 0.04)} fill="#1b1d20" />
              )),
            )}
            <path d={body} fill={`url(#${p}b)`} stroke={tone(paint, -0.55)} strokeWidth={n2(wid * 0.015)} />
            <polygon points={glass(len * 0.08, len * 0.13, 0.82)} fill={`url(#${p}g)`} />
            <polygon points={glass(-len * 0.3, -len * 0.08, 0.85)} fill={`url(#${p}g)`} />
            <rect x={n2(-len * 0.3)} y={n2(-wid * 0.32)} width={n2(len * 0.38)} height={n2(wid * 0.64)} rx={n2(wid * 0.08)} fill={tone(paint, 0.14)} />
            <rect x={n2(-len * 0.26)} y={n2(-wid * 0.28)} width={n2(len * 0.3)} height={n2(wid * 0.12)} rx={n2(wid * 0.05)} fill="#fff" opacity={0.18} />
            <path d={`M${n2(-len * 0.3)} ${n2(-wid * 0.4)}H${n2(len * 0.08)}M${n2(-len * 0.3)} ${n2(wid * 0.4)}H${n2(len * 0.08)}`} stroke="#1c2633" strokeWidth={n2(wid * 0.06)} strokeLinecap="round" />
            <path d={`M${n2(len * 0.12)} ${n2(-wid * 0.25)}l${n2(len * 0.06)} ${n2(wid * 0.18)}`} stroke="#fff" strokeOpacity={0.3} strokeWidth={n2(wid * 0.04)} strokeLinecap="round" />
            <path d={`M${n2(len * 0.24)} ${n2(-wid * 0.42)}Q${n2(len * 0.36)} 0 ${n2(len * 0.24)} ${n2(wid * 0.42)}`} stroke={tone(paint, -0.55)} strokeOpacity={0.5} strokeWidth={n2(wid * 0.012)} fill="none" />
            <path d={`M${n2(-len * 0.06)} ${n2(-wid * 0.5)}v${n2(wid * 0.06)}M${n2(-len * 0.06)} ${n2(wid * 0.5)}v${n2(-wid * 0.06)}`} stroke={tone(paint, -0.55)} strokeWidth={n2(wid * 0.012)} />
            <ellipse cx={n2(len * 0.08)} cy={n2(-wid * 0.54)} rx={n2(wid * 0.07)} ry={n2(wid * 0.04)} fill={tone(paint, -0.15)} />
            <ellipse cx={n2(len * 0.08)} cy={n2(wid * 0.54)} rx={n2(wid * 0.07)} ry={n2(wid * 0.04)} fill={tone(paint, -0.15)} />
            <path d={circles([-1, 1].map((j): Dot => [x1 - wid * 0.07, j * wid * 0.32, wid * 0.06]))} fill="#f6f1d8" />
            <path d={`M${n2(x0 + wid * 0.03)} ${n2(-wid * 0.38)}v${n2(wid * 0.14)}M${n2(x0 + wid * 0.03)} ${n2(wid * 0.38)}v${n2(-wid * 0.14)}`} stroke="#d0312d" strokeWidth={n2(wid * 0.05)} strokeLinecap="round" />
          </>
        );
      }),
  },

  // sitting and fire
  furniture: {
    label: 'Seating',
    group: 'outdoor',
    size: [1.5, 3.5],
    variants: choices(CUSHIONS),
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'seat');
      const tr = r * 0.4;
      return (
        <>
          <defs>
            {ball(p + 't', '#a0774a', 0.18, -0.25)}
            <clipPath id={p + 'c'}>
              <circle cx={n2(cx)} cy={n2(cy)} r={n2(tr)} />
            </clipPath>
          </defs>
          {[45, 135, 225, 315].map((deg) => {
            const a = (deg * PI) / 180;
            return chair(cx + Math.cos(a) * r * 0.66, cy + Math.sin(a) * r * 0.66, r * 0.32, deg + 90, pick(o, CUSHIONS).c);
          })}
          {halo(p + 'h', cx, cy, tr * 1.15, tr * 1.15, 0.3)}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(tr)} fill={`url(#${p}t)`} />
          <path d={Array.from({length: 5}, (_, i) => `M${n2(cx - tr)} ${n2(cy - tr + ((i + 1) * 2 * tr) / 6)}h${n2(2 * tr)}`).join('')} stroke="#6e4f2e" strokeOpacity={0.45} strokeWidth={n2(tr * 0.03)} clipPath={`url(#${p}c)`} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(tr)} fill="none" stroke="#6e4f2e" strokeWidth={n2(tr * 0.05)} />
          {rimLight(cx, cy, tr * 0.92, tr * 0.04, 0.3)}
          {crown(p, cx, cy, tr * 0.32, '#4f8f3c', rnd, 5, 0.42, 6)}
        </>
      );
    },
  },
  table: {
    label: 'Table',
    group: 'outdoor',
    size: [1, 4.5],
    deep: 2.8,
    variants: choices(CUSHIONS),
    long: true,
    around: 'meadow',
    thing: (b, p, o) =>
      along(b, (l, d) => {
        const rnd = random(o.seed + 'table');
        const m = o.m ?? l / 2.2;
        // chairs about half a meter, the table at most 0.95 deep, as many places a side as there's room for
        const c = Math.min(0.5 * m, l * 0.17, d * 0.25);
        const [tl, td] = [l * 0.78, Math.max(Math.min(d - 2 * c * 1.3, 0.95 * m), d * 0.3)];
        const per = Math.max(1, Math.min(6, Math.floor(tl / (0.62 * m))));
        const places = Array.from({length: per}, (_, i) => (i - (per - 1) / 2) * (tl / per)).flatMap((x) => [-1, 1].map((s) => ({x, s})));
        return (
          <>
            {places.map(({x, s}) => chair(x, s * (td / 2 + c * 0.55), c, s < 0 ? 0 : 180, pick(o, CUSHIONS).c))}
            {softBox(-tl / 2, -td / 2, tl, td, td * 0.06, td * 0.07)}
            <rect x={n2(-tl / 2)} y={n2(-td / 2)} width={n2(tl)} height={n2(td)} rx={n2(td * 0.06)} fill="#8f6640" />
            {boards(-tl / 2 + td * 0.04, -td / 2 + td * 0.04, tl - td * 0.08, td * 0.92, 4, '#b5864f', rnd)}
            {places.map(({x, s}) => (
              <g key={`${x}${s}`}>
                <circle cx={n2(x)} cy={n2(s * td * 0.24)} r={n2(Math.min(td * 0.13, 0.12 * m))} fill="#f4f2ed" stroke="#c9c4ba" strokeWidth={n2(td * 0.01)} />
                <circle cx={n2(x)} cy={n2(s * td * 0.24)} r={n2(Math.min(td * 0.08, 0.075 * m))} fill="#fff" />
                <circle cx={n2(x + Math.min(tl * 0.07, 0.16 * m))} cy={n2(s * td * 0.3)} r={n2(Math.min(td * 0.045, 0.04 * m))} fill="#bfe3f2" stroke="#8fb9cc" strokeWidth={n2(td * 0.008)} />
              </g>
            ))}
            <circle cx={0} cy={0} r={n2(td * 0.16)} fill="#f4f2ed" stroke="#c9c4ba" strokeWidth={n2(td * 0.01)} />
            <path d={circles(scatter(rnd, 9, 0, 0, td * 0.1, [td * 0.025, td * 0.045]))} fill="#5fa244" />
            <path d={circles([[td * 0.03, -td * 0.02, td * 0.025], [-td * 0.04, td * 0.03, td * 0.022]])} fill="#d6402f" />
            <circle cx={n2(tl * 0.18)} cy={0} r={n2(td * 0.05)} fill="#2f6b3b" stroke="#1d4426" strokeWidth={n2(td * 0.01)} />
          </>
        );
      }),
  },
  bench: {
    label: 'Bench',
    group: 'outdoor',
    size: [1.2, 2.2],
    deep: 0.9,
    variants: choices(BENCHES),
    long: true,
    around: 'meadow',
    thing: (b, p, o) =>
      along(inset(b, 0.1), (l, d) => {
        const rnd = random(o.seed + 'bench');
        const [bl, bd] = [l * 0.9, Math.min(d * 0.55, l * 0.3)];
        const wood = pick(o, BENCHES).c;
        return (
          <>
            {softBox(-bl / 2, -bd / 2, bl, bd, bd * 0.06, bd * 0.12)}
            {boards(-bl / 2, -bd * 0.18, bl, bd * 0.68, 3, wood, rnd)}
            <rect x={n2(-bl / 2)} y={n2(-bd / 2)} width={n2(bl)} height={n2(bd * 0.24)} rx={n2(bd * 0.04)} fill={tone(wood, -0.3)} />
            <rect x={n2(-bl / 2)} y={n2(-bd / 2)} width={n2(bl)} height={n2(bd * 0.08)} rx={n2(bd * 0.03)} fill={wood} />
            {[-1, 1].map((s) => (
              <rect key={s} x={n2(s * (bl / 2 - bd * 0.06) - bd * 0.06)} y={n2(-bd / 2)} width={n2(bd * 0.12)} height={n2(bd)} rx={n2(bd * 0.05)} fill="#3a3c3f" />
            ))}
          </>
        );
      }),
  },
  lounger: {
    label: 'Sun lounger',
    group: 'outdoor',
    size: [1.8, 2.2],
    deep: 0.9,
    variants: choices(STRIPES),
    long: true,
    around: 'meadow',
    thing: (b, p, o) =>
      along(b, (l, d) => {
        const ll = Math.min(l * 0.95, d * 2.6);
        const ld = ll / 2.6;
        const stripes = Array.from({length: 7}, (_, i) => (
          <rect key={i} x={n2(-ll / 2 + ld * 0.1)} y={n2(-ld / 2 + ld * 0.12 + (ld * 0.76 * i) / 7)} width={n2(ll - ld * 0.2)} height={n2((ld * 0.76) / 14)} fill={pick(o, STRIPES).c} opacity={0.5} />
        ));
        return (
          <>
            <defs>{face(p + 'c', '#efe9dc', 0.06, -0.12)}</defs>
            {softBox(-ll / 2, -ld / 2, ll, ld, ld * 0.12, ld * 0.1)}
            <rect x={n2(-ll / 2)} y={n2(-ld / 2)} width={n2(ll)} height={n2(ld)} rx={n2(ld * 0.12)} fill="#8a6440" />
            <rect x={n2(-ll / 2 + ld * 0.08)} y={n2(-ld / 2 + ld * 0.1)} width={n2(ll - ld * 0.16)} height={n2(ld * 0.8)} rx={n2(ld * 0.12)} fill={`url(#${p}c)`} />
            {stripes}
            <rect x={n2(ll / 2 - ld * 1.05)} y={n2(-ld / 2 + ld * 0.1)} width={n2(ld * 0.97)} height={n2(ld * 0.8)} rx={n2(ld * 0.12)} fill="#fff" opacity={0.18} />
            <path d={`M${n2(ll / 2 - ld * 1.05)} ${n2(-ld / 2 + ld * 0.1)}v${n2(ld * 0.8)}`} stroke="#000" strokeOpacity={0.2} strokeWidth={n2(ld * 0.04)} />
            <rect x={n2(ll / 2 - ld * 0.62)} y={n2(-ld / 2 + ld * 0.2)} width={n2(ld * 0.42)} height={n2(ld * 0.6)} rx={n2(ld * 0.12)} fill="#f7f4ee" stroke="#d9d2c4" strokeWidth={n2(ld * 0.02)} />
            <rect x={n2(-ll / 2 + ld * 0.25)} y={n2(-ld / 2 + ld * 0.15)} width={n2(ld * 0.5)} height={n2(ld * 0.7)} rx={n2(ld * 0.06)} fill="#e46b4d" />
            <rect x={n2(-ll / 2 + ld * 0.25)} y={n2(-ld / 2 + ld * 0.15)} width={n2(ld * 0.5)} height={n2(ld * 0.12)} fill="#fff" opacity={0.35} />
          </>
        );
      }),
  },
  lounge: {
    label: 'Lounge sofa',
    group: 'outdoor',
    size: [2, 5],
    deep: 3.2,
    variants: choices(LOUNGES),
    long: true,
    around: 'wood',
    thing: (b, p, o) =>
      along(inset(b, 0.06), (l, d) => {
        const t = Math.min(l, d) * 0.24;
        const [x0, y0] = [-l / 2, -d / 2];
        const weave: string[] = [];
        for (let k = 0; k < l + d; k += t * 0.22) weave.push(`M${n2(x0 + k)} ${n2(y0)}l${n2(-d)} ${n2(d)}`);
        const cushion = pick(o, LOUNGES).c;
        const pillows = [
          {x: x0 + l * 0.32, y: y0 + t * 0.5, c: '#e0a83a', turn: -8},
          {x: x0 + t * 0.5, y: y0 + d * 0.62, c: '#3f8f8a', turn: 12},
          {x: x0 + t * 0.55, y: y0 + t * 0.55, c: '#d4693f', turn: 40},
        ];
        return (
          <>
            <defs>
              <clipPath id={p + 'f'}>
                <path d={`M${n2(x0)} ${n2(y0)}h${n2(l)}v${n2(t)}h${n2(t - l)}v${n2(d - t)}h${n2(-t)}Z`} />
              </clipPath>
            </defs>
            <path d={`M${n2(x0)} ${n2(y0)}h${n2(l)}v${n2(t)}h${n2(t - l)}v${n2(d - t)}h${n2(-t)}Z`} fill="#000" opacity={0.2} transform={`translate(${n2(t * 0.12)} ${n2(t * 0.18)})`} data-halo="" />
            <path d={`M${n2(x0)} ${n2(y0)}h${n2(l)}v${n2(t)}h${n2(t - l)}v${n2(d - t)}h${n2(-t)}Z`} fill="#6e6a64" />
            <path d={weave.join('')} stroke="#4f4c47" strokeWidth={n2(t * 0.04)} clipPath={`url(#${p}f)`} />
            {[0.28, 0.52, 0.76].map((f) => (
              <rect key={f} x={n2(x0 + l * f - t * 0.42)} y={n2(y0 + t * 0.1)} width={n2(t * 0.84)} height={n2(t * 0.8)} rx={n2(t * 0.14)} fill={cushion} stroke={tone(cushion, -0.25)} strokeWidth={n2(t * 0.03)} />
            ))}
            {[0.42, 0.72].map((f) => (
              <rect key={f} x={n2(x0 + t * 0.1)} y={n2(y0 + d * f - t * 0.42)} width={n2(t * 0.8)} height={n2(t * 0.84)} rx={n2(t * 0.14)} fill={tone(cushion, -0.06)} stroke={tone(cushion, -0.25)} strokeWidth={n2(t * 0.03)} />
            ))}
            {pillows.map((pl) => (
              <rect key={pl.c} x={n2(pl.x - t * 0.24)} y={n2(pl.y - t * 0.2)} width={n2(t * 0.48)} height={n2(t * 0.4)} rx={n2(t * 0.1)} fill={pl.c} stroke={tone(pl.c, -0.3)} strokeWidth={n2(t * 0.02)} transform={`rotate(${pl.turn} ${n2(pl.x)} ${n2(pl.y)})`} />
            ))}
            {softBox(x0 + l * 0.42, y0 + d * 0.48, l * 0.32, d * 0.3, t * 0.08, t * 0.12)}
            <rect x={n2(x0 + l * 0.42)} y={n2(y0 + d * 0.48)} width={n2(l * 0.32)} height={n2(d * 0.3)} rx={n2(t * 0.08)} fill="#a37a4b" />
            <rect x={n2(x0 + l * 0.42 + t * 0.06)} y={n2(y0 + d * 0.48 + t * 0.06)} width={n2(l * 0.32 - t * 0.12)} height={n2(d * 0.3 - t * 0.12)} rx={n2(t * 0.06)} fill="#b8915f" />
            <rect x={n2(x0 + l * 0.5)} y={n2(y0 + d * 0.55)} width={n2(l * 0.12)} height={n2(d * 0.15)} rx={n2(t * 0.04)} fill="#3a3c3f" />
            <circle cx={n2(x0 + l * 0.56)} cy={n2(y0 + d * 0.625)} r={n2(t * 0.1)} fill="#f2e6c4" />
          </>
        );
      }),
  },
  grill: {
    label: 'Barbecue',
    group: 'outdoor',
    size: [0.6, 1.6],
    variants: choices(GRILLS),
    around: 'paving',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'grill');
      const g = r * 0.6;
      const enamel = pick(o, GRILLS).c;
      const bars = Array.from({length: 9}, (_, i) => {
        const y = cy - g * 0.8 + (i + 0.5) * ((g * 1.6) / 9);
        const half = Math.sqrt(Math.max(0, (g * 0.82) ** 2 - (y - cy) ** 2));
        return `M${n2(cx - half)} ${n2(y)}H${n2(cx + half)}`;
      }).join('');
      const sausages = [
        {x: cx - g * 0.32, y: cy - g * 0.28, turn: 8},
        {x: cx - g * 0.3, y: cy + g * 0.02, turn: -6},
        {x: cx + g * 0.05, y: cy + g * 0.38, turn: 14},
      ];
      const coals = scatter(rnd, 14, cx, cy, g * 0.7, [g * 0.03, g * 0.06]);
      return (
        <>
          <defs>
            <radialGradient id={p + 'k'} cx={0.42} cy={0.4} r={0.6} fx={0.3} fy={0.26}>
              <stop offset={0} stopColor={tone(enamel, 0.35)} />
              <stop offset={0.5} stopColor={enamel} />
              <stop offset={1} stopColor={tone(enamel, -0.6)} />
            </radialGradient>
            <radialGradient id={p + 'e'}>
              <stop offset={0} stopColor="#ff9a3c" />
              <stop offset={0.6} stopColor="#c8401e" />
              <stop offset={1} stopColor="#2a1410" />
            </radialGradient>
            {tube(p + 's', '#a8552e')}
          </defs>
          {halo(p + 'h', cx, cy, g * 1.3, g * 1.3)}
          <path d={`M${n2(cx + g * 0.92)} ${n2(cy - g * 0.55)}A${n2(g * 0.62)} ${n2(g * 0.62)} 0 0 1 ${n2(cx + g * 0.92)} ${n2(cy + g * 0.55)}Z`} fill={`url(#${p}k)`} transform={`translate(${n2(g * 0.18)} 0)`} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(g)} fill={tone(enamel, -0.25)} />
          {rimLight(cx, cy, g * 0.97, g * 0.04, 0.35)}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(g * 0.86)} fill={`url(#${p}e)`} />
          <path d={circles(coals)} fill="#ffcf6a" opacity={0.7} />
          <path d={bars} stroke="#b9c0c6" strokeWidth={n2(g * 0.035)} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(g * 0.84)} fill="none" stroke="#b9c0c6" strokeWidth={n2(g * 0.04)} />
          {sausages.map((sg, i) => (
            <g key={i} transform={`rotate(${sg.turn} ${n2(sg.x)} ${n2(sg.y)})`}>
              <rect x={n2(sg.x - g * 0.26 + g * 0.03)} y={n2(sg.y - g * 0.07 + g * 0.04)} width={n2(g * 0.52)} height={n2(g * 0.14)} rx={n2(g * 0.07)} fill="#000" opacity={0.35} />
              <rect x={n2(sg.x - g * 0.26)} y={n2(sg.y - g * 0.07)} width={n2(g * 0.52)} height={n2(g * 0.14)} rx={n2(g * 0.07)} fill={`url(#${p}s)`} />
              <path d={`M${n2(sg.x - g * 0.12)} ${n2(sg.y - g * 0.06)}v${n2(g * 0.12)}M${n2(sg.x + g * 0.04)} ${n2(sg.y - g * 0.06)}v${n2(g * 0.12)}`} stroke="#5a2414" strokeOpacity={0.7} strokeWidth={n2(g * 0.025)} />
            </g>
          ))}
          <g transform={`rotate(-20 ${n2(cx + g * 0.34)} ${n2(cy - g * 0.18)})`}>
            <rect x={n2(cx + g * 0.12)} y={n2(cy - g * 0.27)} width={n2(g * 0.44)} height={n2(g * 0.18)} rx={n2(g * 0.09)} fill="#e8b434" stroke="#b07f16" strokeWidth={n2(g * 0.015)} />
            <path d={Array.from({length: 5}, (_, i) => `M${n2(cx + g * (0.18 + i * 0.08))} ${n2(cy - g * 0.26)}v${n2(g * 0.16)}`).join('')} stroke="#c9921c" strokeWidth={n2(g * 0.012)} />
          </g>
          <path d={circles([[cx + g * 0.3, cy + g * 0.12, g * 0.1], [cx + g * 0.45, cy + g * 0.3, g * 0.09]])} fill="#3f8f3a" stroke="#255c22" strokeWidth={n2(g * 0.015)} />
          <path d={circles([[cx + g * 0.12, cy + g * 0.08, g * 0.08]])} fill="#d6402f" stroke="#8c2219" strokeWidth={n2(g * 0.015)} />
        </>
      );
    },
  },
  hammock: {
    label: 'Hammock',
    group: 'outdoor',
    size: [2.8, 4.5],
    deep: 1.6,
    variants: choices(HAMMOCKS),
    long: true,
    around: 'meadow',
    thing: (b, p, o) =>
      along(inset(b, 0.05), (l, d) => {
        const w = Math.min(d * 0.32, l * 0.15);
        const colors = pick(o, HAMMOCKS).c;
        const ends = l * 0.46;
        const fabric = `M${n2(-l * 0.32)} 0Q0 ${n2(-w * 1.5)} ${n2(l * 0.32)} 0Q0 ${n2(w * 1.5)} ${n2(-l * 0.32)} 0Z`;
        return (
          <>
            <defs>
              <clipPath id={p + 'f'}>
                <path d={fabric} />
              </clipPath>
              {tube(p + 'b', '#7a5530')}
            </defs>
            <path d={`M${n2(-ends)} 0Q0 ${n2(w * 0.4)} ${n2(ends)} 0`} stroke={`url(#${p}b)`} strokeWidth={n2(w * 0.2)} fill="none" strokeLinecap="round" />
            {[-1, 1].map((s) => (
              <path key={s} d={`M${n2(s * ends)} ${n2(-w * 0.5)}v${n2(w)}`} stroke="#5d4026" strokeWidth={n2(w * 0.22)} strokeLinecap="round" />
            ))}
            <path
              d={[-1, 1].map((s) => [-0.6, -0.3, 0, 0.3, 0.6].map((k) => `M${n2(s * ends)} 0L${n2(s * l * 0.32)} ${n2(k * w)}`).join('')).join('')}
              stroke="#d9cdb2"
              strokeWidth={n2(w * 0.04)}
            />
            <path d={fabric} fill="#000" opacity={0.2} transform={`translate(${n2(w * 0.12)} ${n2(w * 0.2)})`} data-halo="" />
            <g clipPath={`url(#${p}f)`}>
              {Array.from({length: 12}, (_, i) => (
                <rect key={i} x={n2(-l * 0.32 + (l * 0.64 * i) / 12)} y={n2(-w)} width={n2((l * 0.64) / 12 + 0.5)} height={n2(2 * w)} fill={colors[i % colors.length]} />
              ))}
              <rect x={n2(-l * 0.32)} y={n2(-w)} width={n2(l * 0.64)} height={n2(w * 0.7)} fill="#fff" opacity={0.15} />
              <rect x={n2(-l * 0.32)} y={n2(w * 0.4)} width={n2(l * 0.64)} height={n2(w * 0.7)} fill="#000" opacity={0.15} />
            </g>
            <ellipse cx={n2(-l * 0.22)} cy={0} rx={n2(w * 0.4)} ry={n2(w * 0.55)} fill="#f2ede2" stroke="#cfc6b3" strokeWidth={n2(w * 0.04)} />
          </>
        );
      }),
  },
  umbrella: {
    label: 'Parasol',
    group: 'outdoor',
    round: true,
    folds: true,
    size: [2.6, 4],
    over: true,
    around: 'meadow',
    variants: choices(FABRICS),
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const n = 8;
      const [c, c2] = pick(o, FABRICS, true).c;
      // folded up: its round stand under the cloth hanging round the pole
      if (o.closed) {
        return (
          <>
            {halo(p + 'h', cx, cy, r * 0.24, r * 0.24, 0.3)}
            <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.2)} fill="#45484c" stroke="#2a2c2f" strokeWidth={n2(r * 0.01)} />
            <circle cx={n2(cx - r * 0.03)} cy={n2(cy - r * 0.03)} r={n2(r * 0.12)} fill="#5d6166" opacity={0.6} />
            {folded(cx, cy, r * 0.14, c, c2)}
          </>
        );
      }
      const pts = Array.from({length: n}, (_, i): Pt => [cx + Math.cos(((i + 0.5) * 2 * PI) / n) * r * 0.9, cy + Math.sin(((i + 0.5) * 2 * PI) / n) * r * 0.9]);
      return (
        <>
          {halo(p + 'h', cx, cy, r, r, 0.3)}
          {pts.map(([x, y], i) => {
            const [nx, ny] = pts[(i + 1) % n];
            const mid = Math.atan2((y + ny) / 2 - cy, (x + nx) / 2 - cx);
            const lit = Math.cos(mid + (3 * PI) / 4) * 0.12;
            const [ex, ey] = [cx + Math.cos(mid) * r * 0.97, cy + Math.sin(mid) * r * 0.97];
            return (
              <g key={i}>
                <path d={`M${n2(x)} ${n2(y)}Q${n2(ex)} ${n2(ey)} ${n2(nx)} ${n2(ny)}`} fill={tone(i % 2 ? c2 : c, lit - 0.18)} stroke={tone(c, -0.35)} strokeWidth={n2(r * 0.008)} />
                <polygon points={poly([[cx, cy], [x, y], [nx, ny]])} fill={tone(i % 2 ? c2 : c, lit)} />
              </g>
            );
          })}
          <path d={pts.map(([x, y]) => `M${n2(cx)} ${n2(cy)}L${n2(x)} ${n2(y)}`).join('')} stroke={tone(c, -0.3)} strokeWidth={n2(r * 0.012)} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.09)} fill={tone(c, -0.1)} stroke={tone(c, -0.35)} strokeWidth={n2(r * 0.01)} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.04)} fill="#7a5c3a" />
        </>
      );
    },
  },
  cantilever: {
    label: 'Cantilever parasol',
    group: 'outdoor',
    variants: choices(CANTILEVERS),
    size: [2.5, 4],
    folds: true,
    over: true,
    turn: true,
    around: 'meadow',
    thing: cantilever(4),
  },
  cantilever8: {
    label: 'Octagonal cantilever parasol',
    group: 'outdoor',
    variants: choices(CANTILEVERS),
    size: [2.5, 4],
    folds: true,
    over: true,
    turn: true,
    around: 'meadow',
    thing: cantilever(8),
  },
  sunSail: {
    label: 'Shade sail',
    group: 'outdoor',
    size: [3.5, 6],
    over: true,
    variants: choices(SAILS),
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const c = pick(o, SAILS).c;
      const corners = [-90, 30, 150].map((deg): Pt => [cx + Math.cos((deg * PI) / 180) * r * 0.86, cy + Math.sin((deg * PI) / 180) * r * 0.86]);
      const edge = (a: Pt, e: Pt) => {
        const [mx, my] = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
        return `Q${n2(mx + (cx - mx) * 0.32)} ${n2(my + (cy - my) * 0.32)} ${n2(e[0])} ${n2(e[1])}`;
      };
      const sail = `M${n2(corners[0][0])} ${n2(corners[0][1])}${edge(corners[0], corners[1])}${edge(corners[1], corners[2])}${edge(corners[2], corners[0])}Z`;
      return (
        <>
          <defs>{face(p + 's', c, 0.12, -0.16)}</defs>
          <path d={sail} fill="#000" opacity={0.12} transform={`translate(${n2(r * 0.08)} ${n2(r * 0.12)})`} data-halo="" />
          <path d={corners.map(([x, y]) => `M${n2(x)} ${n2(y)}L${n2(cx + (x - cx) * 1.13)} ${n2(cy + (y - cy) * 1.13)}`).join('')} stroke="#7c7f82" strokeWidth={n2(r * 0.012)} />
          <path d={circles(corners.map(([x, y]): Dot => [cx + (x - cx) * 1.13, cy + (y - cy) * 1.13, r * 0.035]))} fill="#55595d" />
          <path d={sail} fill={`url(#${p}s)`} stroke={tone(c, -0.3)} strokeWidth={n2(r * 0.015)} />
          <path d={corners.map(([x, y]) => `M${n2(x)} ${n2(y)}L${n2(cx + (x - cx) * 0.2)} ${n2(cy + (y - cy) * 0.2)}`).join('')} stroke="#fff" strokeOpacity={0.35} strokeWidth={n2(r * 0.012)} />
          <path d={circles(corners.map(([x, y]): Dot => [x, y, r * 0.025]))} fill="#c9ced2" stroke="#7c7f82" strokeWidth={n2(r * 0.008)} />
        </>
      );
    },
  },
  firePit: {
    label: 'Fire pit',
    group: 'outdoor',
    round: true,
    size: [0.9, 2.2],
    around: 'gravel',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'fire');
      const stones = Array.from({length: 12}, (_, i) => {
        const a = (i / 12) * 2 * PI;
        return blob(cx + Math.cos(a) * r * 0.74, cy + Math.sin(a) * r * 0.74, r * 0.15, r * 0.12, rnd, 7, 0.15);
      });
      const logs = [20, 80, 140].map((deg, i) => ({deg: deg + rnd() * 20, len: r * (0.62 + (i % 2) * 0.08)}));
      const flame = (x: number, y: number, s: number, c: string) => `M${n2(x)} ${n2(y - s)}Q${n2(x + s * 0.7)} ${n2(y)} ${n2(x)} ${n2(y + s * 0.6)}Q${n2(x - s * 0.7)} ${n2(y)} ${n2(x)} ${n2(y - s)}Z` + c;
      return (
        <>
          <defs>
            {ball(p + 's', '#8f8a82', 0.3, -0.35)}
            <radialGradient id={p + 'a'}>
              <stop offset={0} stopColor="#2a2623" />
              <stop offset={1} stopColor="#4a4540" />
            </radialGradient>
            <radialGradient id={p + 'g'}>
              <stop offset={0} stopColor="#ffd54a" stopOpacity={0.9} />
              <stop offset={0.5} stopColor="#ff7a2a" stopOpacity={0.5} />
              <stop offset={1} stopColor="#ff5a1a" stopOpacity={0} />
            </radialGradient>
            {tube(p + 'l', '#6b4a2c')}
          </defs>
          {halo(p + 'h', cx, cy, r, r)}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.66)} fill={`url(#${p}a)`} />
          {stones.map((s, i) => (
            <path key={i} d={smooth(s)} fill={`url(#${p}s)`} stroke="#5e5a54" strokeWidth={n2(r * 0.008)} />
          ))}
          {logs.map((lg, i) => (
            <g key={i} transform={`rotate(${n2(lg.deg)} ${n2(cx)} ${n2(cy)})`}>
              <rect x={n2(cx - lg.len / 2)} y={n2(cy - r * 0.06)} width={n2(lg.len)} height={n2(r * 0.12)} rx={n2(r * 0.05)} fill={`url(#${p}l)`} />
              <rect x={n2(cx - r * 0.14)} y={n2(cy - r * 0.06)} width={n2(r * 0.28)} height={n2(r * 0.12)} fill="#1c1714" opacity={0.75} />
              <circle cx={n2(cx + lg.len / 2 - r * 0.03)} cy={n2(cy)} r={n2(r * 0.05)} fill="#c9a06b" />
            </g>
          ))}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.42)} fill={`url(#${p}g)`} />
          <path d={flame(cx - r * 0.06, cy, r * 0.16, '') + flame(cx + r * 0.08, cy + r * 0.04, r * 0.13, '')} fill="#ff7a2a" />
          <path d={flame(cx - r * 0.05, cy + r * 0.02, r * 0.1, '') + flame(cx + r * 0.07, cy + r * 0.05, r * 0.08, '')} fill="#ffd54a" />
          <path d={circles(scatter(rnd, 8, cx, cy, r * 0.3, [r * 0.008, r * 0.016]))} fill="#ffb347" />
        </>
      );
    },
  },
  lamp: {
    label: 'Garden lamp',
    group: 'outdoor',
    size: [0.3, 0.7],
    variants: choices(LAMPS),
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const s = r * 0.34;
      const metal = pick(o, LAMPS).c;
      return (
        <>
          <defs>
            <radialGradient id={p + 'g'}>
              <stop offset={0.3} stopColor="#ffe08a" stopOpacity={0.3} />
              <stop offset={1} stopColor="#ffe08a" stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(s * 2.1)} fill={`url(#${p}g)`} data-halo="" />
          {halo(p + 'h', cx, cy, s * 1.45, s * 1.45, 0.32)}
          <rect x={n2(cx - s * 0.92)} y={n2(cy - s * 0.92)} width={n2(s * 1.84)} height={n2(s * 1.84)} rx={n2(s * 0.08)} fill="#ffe6a3" stroke="#d8b25a" strokeWidth={n2(s * 0.04)} />
          <polygon points={poly([[cx - s * 0.8, cy - s * 0.8], [cx + s * 0.8, cy - s * 0.8], [cx, cy]])} fill={tone(metal, 0.14)} />
          <polygon points={poly([[cx + s * 0.8, cy - s * 0.8], [cx + s * 0.8, cy + s * 0.8], [cx, cy]])} fill={tone(metal, -0.25)} />
          <polygon points={poly([[cx + s * 0.8, cy + s * 0.8], [cx - s * 0.8, cy + s * 0.8], [cx, cy]])} fill={tone(metal, -0.38)} />
          <polygon points={poly([[cx - s * 0.8, cy + s * 0.8], [cx - s * 0.8, cy - s * 0.8], [cx, cy]])} fill={metal} />
          <path d={`M${n2(cx - s * 0.8)} ${n2(cy - s * 0.8)}L${n2(cx + s * 0.8)} ${n2(cy + s * 0.8)}M${n2(cx + s * 0.8)} ${n2(cy - s * 0.8)}L${n2(cx - s * 0.8)} ${n2(cy + s * 0.8)}`} stroke={tone(metal, 0.25)} strokeWidth={n2(s * 0.04)} />
          <rect x={n2(cx - s * 0.22)} y={n2(cy - s * 0.22)} width={n2(s * 0.44)} height={n2(s * 0.44)} fill={tone(metal, 0.2)} stroke={tone(metal, -0.5)} strokeWidth={n2(s * 0.03)} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(s * 0.1)} fill="#1c1e21" />
        </>
      );
    },
  },

  // other
  clothesDryer: {
    label: 'Rotary dryer',
    group: 'other',
    round: true,
    size: [2.6, 4],
    over: true,
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'dryer');
      const colors = ['#f4f1ea', '#8cc0e6', '#f2b8c6', '#f2d36b', '#9bcf8a', '#f4f1ea', '#d9824f'];
      const lines = [0.36, 0.56, 0.76, 0.93];
      // laundry on the lines: a side of a square and how far along
      const wash = Array.from({length: 8}, (_, i) => {
        const k = lines[Math.floor(rnd() * 3) + 1];
        const side = Math.floor(rnd() * 4);
        const t = rnd() * 0.6 - 0.3;
        const turn = side * 90;
        return {k, turn, t, w: r * (0.16 + rnd() * 0.12), c: colors[i % colors.length]};
      });
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.3, r * 0.3, 0.3)}
          {lines.map((k) => (
            <rect key={k} x={n2(cx - r * k * 0.71)} y={n2(cy - r * k * 0.71)} width={n2(r * k * 1.42)} height={n2(r * k * 1.42)} fill="none" stroke="#e7ebee" strokeOpacity={0.85} strokeWidth={n2(r * 0.008)} transform={`rotate(45 ${n2(cx)} ${n2(cy)})`} />
          ))}
          {wash.map((wa, i) => (
            <g key={i} transform={`rotate(${wa.turn + 45} ${n2(cx)} ${n2(cy)})`}>
              <rect x={n2(cx + wa.t * r * wa.k - wa.w / 2 + r * 0.025)} y={n2(cy - r * wa.k * 0.71 + r * 0.035)} width={n2(wa.w)} height={n2(r * 0.07)} fill="#000" opacity={0.2} />
              <rect x={n2(cx + wa.t * r * wa.k - wa.w / 2)} y={n2(cy - r * wa.k * 0.71 - r * 0.015)} width={n2(wa.w)} height={n2(r * 0.07)} rx={n2(r * 0.01)} fill={wa.c} stroke={tone(wa.c, -0.25)} strokeWidth={n2(r * 0.006)} />
              <rect x={n2(cx + wa.t * r * wa.k - wa.w / 2)} y={n2(cy - r * wa.k * 0.71 - r * 0.015)} width={n2(wa.w)} height={n2(r * 0.022)} rx={n2(r * 0.008)} fill="#fff" opacity={0.3} />
            </g>
          ))}
          {[45, 135].map((deg) => (
            <rect key={deg} x={n2(cx - r * 0.98)} y={n2(cy - r * 0.018)} width={n2(r * 1.96)} height={n2(r * 0.036)} rx={n2(r * 0.018)} fill="#a9b4bb" transform={`rotate(${deg} ${n2(cx)} ${n2(cy)})`} />
          ))}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.08)} fill="#7f8b93" stroke="#5c666c" strokeWidth={n2(r * 0.01)} />
          <circle cx={n2(cx - r * 0.02)} cy={n2(cy - r * 0.02)} r={n2(r * 0.03)} fill="#fff" opacity={0.5} />
        </>
      );
    },
  },
  compost: {
    label: 'Compost',
    group: 'other',
    size: [0.9, 2.4],
    around: 'soil',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'compost');
      const s = r * 0.8;
      const f = s * 0.1;
      const fresh = scatter(rnd, 40, cx - s / 2, cy, s * 0.4, [f * 0.25, f * 0.5]);
      const ripe = scatter(rnd, 30, cx + s / 2, cy, s * 0.4, [f * 0.15, f * 0.35]);
      return (
        <>
          <defs>{face(p + 'w', WOOD, 0.12, -0.14)}</defs>
          {softBox(cx - s, cy - s * 0.95, 2 * s, s * 1.9, f * 0.2, s * 0.06)}
          <rect x={n2(cx - s)} y={n2(cy - s * 0.95)} width={n2(2 * s)} height={n2(s * 1.9)} fill={`url(#${p}w)`} />
          <path d={Array.from({length: 6}, (_, i) => `M${n2(cx - s)} ${n2(cy - s * 0.95 + (i + 1) * s * 0.27)}h${n2(f)}M${n2(cx + s - f)} ${n2(cy - s * 0.95 + (i + 1) * s * 0.27)}h${n2(f)}`).join('')} stroke="#5d4026" strokeWidth={n2(f * 0.1)} />
          <rect x={n2(cx - s + f)} y={n2(cy - s * 0.95 + f)} width={n2(s - f * 1.5)} height={n2(s * 1.9 - 2 * f)} fill="#4a3a26" />
          <rect x={n2(cx + f * 0.5)} y={n2(cy - s * 0.95 + f)} width={n2(s - f * 1.5)} height={n2(s * 1.9 - 2 * f)} fill="#3a2a1d" />
          <path d={circles(fresh.filter((_, i) => i % 3 === 0))} fill="#6a9a3a" />
          <path d={circles(fresh.filter((_, i) => i % 3 === 1))} fill="#a07a3a" />
          <path d={circles(fresh.filter((_, i) => i % 3 === 2))} fill="#8bbf4a" />
          <path d={circles(fresh.filter((_, i) => i % 7 === 0).map(([x, y, rr]) => [x, y, rr * 0.8]))} fill="#e8892f" />
          <path d={circles(ripe)} fill="#5a4230" />
          <path d={circles(ripe.filter((_, i) => i % 3 === 0).map(([x, y, rr]) => [x - rr * 0.3, y - rr * 0.3, rr * 0.4]))} fill="#7a5c44" />
          <rect x={n2(cx - f * 0.5)} y={n2(cy - s * 0.95)} width={n2(f)} height={n2(s * 1.9)} fill={tone(WOOD, -0.1)} />
          <rect x={n2(cx - s + f)} y={n2(cy - s * 0.95 + f)} width={n2(s * 2 - 2 * f)} height={n2(f * 0.4)} fill="#000" opacity={0.25} />
        </>
      );
    },
  },
  bins: {
    label: 'Bins',
    group: 'other',
    size: [1, 3],
    deep: 1,
    long: true,
    around: 'paving',
    thing: (b) =>
      along(inset(b, 0.06), (l, d) => {
        const n = 4;
        const w = Math.min(l / (n + 0.6), d * 0.78);
        const colors = ['#4d5154', '#2f6fc0', '#7a5132', '#f0c636'];
        return (
          <>
            {colors.map((c, i) => {
              const x = -((n - 1) / 2) * (w * 1.12) + i * w * 1.12;
              return (
                <g key={c}>
                  <rect x={n2(x - w / 2 + w * 0.06)} y={n2(-w / 2 + w * 0.1)} width={n2(w)} height={n2(w * 1.02)} rx={n2(w * 0.1)} fill="#000" opacity={0.22} data-halo="" />
                  <rect x={n2(x - w * 0.42)} y={n2(-w / 2 - w * 0.06)} width={n2(w * 0.14)} height={n2(w * 0.1)} rx={n2(w * 0.03)} fill="#1d1f21" />
                  <rect x={n2(x + w * 0.28)} y={n2(-w / 2 - w * 0.06)} width={n2(w * 0.14)} height={n2(w * 0.1)} rx={n2(w * 0.03)} fill="#1d1f21" />
                  <rect x={n2(x - w / 2)} y={n2(-w / 2)} width={n2(w)} height={n2(w)} rx={n2(w * 0.1)} fill={c} />
                  <rect x={n2(x - w / 2)} y={n2(-w / 2)} width={n2(w)} height={n2(w * 0.16)} rx={n2(w * 0.06)} fill={tone(c, -0.3)} />
                  <rect x={n2(x - w * 0.44)} y={n2(-w / 2 + w * 0.2)} width={n2(w * 0.88)} height={n2(w * 0.7)} rx={n2(w * 0.08)} fill={tone(c, 0.12)} />
                  <rect x={n2(x - w * 0.36)} y={n2(-w / 2 + w * 0.26)} width={n2(w * 0.5)} height={n2(w * 0.1)} rx={n2(w * 0.05)} fill="#fff" opacity={0.18} />
                  <rect x={n2(x - w * 0.25)} y={n2(w / 2 - w * 0.12)} width={n2(w * 0.5)} height={n2(w * 0.08)} rx={n2(w * 0.04)} fill={tone(c, -0.35)} />
                </g>
              );
            })}
          </>
        );
      }),
  },
  woodpile: {
    label: 'Woodpile',
    group: 'other',
    deep: 1.4,
    long: true,
    around: 'gravel',
    thing: (b, p, o) =>
      along(inset(b, 0.05), (l, d) => {
        const rnd = random(o.seed + 'wood');
        const n = Math.max(4, Math.round(l / (d * 0.2)));
        const lw = l / n;
        return (
          <>
            <defs>
              {tube(p + 'b', '#6b4a2e', true)}
              {tube(p + 's', '#c9a06b', true)}
            </defs>
            {softBox(-l / 2, -d * 0.45, l, d * 0.9, lw * 0.4, d * 0.06)}
            {Array.from({length: n}, (_, i) => {
              const x = -l / 2 + i * lw;
              const short = (rnd() - 0.5) * d * 0.1;
              const split = rnd() < 0.3;
              return (
                <g key={i}>
                  <rect x={n2(x + lw * 0.04)} y={n2(-d * 0.45 + Math.max(0, short))} width={n2(lw * 0.92)} height={n2(d * 0.9 - Math.abs(short))} rx={n2(lw * 0.4)} fill={`url(#${p}${split ? 's' : 'b'})`} />
                  <path d={`M${n2(x + lw * 0.35)} ${n2(-d * 0.35)}v${n2(d * 0.25)}M${n2(x + lw * 0.62)} ${n2(-d * 0.05)}v${n2(d * 0.3)}`} stroke={split ? '#9c7447' : '#3f2a18'} strokeOpacity={0.6} strokeWidth={n2(lw * 0.06)} strokeLinecap="round" />
                  <ellipse cx={n2(x + lw / 2)} cy={n2(d * 0.45 - lw * 0.18)} rx={n2(lw * 0.42)} ry={n2(lw * 0.2)} fill="#d8b47e" stroke="#8a6440" strokeWidth={n2(lw * 0.04)} />
                  <ellipse cx={n2(x + lw / 2)} cy={n2(d * 0.45 - lw * 0.18)} rx={n2(lw * 0.2)} ry={n2(lw * 0.09)} fill="none" stroke="#a87d4c" strokeWidth={n2(lw * 0.03)} />
                </g>
              );
            })}
          </>
        );
      }),
  },
  birdhouse: {
    label: 'Bird feeder',
    group: 'other',
    size: [0.5, 1],
    variants: choices(SMALL_ROOFS),
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'bird');
      const seeds = scatter(rnd, 30, cx, cy, r * 0.95, [r * 0.008, r * 0.016], (v) => 0.6 + 0.4 * v);
      const s = r * 0.5;
      const bird = {x: cx + s * 0.8, y: cy + s * 0.6};
      const k = 1.4;
      return (
        <>
          <path d={circles(seeds)} fill="#d8c08c" data-halo="" />
          {halo(p + 'h', cx, cy, s * 1.4, s * 1.4, 0.3)}
          <rect x={n2(cx - s * 0.95)} y={n2(cy - s * 0.95)} width={n2(s * 1.9)} height={n2(s * 1.9)} rx={n2(s * 0.06)} fill="#9c7447" />
          <rect x={n2(cx - s * 0.85)} y={n2(cy - s * 0.85)} width={n2(s * 1.7)} height={n2(s * 1.7)} fill="#d8c08c" />
          <path d={circles(scatter(rnd, 20, cx, cy, s * 0.8, [s * 0.025, s * 0.04]))} fill="#a88a52" />
          <g transform={`translate(${n2(cx)} ${n2(cy)})`}>{gableRoof(p, s * 1.5, s * 1.3, pick(o, SMALL_ROOFS).c, s * 0.18)}</g>
          <g transform={`translate(${n2(bird.x)} ${n2(bird.y)}) scale(${k}) translate(${n2(-bird.x)} ${n2(-bird.y)})`}>
            <ellipse cx={n2(bird.x + s * 0.06)} cy={n2(bird.y + s * 0.08)} rx={n2(s * 0.24)} ry={n2(s * 0.16)} fill="#000" opacity={0.2} />
            <path d={`M${n2(bird.x - s * 0.2)} ${n2(bird.y)}l${n2(-s * 0.2)} ${n2(-s * 0.09)}l0 ${n2(s * 0.18)}Z`} fill="#6b4329" />
            <ellipse cx={n2(bird.x)} cy={n2(bird.y)} rx={n2(s * 0.24)} ry={n2(s * 0.16)} fill="#8a5b3a" />
            <path d={`M${n2(bird.x - s * 0.16)} ${n2(bird.y - s * 0.1)}q${n2(s * 0.14)} ${n2(-s * 0.04)} ${n2(s * 0.24)} ${n2(s * 0.02)}`} stroke="#5b3a24" strokeWidth={n2(s * 0.03)} fill="none" />
            <ellipse cx={n2(bird.x + s * 0.05)} cy={n2(bird.y + s * 0.05)} rx={n2(s * 0.14)} ry={n2(s * 0.09)} fill="#e0763a" />
            <circle cx={n2(bird.x + s * 0.2)} cy={n2(bird.y - s * 0.02)} r={n2(s * 0.1)} fill="#7a4e30" />
            <circle cx={n2(bird.x + s * 0.23)} cy={n2(bird.y - s * 0.05)} r={n2(s * 0.022)} fill="#111" />
            <path d={`M${n2(bird.x + s * 0.29)} ${n2(bird.y - s * 0.04)}l${n2(s * 0.08)} ${n2(s * 0.02)}l${n2(-s * 0.08)} ${n2(s * 0.03)}Z`} fill="#e8b23a" />
          </g>
        </>
      );
    },
  },
  statue: {
    label: 'Statue',
    group: 'other',
    size: [0.5, 1.6],
    variants: choices(STATUES),
    around: 'gravel',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const s = r * 0.62;
      const stone = pick(o, STATUES).c;
      const [fx, fy] = [cx, cy + s * 0.12];
      // an angel from above: the wings spread back from the shoulders, feathers along their edge
      const wing = (side: number) =>
        `M${n2(fx + side * s * 0.18)} ${n2(fy - s * 0.04)}` +
        `C${n2(fx + side * s * 0.5)} ${n2(fy - s * 0.22)} ${n2(fx + side * s * 0.82)} ${n2(fy - s * 0.48)} ${n2(fx + side * s * 0.78)} ${n2(fy - s * 0.82)}` +
        `C${n2(fx + side * s * 0.62)} ${n2(fy - s * 0.7)} ${n2(fx + side * s * 0.58)} ${n2(fy - s * 0.62)} ${n2(fx + side * s * 0.5)} ${n2(fy - s * 0.66)}` +
        `C${n2(fx + side * s * 0.42)} ${n2(fy - s * 0.5)} ${n2(fx + side * s * 0.36)} ${n2(fy - s * 0.46)} ${n2(fx + side * s * 0.28)} ${n2(fy - s * 0.48)}` +
        `C${n2(fx + side * s * 0.24)} ${n2(fy - s * 0.3)} ${n2(fx + side * s * 0.12)} ${n2(fy - s * 0.2)} ${n2(fx + side * s * 0.06)} ${n2(fy - s * 0.14)}Z`;
      const feathers = (side: number) =>
        [0.3, 0.45, 0.6].map((k) => `M${n2(fx + side * s * 0.2)} ${n2(fy - s * 0.08)}Q${n2(fx + side * s * (0.3 + k * 0.5))} ${n2(fy - s * k * 0.6)} ${n2(fx + side * s * (0.25 + k * 0.6))} ${n2(fy - s * (0.2 + k * 0.85))}`).join('');
      return (
        <>
          <defs>
            {face(p + 'p', '#d4cec2', 0.12, -0.15)}
            {ball(p + 'w', stone, 0.28, -0.32)}
            {ball(p + 'b', stone, 0.3, -0.38)}
            {ball(p + 'k', stone, 0.38, -0.35)}
          </defs>
          {softBox(cx - s, cy - s, 2 * s, 2 * s, s * 0.04, s * 0.12)}
          <rect x={n2(cx - s)} y={n2(cy - s)} width={n2(2 * s)} height={n2(2 * s)} rx={n2(s * 0.04)} fill={`url(#${p}p)`} />
          <rect x={n2(cx - s * 0.86)} y={n2(cy - s * 0.86)} width={n2(s * 1.72)} height={n2(s * 1.72)} fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={n2(s * 0.03)} />
          <g opacity={0.22} transform={`translate(${n2(s * 0.07)} ${n2(s * 0.1)})`}>
            <path d={wing(-1) + wing(1)} fill="#000" />
            <ellipse cx={n2(fx)} cy={n2(fy + s * 0.04)} rx={n2(s * 0.3)} ry={n2(s * 0.2)} fill="#000" />
          </g>
          {[-1, 1].map((side) => (
            <g key={side}>
              <path d={wing(side)} fill={`url(#${p}w)`} stroke={tone(stone, -0.32)} strokeWidth={n2(s * 0.015)} />
              <path d={feathers(side)} stroke={tone(stone, -0.28)} strokeOpacity={0.7} strokeWidth={n2(s * 0.012)} fill="none" />
            </g>
          ))}
          <ellipse cx={n2(fx)} cy={n2(fy + s * 0.04)} rx={n2(s * 0.3)} ry={n2(s * 0.19)} fill={`url(#${p}b)`} stroke={tone(stone, -0.32)} strokeWidth={n2(s * 0.015)} />
          <path d={circles([[fx - s * 0.08, fy + s * 0.2, s * 0.06], [fx + s * 0.08, fy + s * 0.2, s * 0.06]])} fill={tone(stone, 0.12)} stroke={tone(stone, -0.3)} strokeWidth={n2(s * 0.01)} />
          <circle cx={n2(fx)} cy={n2(fy + s * 0.05)} r={n2(s * 0.15)} fill={`url(#${p}k)`} stroke={tone(stone, -0.32)} strokeWidth={n2(s * 0.015)} />
          <path d={circles(Array.from({length: 8}, (_, i): Dot => [fx + Math.cos(PI + (i / 7) * PI) * s * 0.12, fy + s * 0.04 + Math.sin(PI + (i / 7) * PI) * s * 0.1, s * 0.025]))} fill={tone(stone, -0.15)} />
        </>
      );
    },
  },
  rocks: {
    label: 'Rocks',
    group: 'other',
    round: true,
    size: [0.5, 2.5],
    many: true,
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(o.seed + 'rocks');
      const rocks = [
        {x: cx - r * 0.22, y: cy - r * 0.12, rx: r * 0.5, ry: r * 0.42},
        {x: cx + r * 0.36, y: cy + r * 0.3, rx: r * 0.36, ry: r * 0.3},
        {x: cx - r * 0.3, y: cy + r * 0.48, rx: r * 0.2, ry: r * 0.16},
      ];
      return (
        <>
          <defs>{ball(p + 's', '#9d978b', 0.3, -0.4)}</defs>
          {halo(p + 'h', cx, cy, r, r * 0.92)}
          {rocks.map((k, i) => {
            const out = blob(k.x, k.y, k.rx, k.ry, rnd, 9, 0.16);
            const facet = blob(k.x - k.rx * 0.18, k.y - k.ry * 0.2, k.rx * 0.55, k.ry * 0.5, rnd, 7, 0.2);
            return (
              <g key={i}>
                <path d={smooth(out)} fill={`url(#${p}s)`} stroke="#6f6a61" strokeWidth={n2(r * 0.01)} />
                <path d={smooth(facet)} fill="#fff" opacity={0.12} />
                <path d={`M${n2(k.x + k.rx * 0.1)} ${n2(k.y - k.ry * 0.3)}l${n2(k.rx * 0.15)} ${n2(k.ry * 0.3)}l${n2(-k.rx * 0.05)} ${n2(k.ry * 0.25)}`} stroke="#5d5850" strokeOpacity={0.6} strokeWidth={n2(r * 0.012)} fill="none" />
                <path d={circles(scatter(rnd, 5, k.x - k.rx * 0.2, k.y - k.ry * 0.45, k.rx * 0.3, [k.rx * 0.06, k.rx * 0.12]))} fill="#6a8a45" opacity={0.85} />
              </g>
            );
          })}
        </>
      );
    },
  },
  gnome: {
    label: 'Garden gnome',
    group: 'other',
    size: [0.3, 0.7],
    many: true,
    variants: choices(HATS),
    around: 'meadow',
    thing: (b, p, o) => {
      const {cx, cy, r} = middle(b);
      const s = r * 0.55;
      const look = pick(o, HATS);
      return (
        <>
          <defs>
            <radialGradient id={p + 'c'} cx={0.5} cy={0.62} r={0.6} fx={0.48} fy={0.72}>
              <stop offset={0} stopColor={tone(look.hat, 0.3)} />
              <stop offset={0.6} stopColor={look.hat} />
              <stop offset={1} stopColor={tone(look.hat, -0.45)} />
            </radialGradient>
            {ball(p + 'b', look.coat, 0.3, -0.35)}
          </defs>
          {halo(p + 'h', cx, cy, s * 1.1, s * 1.1, 0.32)}
          <path d={circles([-1, 1].map((i): Dot => [cx + i * s * 0.28, cy + s * 0.62, s * 0.16]))} fill="#2a2522" />
          <ellipse cx={n2(cx)} cy={n2(cy + s * 0.18)} rx={n2(s * 0.62)} ry={n2(s * 0.48)} fill={`url(#${p}b)`} />
          <path d={circles([[cx - s * 0.2, cy + s * 0.34, s * 0.2], [cx + s * 0.2, cy + s * 0.34, s * 0.2], [cx, cy + s * 0.44, s * 0.22], [cx, cy + s * 0.22, s * 0.24]])} fill="#f4f1ea" stroke="#cfc8bb" strokeWidth={n2(s * 0.02)} />
          <circle cx={n2(cx)} cy={n2(cy - s * 0.08)} r={n2(s * 0.46)} fill={`url(#${p}c)`} />
          <circle cx={n2(cx + s * 0.02)} cy={n2(cy + s * 0.12)} r={n2(s * 0.08)} fill={tone(look.hat, 0.4)} />
          <path d={circles([-1, 1].map((i): Dot => [cx + i * s * 0.6, cy + s * 0.2, s * 0.1]))} fill="#f0c2a0" />
        </>
      );
    },
  },

  // steps and paths
  woodSteps: {
    label: 'Wooden steps',
    group: 'ways',
    variants: choices(STEP_FILLS),
    long: true,
    way: true,
    deep: 2.2,
    around: 'meadow',
    thing: (b, p, o) =>
      along(b, (l, d) => {
        const rnd = random(o.seed + 'steps');
        const m = o.m ?? l / 2.4;
        // up at the left: each step a tread and the beam holding it at its lower end, that beam's shadow on the next one
        const n = Math.max(2, Math.round(l / (0.42 * m)));
        const t = l / n;
        const bw = Math.min(t * 0.34, 0.15 * m);
        const w = d * 0.92;
        const shade = Math.min(t * 0.55, 0.18 * m);
        const beams = Array.from({length: n}, (_, i) => ({x: -l / 2 + (i + 1) * t - bw, c: tone('#7a5a3c', (rnd() - 0.5) * 0.14)}));
        const stakes = beams.flatMap(({x}): Dot[] => [-1, 1].map((s): Dot => [x + bw * 1.05, s * (w / 2 - bw * 0.7), bw * 0.3]));
        return (
          <>
            <defs>
              <linearGradient id={p + 's'} x1={0} y1={0} x2={1} y2={0}>
                <stop offset={0} stopColor="#000" stopOpacity={0.6} />
                <stop offset={0.35} stopColor="#000" stopOpacity={0.3} />
                <stop offset={1} stopColor="#000" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={p + 'w'} x1={0} y1={0} x2={1} y2={0}>
                <stop offset={0} stopColor="#fff" stopOpacity={0.22} />
                <stop offset={0.5} stopColor="#fff" stopOpacity={0} />
                <stop offset={1} stopColor="#000" stopOpacity={0.25} />
              </linearGradient>
            </defs>
            {softBox(-l / 2, -w / 2, l, w, 0, Math.min(d, l) * 0.03)}
            {strewn(pick(o, STEP_FILLS).fill, -l / 2, -w * 0.47, l, w * 0.94, m, rnd)}
            {beams.slice(0, -1).map(({x}, i) => (
              <rect key={i} x={n2(x + bw)} y={n2(-w * 0.47)} width={n2(shade)} height={n2(w * 0.94)} fill={`url(#${p}s)`} />
            ))}
            {beams.map(({x, c}, i) => (
              <g key={i}>
                <rect x={n2(x)} y={n2(-w / 2)} width={n2(bw)} height={n2(w)} rx={n2(bw * 0.1)} fill={c} stroke={tone(c, -0.45)} strokeWidth={n2(bw * 0.05)} />
                <rect x={n2(x)} y={n2(-w / 2)} width={n2(bw)} height={n2(w)} rx={n2(bw * 0.1)} fill={`url(#${p}w)`} />
              </g>
            ))}
            {/* the grain along each beam, a crack from one end, the sawn ends lighter */}
            <path
              d={beams
                .map(({x}) =>
                  [0.3, 0.55, 0.78]
                    .map((k) => `M${n2(x + bw * k)} ${n2(-w / 2 + w * rnd() * 0.15)}v${n2(w * (0.4 + rnd() * 0.4))}`)
                    .join(''),
                )
                .join('')}
              stroke="#4a3522"
              strokeOpacity={0.4}
              strokeWidth={n2(bw * 0.05)}
              strokeLinecap="round"
            />
            <path d={beams.map(({x}) => `M${n2(x + bw * 0.45)} ${n2(w / 2)}v${n2(-w * (0.1 + rnd() * 0.15))}`).join('')} stroke="#2e2116" strokeOpacity={0.6} strokeWidth={n2(bw * 0.07)} strokeLinecap="round" />
            <path d={beams.map(({x}) => `M${n2(x)} ${n2(-w / 2)}h${n2(bw)}M${n2(x)} ${n2(w / 2)}h${n2(bw)}`).join('')} stroke="#c9a273" strokeOpacity={0.55} strokeWidth={n2(bw * 0.16)} />
            {/* the stakes holding them, their tops */}
            <path d={circles(stakes)} fill="#6e5038" stroke="#3c2a1b" strokeWidth={n2(bw * 0.05)} />
            <path d={circles(stakes.map(([x, y, r]): Dot => [x - r * 0.15, y - r * 0.15, r * 0.45]))} fill="#a98457" opacity={0.7} />
          </>
        );
      }),
  },
  woodStairs: {
    label: 'Wooden stairs',
    group: 'ways',
    variants: choices(WOODS),
    long: true,
    way: true,
    deep: 2,
    around: 'gravel',
    thing: (b, p, o) =>
      along(b, (l, d) => {
        const rnd = random(o.seed + 'stairs');
        const m = o.m ?? l / 2.4;
        const wood = pick(o, WOODS).c;
        // up at the left: treads of two boards between the stringers, each lower one in the shadow of the one above, a
        // handrail on posts (both sides when it's wide)
        const n = Math.max(2, Math.round(l / (0.3 * m)));
        const t = l / n;
        const w = d * 0.94;
        const sw = Math.min(Math.max(0.06 * m, w * 0.05), w * 0.12);
        const inner = w - 2 * sw;
        const gap = Math.min(t * 0.08, 0.012 * m);
        const ps = Math.min(sw * 1.25, t * 0.6);
        const rh = ps * 0.62;
        const rails = d >= 0.9 * m ? [-1, 1] : [-1];
        const posts = Math.max(2, Math.round(l / (1.2 * m)) + 1);
        const boardsAt = Array.from({length: n * 2}, (_, k) => {
          const x = -l / 2 + Math.floor(k / 2) * t + gap / 2 + ((k % 2) * (t - gap)) / 2;
          return {x, w: (t - gap) / 2 - (k % 2 ? 0 : gap / 4), c: tone(wood, (rnd() - 0.5) * 0.08)};
        });
        return (
          <>
            <defs>
              <linearGradient id={p + 's'} x1={0} y1={0} x2={1} y2={0}>
                <stop offset={0} stopColor="#000" stopOpacity={0.62} />
                <stop offset={0.3} stopColor="#000" stopOpacity={0.32} />
                <stop offset={1} stopColor="#000" stopOpacity={0} />
              </linearGradient>
              {tube(p + 'r', tone(wood, -0.05))}
            </defs>
            {softBox(-l / 2, -w / 2, l, w, 0, Math.min(d, l) * 0.04)}
            <rect x={n2(-l / 2)} y={n2(-w / 2)} width={n2(l)} height={n2(w)} fill={tone(wood, -0.55)} />
            {boardsAt.map((bd, k) => (
              <rect key={k} x={n2(bd.x)} y={n2(-inner / 2)} width={n2(bd.w)} height={n2(inner)} fill={bd.c} />
            ))}
            <path
              d={boardsAt.map((bd) => `M${n2(bd.x + bd.w * (0.3 + rnd() * 0.4))} ${n2(-inner / 2 + inner * rnd() * 0.2)}v${n2(inner * (0.3 + rnd() * 0.4))}`).join('')}
              stroke={tone(wood, -0.35)}
              strokeOpacity={0.45}
              strokeWidth={n2(t * 0.025)}
              strokeLinecap="round"
            />
            {/* the nosing of each tread lit, the shadow it casts on the next one down */}
            <path d={Array.from({length: n}, (_, i) => `M${n2(-l / 2 + (i + 1) * t - gap / 2 - t * 0.03)} ${n2(-inner / 2)}v${n2(inner)}`).join('')} stroke={tone(wood, 0.35)} strokeOpacity={0.7} strokeWidth={n2(t * 0.05)} />
            {Array.from({length: n - 1}, (_, i) => (
              <rect key={i} x={n2(-l / 2 + (i + 1) * t)} y={n2(-inner / 2)} width={n2(t * 0.55)} height={n2(inner)} fill={`url(#${p}s)`} />
            ))}
            {[-1, 1].map((s) => (
              <g key={s}>
                <rect x={n2(-l / 2)} y={n2(s < 0 ? -w / 2 : w / 2 - sw)} width={n2(l)} height={n2(sw)} fill={tone(wood, -0.2)} />
                <rect x={n2(-l / 2)} y={n2(s < 0 ? -w / 2 : w / 2 - sw)} width={n2(l)} height={n2(sw * 0.25)} fill={tone(wood, 0.2)} opacity={0.6} />
              </g>
            ))}
            {rails.map((s) => {
              const y = s * (w / 2 - sw / 2);
              const xs = Array.from({length: posts}, (_, k) => -l / 2 + ps / 2 + ((l - ps) * k) / (posts - 1));
              return (
                <g key={s}>
                  <rect x={n2(-l / 2 + rh * 0.6)} y={n2(y - rh / 2 + rh * 0.9)} width={n2(l)} height={n2(rh)} rx={n2(rh / 2)} fill="#000" opacity={0.22} data-halo="" />
                  {xs.map((x, k) => (
                    <rect key={k} x={n2(x - ps / 2)} y={n2(y - ps / 2)} width={n2(ps)} height={n2(ps)} rx={n2(ps * 0.1)} fill={tone(wood, -0.3)} stroke={tone(wood, -0.55)} strokeWidth={n2(ps * 0.06)} />
                  ))}
                  <rect x={n2(-l / 2)} y={n2(y - rh / 2)} width={n2(l)} height={n2(rh)} rx={n2(rh / 2)} fill={`url(#${p}r)`} />
                </g>
              );
            })}
          </>
        );
      }),
  },
  stoneSteps: {
    label: 'Stone steps',
    group: 'ways',
    variants: choices(STONE_STEPS),
    long: true,
    way: true,
    deep: 2.6,
    around: 'meadow',
    thing: (b, p, o) =>
      along(b, (l, d) => {
        const rnd = random(o.seed + 'stone');
        const m = o.m ?? l / 2.4;
        const c = pick(o, STONE_STEPS).c;
        // up at the left: a step of blocks about a meter long, the joints of every other step moved on by half, each
        // step's front edge lit and its shadow on the next one down
        const n = Math.max(2, Math.round(l / (0.36 * m)));
        const t = l / n;
        const w = d * 0.94;
        const k = Math.max(1, Math.round(w / m));
        const joint = Math.min(t * 0.06, 0.015 * m);
        const blocks = Array.from({length: n}, (_, i) => {
          const off = k > 1 && i % 2 ? w / k / 2 : 0;
          const cuts = [-w / 2, ...Array.from({length: k + 1}, (_, j) => -w / 2 + off + (j * w) / k).filter((y) => y > -w / 2 + w * 0.05 && y < w / 2 - w * 0.05), w / 2];
          return cuts.slice(0, -1).map((y0, j) => ({x: -l / 2 + i * t, y0, y1: cuts[j + 1], c: tone(c, (rnd() - 0.5) * 0.1)}));
        }).flat();
        const grain = blocks.flatMap((bk) =>
          Array.from({length: Math.min(30, Math.round(((t * (bk.y1 - bk.y0)) / (m * m)) * 90))}, (): Dot => [bk.x + joint + rnd() * (t - 2 * joint), bk.y0 + joint + rnd() * (bk.y1 - bk.y0 - 2 * joint), (0.006 + rnd() * 0.008) * m]),
        );
        return (
          <>
            <defs>
              {face(p + 'f', c, 0.12, -0.1)}
              <linearGradient id={p + 's'} x1={0} y1={0} x2={1} y2={0}>
                <stop offset={0} stopColor="#000" stopOpacity={0.62} />
                <stop offset={0.3} stopColor="#000" stopOpacity={0.3} />
                <stop offset={1} stopColor="#000" stopOpacity={0} />
              </linearGradient>
            </defs>
            {softBox(-l / 2, -w / 2, l, w, joint, Math.min(d, l) * 0.04)}
            <rect x={n2(-l / 2)} y={n2(-w / 2)} width={n2(l)} height={n2(w)} fill={tone(c, -0.45)} />
            {blocks.map((bk, i) => (
              <g key={i}>
                <rect x={n2(bk.x + joint / 2)} y={n2(bk.y0 + joint / 2)} width={n2(t - joint)} height={n2(bk.y1 - bk.y0 - joint)} rx={n2(joint)} fill={bk.c} />
                <rect x={n2(bk.x + joint / 2)} y={n2(bk.y0 + joint / 2)} width={n2(t - joint)} height={n2(bk.y1 - bk.y0 - joint)} rx={n2(joint)} fill={`url(#${p}f)`} opacity={0.6} />
              </g>
            ))}
            <path d={circles(grain.filter((_, i) => i % 2))} fill={tone(c, -0.3)} opacity={0.55} />
            <path d={circles(grain.filter((_, i) => !(i % 2)))} fill={tone(c, 0.3)} opacity={0.55} />
            {/* the lit front edge of each step (down the steps), the shadow below it */}
            <path d={Array.from({length: n}, (_, i) => `M${n2(-l / 2 + (i + 1) * t - joint * 1.6)} ${n2(-w / 2 + joint)}v${n2(w - 2 * joint)}`).join('')} stroke={tone(c, 0.35)} strokeOpacity={0.8} strokeWidth={n2(joint * 1.4)} />
            {Array.from({length: n - 1}, (_, i) => (
              <rect key={i} x={n2(-l / 2 + (i + 1) * t)} y={n2(-w / 2)} width={n2(t * 0.5)} height={n2(w)} fill={`url(#${p}s)`} />
            ))}
          </>
        );
      }),
  },
  steppingStones: {
    label: 'Stepping stones',
    group: 'ways',
    variants: choices(STEPPERS),
    long: true,
    way: true,
    deep: 1.4,
    around: 'meadow',
    thing: (b, p, o) =>
      along(b, (l, d) => {
        const rnd = random(o.seed + 'stepping');
        const m = o.m ?? l / 2.4;
        const kind = pick(o, STEPPERS);
        // a stone a step, about 60 cm apart, the line swaying a little, grass growing over their edges
        const n = Math.max(2, Math.round(l / (0.62 * m)));
        const sp = l / n;
        const s = Math.min(sp * 0.74, d * 0.8, 0.48 * m);
        const sway = Math.max(0, Math.min(d / 2 - s * 0.55, 0.1 * m));
        const phase = rnd() * 2 * PI;
        const stones = Array.from({length: n}, (_, i) => ({
          x: -l / 2 + (i + 0.5) * sp + (rnd() - 0.5) * sp * 0.08,
          y: sway * Math.sin(i * 1.1 + phase),
          a: (rnd() - 0.5) * 50,
          k: 0.88 + rnd() * 0.22,
        }));
        const tufts = stones.flatMap(({x, y, k}) =>
          Array.from({length: 4}, () => {
            const a = rnd() * 2 * PI;
            const r = (s / 2) * k * (kind.shape === 'slab' ? 0.75 : 0.92);
            return tuft(m, (x + Math.cos(a) * r) / m, (y + Math.sin(a) * r * 0.85) / m, 0.5 + rnd() * 0.3);
          }),
        );
        const shapeOf = (st: (typeof stones)[number]): React.ReactNode => {
          const r = (s / 2) * st.k;
          if (kind.shape === 'slice') {
            return (
              <>
                <circle cx={n2(st.x)} cy={n2(st.y)} r={n2(r)} fill="#5a4330" stroke="#3a2a1d" strokeWidth={n2(r * 0.04)} />
                <circle cx={n2(st.x)} cy={n2(st.y)} r={n2(r * 0.86)} fill={`url(#${p}s)`} />
                <path d={[0.25, 0.45, 0.65].map((f) => `M${n2(st.x + r * f * 0.86)} ${n2(st.y)}a${n2(r * f * 0.86)} ${n2(r * f * 0.86)} 0 1 0 ${n2(-2 * r * f * 0.86)} 0a${n2(r * f * 0.86)} ${n2(r * f * 0.86)} 0 1 0 ${n2(2 * r * f * 0.86)} 0`).join('')} fill="none" stroke={tone(kind.c, -0.25)} strokeOpacity={0.6} strokeWidth={n2(r * 0.03)} />
                <path d={`M${n2(st.x)} ${n2(st.y)}l${n2(Math.cos(st.a * 0.12) * r * 0.8)} ${n2(Math.sin(st.a * 0.12) * r * 0.8)}`} stroke={tone(kind.c, -0.55)} strokeWidth={n2(r * 0.05)} strokeLinecap="round" />
              </>
            );
          }
          if (kind.shape === 'slab') {
            return (
              <g transform={`rotate(${n2(st.a * 0.3)} ${n2(st.x)} ${n2(st.y)})`}>
                <rect x={n2(st.x - r * 0.62)} y={n2(st.y - r)} width={n2(r * 1.24)} height={n2(r * 2)} rx={n2(r * 0.08)} fill={`url(#${p}s)`} stroke={tone(kind.c, -0.3)} strokeWidth={n2(r * 0.03)} />
                <rect x={n2(st.x - r * 0.62)} y={n2(st.y - r)} width={n2(r * 1.24)} height={n2(r * 0.08)} rx={n2(r * 0.04)} fill="#fff" opacity={0.3} />
              </g>
            );
          }
          return (
            <>
              <path d={smooth(blob(st.x, st.y, r, r * 0.82, rnd, 10, 0.16))} fill={`url(#${p}s)`} stroke={tone(kind.c, -0.35)} strokeWidth={n2(r * 0.03)} />
              <path d={smooth(blob(st.x - r * 0.18, st.y - r * 0.2, r * 0.5, r * 0.36, rnd, 8, 0.2))} fill="#fff" opacity={0.12} />
            </>
          );
        };
        return (
          <>
            <defs>{kind.shape === 'slab' ? face(p + 's', kind.c, 0.12, -0.12) : ball(p + 's', kind.c, 0.22, -0.28)}</defs>
            {kind.shape === 'slab' ? (
              stones.map(({x, y, k, a}, i) => (
                <rect key={i} x={n2(x - (s / 2) * k * 0.62 + s * 0.05)} y={n2(y - (s / 2) * k + s * 0.07)} width={n2(s * k * 0.62)} height={n2(s * k)} rx={n2(s * 0.06)} fill="#000" opacity={0.2} transform={`rotate(${n2(a * 0.3)} ${n2(x)} ${n2(y)})`} data-halo="" />
              ))
            ) : (
              <path d={circles(stones.map(({x, y, k}): Dot => [x + s * 0.05, y + s * 0.07, (s / 2) * k * 1.02]))} fill="#000" opacity={0.2} data-halo="" />
            )}
            {stones.map((st, i) => (
              <g key={i}>{shapeOf(st)}</g>
            ))}
            <path d={tufts.join('')} fill="#4c8a3a" />
          </>
        );
      }),
  },
  bridge: {
    label: 'Wooden bridge',
    group: 'ways',
    variants: choices(BRIDGES),
    long: true,
    way: true,
    deep: 2.4,
    around: 'water',
    thing: (b, p, o) =>
      along(b, (l, d) => {
        const rnd = random(o.seed + 'bridge');
        const m = o.m ?? l / 3;
        const kind = pick(o, BRIDGES);
        // planks across, lighter on the half rising towards the light, a handrail on posts along both sides
        const L = l * 0.98;
        const W = Math.min(d * 0.84, 1.6 * m);
        const n = Math.min(90, Math.max(6, Math.round(L / (0.14 * m))));
        const pw = L / n;
        const ps = Math.min(Math.max(W * 0.07, 0.07 * m), W * 0.14);
        const rh = ps * 0.7;
        const posts = Math.max(2, Math.round(L / m) + 1);
        const nails = Array.from({length: n}, (_, i): Dot[] => [-1, 1].map((s): Dot => [-L / 2 + (i + 0.5) * pw, s * (W / 2 - ps * 1.4), pw * 0.06])).flat();
        return (
          <>
            <defs>
              <linearGradient id={p + 'a'} x1={0} y1={0} x2={1} y2={0}>
                <stop offset={0} stopColor="#000" stopOpacity={0.14} />
                <stop offset={0.28} stopColor="#fff" stopOpacity={0.18} />
                <stop offset={0.5} stopColor="#fff" stopOpacity={0.04} />
                <stop offset={0.78} stopColor="#000" stopOpacity={0.1} />
                <stop offset={1} stopColor="#000" stopOpacity={0.3} />
              </linearGradient>
              {tube(p + 'r', kind.rail)}
            </defs>
            <rect x={n2(-L / 2 + W * 0.06)} y={n2(-W / 2 + W * 0.12)} width={n2(L)} height={n2(W)} fill="#0b2a3a" opacity={0.3} data-halo="" />
            <rect x={n2(-L / 2)} y={n2(-W / 2)} width={n2(L)} height={n2(W)} fill={tone(kind.deck, -0.5)} />
            {Array.from({length: n}, (_, i) => (
              <rect key={i} x={n2(-L / 2 + i * pw + pw * 0.05)} y={n2(-W / 2)} width={n2(pw * 0.9)} height={n2(W)} fill={tone(kind.deck, (rnd() - 0.5) * 0.14)} />
            ))}
            <path d={Array.from({length: n}, (_, i) => `M${n2(-L / 2 + (i + 0.3 + rnd() * 0.4) * pw)} ${n2(-W / 2 + W * rnd() * 0.3)}v${n2(W * (0.25 + rnd() * 0.3))}`).join('')} stroke={tone(kind.deck, -0.3)} strokeOpacity={0.4} strokeWidth={n2(pw * 0.06)} strokeLinecap="round" />
            <path d={circles(nails)} fill="#3d3b38" opacity={0.6} />
            <rect x={n2(-L / 2)} y={n2(-W / 2)} width={n2(L)} height={n2(W)} fill={`url(#${p}a)`} />
            {[-1, 1].map((s) => {
              const y = s * (W / 2 - ps / 2);
              const xs = Array.from({length: posts}, (_, k) => -L / 2 + ps / 2 + ((L - ps) * k) / (posts - 1));
              return (
                <g key={s}>
                  <rect x={n2(-L / 2 + rh * 0.7)} y={n2(y - rh / 2 + rh)} width={n2(L)} height={n2(rh)} rx={n2(rh / 2)} fill="#000" opacity={0.2} data-halo="" />
                  {xs.map((x, k) => (
                    <rect key={k} x={n2(x - ps / 2)} y={n2(y - ps / 2)} width={n2(ps)} height={n2(ps)} rx={n2(ps * 0.12)} fill={tone(kind.rail, -0.25)} stroke={tone(kind.rail, -0.5)} strokeWidth={n2(ps * 0.06)} />
                  ))}
                  <rect x={n2(-L / 2)} y={n2(y - rh / 2)} width={n2(L)} height={n2(rh)} rx={n2(rh / 2)} fill={`url(#${p}r)`} />
                </g>
              );
            })}
          </>
        );
      }),
  },

  // ground
  paving: {
    label: 'Paving',
    group: 'ground',
    tile: {
      w: 1,
      h: 1,
      base: '#8c919a',
      draw: (m) => (
        <>
          {(
            [
              [0, 0, '#b1b6be'],
              [0.5, 0, '#a7acb5'],
              [0, 0.5, '#aaafb8'],
              [0.5, 0.5, '#b5bac1'],
            ] as const
          ).map(([x, y, c]) => (
            <g key={`${x}${y}`}>
              <rect x={n2((x + 0.006) * m)} y={n2((y + 0.006) * m)} width={n2(0.488 * m)} height={n2(0.488 * m)} rx={n2(0.01 * m)} fill={c} />
              <path d={`M${n2((x + 0.01) * m)} ${n2((y + 0.49) * m)}V${n2((y + 0.01) * m)}H${n2((x + 0.49) * m)}`} stroke="#fff" strokeOpacity={0.3} strokeWidth={n2(0.008 * m)} fill="none" />
              <path d={`M${n2((x + 0.49) * m)} ${n2((y + 0.01) * m)}V${n2((y + 0.49) * m)}H${n2((x + 0.01) * m)}`} stroke="#000" strokeOpacity={0.12} strokeWidth={n2(0.008 * m)} fill="none" />
            </g>
          ))}
        </>
      ),
    },
  },
  brick: {
    label: 'Brick paving',
    group: 'ground',
    tile: {
      w: 0.48,
      h: 0.2,
      base: '#cfc3b4',
      draw: (m) => (
        <>
          {(
            [
              [0.01, 0.01, '#b5533c'],
              [0.25, 0.01, '#a44a35'],
              [-0.11, 0.11, '#9e4733'],
              [0.13, 0.11, '#ba5a41'],
              [0.37, 0.11, '#9e4733'],
            ] as const
          ).map(([x, y, c], i) => (
            <g key={i}>
              <rect x={n2(x * m)} y={n2(y * m)} width={n2(0.22 * m)} height={n2(0.08 * m)} rx={n2(0.008 * m)} fill={c} />
              <rect x={n2(x * m)} y={n2(y * m)} width={n2(0.22 * m)} height={n2(0.012 * m)} fill="#fff" opacity={0.15} />
              <rect x={n2(x * m)} y={n2((y + 0.068) * m)} width={n2(0.22 * m)} height={n2(0.012 * m)} fill="#000" opacity={0.15} />
            </g>
          ))}
        </>
      ),
    },
  },
  concrete: {
    label: 'Concrete',
    group: 'ground',
    tile: {
      w: 1.2,
      h: 1.2,
      base: '#b7b7b1',
      draw: (m) => (
        <>
          {dots(m, [
            ...tileScatter('concrete', 14, 1.2, 1.2).map(([x, y], i): [number, number, number, string] => [x, y, 0.008 + (i % 3) * 0.003, i % 2 ? '#a3a39d' : '#c9c9c4']),
          ])}
          <path d={`M0 ${n2(1.195 * m)}H${n2(1.2 * m)}M${n2(1.195 * m)} 0V${n2(1.2 * m)}`} stroke="#9c9c96" strokeWidth={n2(0.008 * m)} />
        </>
      ),
    },
  },
  wood: {
    label: 'Decking',
    group: 'ground',
    tile: {
      w: 1.2,
      h: 0.6,
      base: '#9c7043',
      draw: (m) => (
        <>
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect y={n2(i * 0.15 * m)} width={n2(1.2 * m)} height={n2(0.14 * m)} fill={['#a87b4b', '#9a6f42', '#a57849', '#946a3f'][i]} />
              <path d={`M${n2((0.1 + i * 0.2) * m)} ${n2((i * 0.15 + 0.05) * m)}h${n2(0.4 * m)}M${n2((0.6 - i * 0.1) * m)} ${n2((i * 0.15 + 0.09) * m)}h${n2(0.35 * m)}`} stroke="#7d5732" strokeOpacity={0.5} strokeWidth={n2(0.006 * m)} />
              <path d={`M${n2(((i % 2) * 0.6 + 0.3) * m)} ${n2(i * 0.15 * m)}v${n2(0.14 * m)}`} stroke="#6e4c2b" strokeWidth={n2(0.008 * m)} />
            </g>
          ))}
          <path d={`M0 ${n2(0.145 * m)}H${n2(1.2 * m)}M0 ${n2(0.295 * m)}H${n2(1.2 * m)}M0 ${n2(0.445 * m)}H${n2(1.2 * m)}M0 ${n2(0.595 * m)}H${n2(1.2 * m)}`} stroke="#5e4024" strokeWidth={n2(0.01 * m)} />
        </>
      ),
    },
  },
  gravel: {
    label: 'Gravel',
    group: 'ground',
    tile: {
      w: 0.6,
      h: 0.6,
      base: '#b8b0a1',
      draw: (m) => {
        const pebbles = tileScatter('gravel', 26, 0.6, 0.6);
        const colors = ['#a59c8c', '#cfc8ba', '#9a9182', '#ddd6c9', '#b3a99a'];
        return dots(m, pebbles.map(([x, y], i): [number, number, number, string] => [x, y, 0.014 + (i % 4) * 0.005, colors[i % colors.length]]));
      },
    },
  },
  sand: {
    label: 'Sand',
    group: 'ground',
    tile: {
      w: 0.6,
      h: 0.6,
      base: '#e3d19c',
      draw: (m) => (
        <>
          {dots(m, tileScatter('sand', 18, 0.6, 0.6).map(([x, y], i): [number, number, number, string] => [x, y, 0.006 + (i % 3) * 0.003, i % 2 ? '#c9b47f' : '#f2e6be']))}
          <path d={`M${n2(0.05 * m)} ${n2(0.2 * m)}q${n2(0.1 * m)} ${n2(-0.03 * m)} ${n2(0.2 * m)} 0M${n2(0.3 * m)} ${n2(0.45 * m)}q${n2(0.1 * m)} ${n2(-0.03 * m)} ${n2(0.2 * m)} 0`} stroke="#cdb983" strokeOpacity={0.6} strokeWidth={n2(0.008 * m)} fill="none" />
        </>
      ),
    },
  },
  mulch: {
    label: 'Bark mulch',
    group: 'ground',
    tile: {
      w: 0.5,
      h: 0.5,
      base: '#6b4a32',
      draw: (m) =>
        tileScatter('mulch', 14, 0.5, 0.5).map(([x, y], i) => (
          <ellipse key={i} cx={n2(x * m)} cy={n2(y * m)} rx={n2(0.055 * m)} ry={n2(0.016 * m)} fill={['#8a6142', '#4f3524', '#7a5438', '#5d3f2a'][i % 4]} transform={`rotate(${(i * 47) % 180} ${n2(x * m)} ${n2(y * m)})`} />
        )),
    },
  },
  soil: {
    label: 'Soil',
    group: 'ground',
    tile: {
      w: 0.5,
      h: 0.5,
      base: '#6d4c36',
      draw: (m) => dots(m, tileScatter('soil', 12, 0.5, 0.5).map(([x, y], i): [number, number, number, string] => [x, y, 0.012 + (i % 3) * 0.006, i % 2 ? '#5a3e2c' : '#7d5a40'])),
    },
  },
  wall: {
    label: 'Wall',
    group: 'ground',
    tile: {
      w: 0.6,
      h: 0.3,
      base: '#bfb6a8',
      draw: (m) => (
        <>
          {(
            [
              [0.01, 0.01, '#a39a8d'],
              [0.31, 0.01, '#958c80'],
              [-0.14, 0.16, '#958c80'],
              [0.16, 0.16, '#a99f92'],
              [0.46, 0.16, '#958c80'],
            ] as const
          ).map(([x, y, c], i) => (
            <g key={i}>
              <rect x={n2(x * m)} y={n2(y * m)} width={n2(0.28 * m)} height={n2(0.13 * m)} rx={n2(0.01 * m)} fill={c} />
              <rect x={n2(x * m)} y={n2(y * m)} width={n2(0.28 * m)} height={n2(0.02 * m)} fill="#fff" opacity={0.18} />
              <rect x={n2(x * m)} y={n2((y + 0.11) * m)} width={n2(0.28 * m)} height={n2(0.02 * m)} fill="#000" opacity={0.15} />
            </g>
          ))}
        </>
      ),
    },
  },
};

export const PICTURE_KEYS = Object.keys(PICTURES);

// from the name, the first that fits, the more particular ones first (a garden house before a house, a wall before a
// house: the keep-out strip along one, firewood before a fire, a whirlpool before a pool)
export const BY_NAME: [string, RegExp][] = [
  ['steppingStones', /trittstein|trittplatte|stepping|holzscheibe/i],
  ['stoneSteps', /(stein|beton|granit|block|natur)\w*(treppe|stufe)|stone ?(steps|stairs)/i],
  ['woodStairs', /holztreppe|treppe aus holz|wooden ?stairs|deck ?stairs/i],
  ['woodSteps', /treppe|stufe|stairs|\bsteps\b/i],
  ['bridge', /brücke|bruecke|bridge/i],
  ['butterflyBush', /schmetterlingsflieder|sommerflieder|buddleja|butterfly ?bush/i],
  ['hydrangea', /hortensie|hydrangea/i],
  ['rhododendron', /rhododendron|azalee|azalea/i],
  ['roseBed', /rosenbeet|rose ?bed/i],
  ['rose', /\brosen?\b|rosenstrauch|rosenbusch|\broses?\b/i],
  ['lavender', /lavendel|lavender/i],
  ['boxwood', /buchs|boxwood/i],
  ['fern', /farn|\bferns?\b/i],
  ['grass', /ziergras|chinaschilf|pampas|lampenputzer|miscanthus|schilf|blauschwingel|federgras/i],
  ['hosta', /funkie|hosta/i],
  ['bamboo', /bambus|bamboo/i],
  ['japaneseMaple', /fächerahorn|faecherahorn|japanese ?maple/i],
  ['perennialBed', /staude|präriebeet|prairie|perennial/i],
  ['springBed', /tulpe|narzisse|frühlingsbeet|zwiebel|krokus|tulip|daffodil|spring ?bed/i],
  ['summerBed', /sommerblume|einjährige|annuals?|summer ?flowers?/i],
  ['groundCover', /bodendecker|efeu|immergrün|ground ?cover|\bivy\b/i],
  ['raisedBed', /hochbeet|raised/i],
  ['herbSpiral', /kräuterspirale|kraeuterspirale|herb ?spiral|spirale/i],
  ['herbGarden', /kräuter|herb/i],
  ['vegetables', /gemüse|vegetable|salat|tomate/i],
  ['flowerMeadow', /blumenwiese|wildblume|wildflower|insekt|bienenweide/i],
  ['rockGarden', /steingarten|steinbeet|rock ?garden/i],
  ['fruitTree', /obst|apfel|birne|kirsch|pflaume|zwetsch|fruit|apple|cherry|pear|plum/i],
  ['conifer', /tanne|fichte|kiefer|nadel|conifer|pine|\bfir\b|spruce|thuja|lebensbaum/i],
  ['palm', /palme|palm/i],
  ['woodpile', /holzstapel|brennholz|feuerholz|kaminholz|holzlager|woodpile|firewood|log ?pile/i],
  ['stump', /stumpf|stubben|\bstump/i],
  ['tree', /baum|bäume|tree|linde|eiche|ahorn|birke|buche|walnuss|kastanie/i],
  ['hedge', /hecke|hedge|wald|forest/i],
  ['floweringBush', /flieder|lilac|blühstrauch|forsythie|forsythia|hibiskus|hibiscus|weigelie|spiere/i],
  ['bush', /busch|büsche|bush|strauch|sträucher|shrub/i],
  ['pot', /kübel|topf|\bpots?\b|planter|amphore/i],
  ['hotTub', /whirlpool|jacuzzi|hot ?tub|badefass|\bspa\b/i],
  ['roundPool', /rundpool|planschbecken|paddling|aufstellpool|frame ?pool/i],
  ['pool', /pool|schwimm|swim/i],
  ['birdhouse', /vogelhaus|futterhaus|nistkasten|bird ?house|bird ?feeder|futterstelle/i],
  ['fountain', /brunnen|fountain|vogeltränke|birdbath/i],
  ['rainBarrel', /regentonne|regenfass|wasserfass|barrel|zisterne/i],
  ['pond', /teich|pond|biotop|tümpel|\bsee\b|lake|bach|wasser|water/i],
  ['trampoline', /trampolin/i],
  ['sandbox', /sandkasten|sandkiste|sandbox|sandpit/i],
  ['playTower', /spielturm|klettergerüst|kletterturm|rutsche|slide|play ?tower|spielhaus|playhouse/i],
  ['swing', /schaukel|swing|kletter|spielplatz|playground/i],
  ['pingPong', /tischtennis|ping ?pong|table tennis/i],
  ['goal', /fußballtor|fussballtor|\btor\b|goal|fußball|fussball|football|soccer/i],
  ['greenhouse', /gewächshaus|greenhouse|frühbeet|treibhaus/i],
  ['pergola', /pergola|rankgerüst|rosenbogen|arbor|trellis/i],
  ['gazebo', /pavillon|gazebo/i],
  ['kennel', /hund|dog|hühner|chicken|kaninchen|hase|rabbit|stall|coop|voliere/i],
  ['car', /carport|\bauto\b|\bcar\b|stellplatz|parkplatz|parking/i],
  ['shed', /gartenhaus|schuppen|shed|hütte|laube|geräte/i],
  ['wall', /mauer|wall|wand|zaun|fence/i],
  ['house', /haus|house|dach|roof|garage|anbau/i],
  ['grill', /grill|bbq|barbecue/i],
  ['firePit', /feuer|fire/i],
  ['sunSail', /sonnensegel|sun ?sail|shade ?sail/i],
  ['cantilever8', /(acht|8)[- ]?eck\w*\s*ampel|ampel\w*\s*(acht|8)[- ]?eck|octagonal ?cantilever/i],
  ['cantilever', /ampelschirm|freiarm|cantilever|seglar/i],
  ['umbrella', /schirm|umbrella|parasol/i],
  ['lamp', /lampe|laterne|leuchte|lantern|\blamp\b|light/i],
  ['hammock', /hängematte|hammock/i],
  ['lounger', /liege|lounger/i],
  ['lounge', /lounge|sofa|couch/i],
  ['furniture', /sitzgruppe|sitzecke|stuhl|stühle|chair|möbel|furniture|seating/i],
  ['table', /tisch|table/i],
  ['bench', /bank|bench/i],
  ['clothesDryer', /wäsche|laundry|clothes/i],
  ['compost', /kompost|compost/i],
  ['bins', /müll|tonne|\bbins?\b|trash|abfall|container/i],
  ['statue', /statue|skulptur|sculpture|figur|denkmal|büste|buddha|engel|angel/i],
  ['gnome', /zwerg|gnome/i],
  ['rocks', /findling|boulder|felsen|\brocks?\b/i],
  ['paving', /terrasse|terrace|pflaster|platte|stein|\bweg\b|path|gehweg/i],
  ['brick', /klinker|ziegel|brick/i],
  ['concrete', /beton|concrete|asphalt/i],
  ['wood', /holz|wood|deck|steg|diele/i],
  ['sand', /sand/i],
  ['gravel', /kies|gravel|schotter|splitt/i],
  ['mulch', /mulch|rinde|bark|hackschnitzel/i],
  ['soil', /erde|soil|dirt|acker/i],
  ['meadow', /wiese|meadow|rasen|lawn|gras/i],
];
