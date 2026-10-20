// The pictures of the garden map style, from above with the light from the top left like the guides. A thing is drawn
// once into the box of its area (svg units, y down) and cut to the area's outline by the map, with a ground around it.
// Its gradients and clips get ids starting with p, every drawing its own, and p varies it a little: two trees on a map
// aren't the same tree. A ground is a texture in meters, it grows and shrinks with the map.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Group = 'plants' | 'water' | 'play' | 'buildings' | 'outdoor' | 'other' | 'ground';
export const GROUPS: {key: Group; label: string}[] = [
  {key: 'plants', label: 'Plants'},
  {key: 'water', label: 'Water'},
  {key: 'play', label: 'Play'},
  {key: 'buildings', label: 'Buildings'},
  {key: 'outdoor', label: 'Sitting and fire'},
  {key: 'other', label: 'Other'},
  {key: 'ground', label: 'Ground'},
];

// a texture: w by h meters on a base color, what's on it drawn with m svg units per meter
interface Tile {
  w: number;
  h: number;
  base: string;
  draw: (m: number) => React.ReactNode;
}
export interface Picture {
  label: string;
  group: Group;
  // a thing: drawn into the box with ids starting with p, with this ground around it. long: drawn along the area's long
  // side into the box that fits in it, else into the biggest circle that fits in it
  thing?: (b: Box, p: string) => React.ReactNode;
  around?: string;
  long?: boolean;
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
function random(seed: string) {
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
function crown(p: string, cx: number, cy: number, r: number, c: string, rnd: () => number, lobes = 8, size = 0.37, leaves = 18) {
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
      <path d={circles(all)} fill={`url(#${p}l)`} />
      <path d={circles(all)} fill="none" stroke={tone(c, -0.4)} strokeOpacity={0.22} strokeWidth={n2(r * 0.012)} />
      <path d={circles(all.map(([x, y, rr]) => [x - rr * 0.22, y - rr * 0.25, rr * 0.58]))} fill={tone(c, 0.16)} opacity={0.42} />
      <path d={circles(dark)} fill={tone(c, -0.32)} opacity={0.5} />
      <path d={circles(lit)} fill={tone(c, 0.26)} opacity={0.5} />
      <path d={circles(specks)} fill={tone(c, -0.5)} opacity={0.45} />
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

const LEAF = '#3f7a34';
const WOOD = '#9c7447';
const STONE = '#b3ad9f';
const WATER = '#2f86bf';

export const PICTURES: Record<string, Picture> = {
  // plants
  tree: {
    label: 'Tree',
    group: 'plants',
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {halo(p + 'h', cx, cy, r, r * 0.96)}
          {crown(p, cx, cy, r * 0.92, LEAF, random(p + 'tree'))}
        </>
      );
    },
  },
  conifer: {
    label: 'Conifer',
    group: 'plants',
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(p + 'conifer');
      const c = '#2d6b47';
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
    group: 'plants',
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(p + 'fruit');
      const leafy = crown(p, cx, cy, r * 0.86, '#4c8d38', rnd, 9, 0.34, 26);
      const fruit = scatter(rnd, 12, cx, cy, r * 0.74, [r * 0.04, r * 0.05], (v) => 0.35 + 0.65 * Math.sqrt(v));
      const fallen = Array.from({length: 2}, (): Dot => {
        const a = PI * (0.1 + rnd() * 0.6);
        return [cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9, r * 0.04];
      });
      const red = fruit.filter((_, i) => i % 4);
      const yellow = fruit.filter((_, i) => !(i % 4));
      return (
        <>
          {halo(p + 'h', cx, cy, r, r * 0.96)}
          <path d={circles(fallen)} fill="#9c3a2a" stroke="#6b2419" strokeWidth={n2(r * 0.008)} data-halo="" />
          {leafy}
          <path d={circles(red)} fill="#c8392b" stroke="#8c2219" strokeWidth={n2(r * 0.01)} />
          <path d={circles(yellow)} fill="#e7a733" stroke="#a8721c" strokeWidth={n2(r * 0.01)} />
          <path d={circles(fruit.map(([x, y, s]) => [x - s * 0.35, y - s * 0.35, s * 0.3]))} fill="#fff" opacity={0.6} />
        </>
      );
    },
  },
  palm: {
    label: 'Palm',
    group: 'plants',
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(p + 'palm');
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
    group: 'plants',
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.97, r * 0.92)}
          {crown(p, cx, cy, r * 0.86, '#56923d', random(p + 'bush'), 11, 0.31, 36)}
        </>
      );
    },
  },
  floweringBush: {
    label: 'Flowering shrub',
    group: 'plants',
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(p + 'bloom');
      const [c, light] = [['#e27fae', '#f7c6dc'], ['#a77fd0', '#dcc6f0'], ['#ece8dd', '#ffffff']][Math.floor(rnd() * 3)];
      const heads = scatter(rnd, 26, cx, cy, r * 0.76, [r * 0.045, r * 0.07]);
      const flowers = heads.flatMap(([x, y, hs]) => Array.from({length: 5}, (_, k): Dot => [x + Math.cos(k * 1.26 + x) * hs * 0.55, y + Math.sin(k * 1.26 + x) * hs * 0.55, hs * 0.36]));
      return (
        <>
          {halo(p + 'h', cx, cy, r * 0.97, r * 0.92)}
          {crown(p, cx, cy, r * 0.86, '#3f7d38', rnd, 10, 0.33, 24)}
          <path d={circles(heads.map(([x, y, hs]) => [x + hs * 0.25, y + hs * 0.3, hs]))} fill="#1f3f1c" opacity={0.35} />
          <path d={circles(heads)} fill={tone(c, -0.12)} />
          <path d={circles(flowers.filter((f) => !litSide(f, cx, cy)))} fill={c} />
          <path d={circles(flowers.filter((f) => litSide(f, cx, cy)))} fill={light} />
          <path d={circles(heads.map(([x, y, hs]) => [x, y, hs * 0.14]))} fill="#f6d36a" />
        </>
      );
    },
  },
  hedge: {
    label: 'Hedge',
    group: 'plants',
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
    label: 'Flower bed',
    group: 'plants',
    tile: {
      w: 0.9,
      h: 0.9,
      base: '#5e4130',
      draw: (m) => {
        const plants = tileScatter('bed', 7, 0.9, 0.9);
        const colors = ['#e2457a', '#f2c230', '#9b5fd0', '#f7f2ea', '#e8642c', '#5b8fe0', '#ef8fb7'];
        return (
          <>
            {dots(m, [
              [0.1, 0.08, 0.012, '#7a5640'],
              [0.42, 0.2, 0.01, '#4a3324'],
              [0.7, 0.12, 0.012, '#7a5640'],
              [0.22, 0.5, 0.01, '#4a3324'],
              [0.62, 0.62, 0.012, '#7a5640'],
              [0.84, 0.44, 0.01, '#4a3324'],
              [0.3, 0.8, 0.012, '#7a5640'],
            ])}
            {plants.map(([x, y], i) => (
              <g key={i}>
                <circle cx={n2(x * m + 0.02 * m)} cy={n2(y * m + 0.025 * m)} r={n2(0.13 * m)} fill="#000" opacity={0.2} />
                {rosette(x * m, y * m, 0.13 * m, i % 2 ? '#3f7d36' : '#4c8b3c', 6)}
              </g>
            ))}
            {blossoms(plants.flatMap(([x, y], i) => [0, 1, 2].map((k): [number, number, number, string] => [(x + Math.cos(k * 2.1 + i) * 0.05) * m, (y + Math.sin(k * 2.1 + i) * 0.05) * m, 0.045 * m, colors[i % colors.length]])))}
          </>
        );
      },
    },
  },
  flowerMeadow: {
    label: 'Wildflowers',
    group: 'plants',
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
    group: 'plants',
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
    group: 'plants',
    long: true,
    around: 'meadow',
    thing: (b, p) =>
      along(inset(b, 0.05), (l, d) => {
        const rnd = random(p + 'raised');
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
  pot: {
    label: 'Planter',
    group: 'plants',
    around: 'paving',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(p + 'pot');
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
          {crown(p, cx, cy, rp * 0.7, '#4f8f3c', rnd, 7, 0.38, 14)}
          {blossoms(flowers.map(([x, y, s]) => [x, y, s, '#d83a3a']))}
        </>
      );
    },
  },
  herbSpiral: {
    label: 'Herb spiral',
    group: 'plants',
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(p + 'herbs');
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
  rockGarden: {
    label: 'Rock garden',
    group: 'plants',
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
    group: 'plants',
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
    thing: ({x, y, w, h}, p) => {
      const {cx, cy} = middle({x, y, w, h});
      const rnd = random(p + 'pond');
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
    around: 'wood',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(p + 'tub');
      const s = r * 0.86;
      const t = s * 0.7;
      const bubbles = scatter(rnd, 26, cx, cy, t * 0.8, [s * 0.008, s * 0.02]);
      const jets: Dot[] = [-1, 1].flatMap((i) => [-0.4, 0.4].map((j): Dot => [cx + i * t * 0.86, cy + j * t, s * 0.025]));
      return (
        <>
          <defs>
            {face(p + 'c', '#6e5442', 0.12, -0.15)}
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
            stroke="#4e3a2d"
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
    around: 'gravel',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rb = r * 0.78;
      return (
        <>
          <defs>
            {ball(p + 'b', '#2f6b3b', 0.25, -0.4)}
            {ball(p + 'l', '#3a7d47', 0.2, -0.3)}
            {tube(p + 'd', '#9aa3a8', true)}
          </defs>
          {halo(p + 'h', cx, cy, r, r)}
          <rect x={n2(cx - r * 0.07)} y={n2(cy - r)} width={n2(r * 0.14)} height={n2(r * 0.4)} fill={`url(#${p}d)`} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(rb)} fill={`url(#${p}b)`} />
          {rimLight(cx, cy, rb * 0.96, rb * 0.03)}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(rb * 0.9)} fill="none" stroke="#4f8f5c" strokeOpacity={0.6} strokeWidth={n2(rb * 0.03)} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(rb * 0.82)} fill={`url(#${p}l)`} stroke="#22502b" strokeWidth={n2(rb * 0.03)} />
          <path
            d={Array.from({length: 8}, (_, i) => {
              const a = (i / 8) * 2 * PI;
              return `M${n2(cx + Math.cos(a) * rb * 0.3)} ${n2(cy + Math.sin(a) * rb * 0.3)}L${n2(cx + Math.cos(a) * rb * 0.78)} ${n2(cy + Math.sin(a) * rb * 0.78)}`;
            }).join('')}
            stroke="#22502b"
            strokeOpacity={0.6}
            strokeWidth={n2(rb * 0.025)}
          />
          <rect x={n2(cx - rb * 0.32)} y={n2(cy - rb * 0.07)} width={n2(rb * 0.64)} height={n2(rb * 0.14)} rx={n2(rb * 0.07)} fill="#22502b" />
          <rect x={n2(cx - rb * 0.3)} y={n2(cy - rb * 0.07)} width={n2(rb * 0.6)} height={n2(rb * 0.05)} rx={n2(rb * 0.03)} fill="#5c9a68" opacity={0.6} />
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
    around: 'meadow',
    thing: (b, p) => {
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
            {ball(p + 'p', '#2f72b4', 0.3, -0.3)}
            <radialGradient id={p + 'm'} cx={0.4} cy={0.36} r={0.7}>
              <stop offset={0} stopColor="#3a3d42" />
              <stop offset={1} stopColor="#141517" />
            </radialGradient>
          </defs>
          {halo(p + 'h', cx, cy, r, r)}
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.93)} fill="none" stroke="#2a2d31" strokeOpacity={0.45} strokeWidth={n2(r * 0.014)} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(r * 0.88)} fill={`url(#${p}p)`} />
          <path d={seams} stroke="#1d4f80" strokeOpacity={0.6} strokeWidth={n2(r * 0.012)} />
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
    thing: (b, p) =>
      along(inset(b, 0.06), (l, d) => {
        const rnd = random(p + 'sand');
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
    long: true,
    around: 'meadow',
    thing: (b, p) =>
      along(inset(b, 0.04), (l, d) => {
        const post = l * 0.035;
        const seats = [
          {x: -l * 0.18, y: d * 0.16, c: '#d6453a'},
          {x: l * 0.18, y: -d * 0.1, c: '#2f8a4f'},
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
    long: true,
    around: 'sand',
    thing: (b, p) =>
      along(inset(b, 0.04), (l, d) => {
        const s = Math.min(d * 0.78, l * 0.42);
        const tx = -l / 2 + s / 2 + l * 0.05;
        const sw = s * 0.4;
        const end = l / 2 - l * 0.02;
        return (
          <>
            <defs>
              <linearGradient id={p + 's'} x1={0} y1={0} x2={0} y2={1}>
                <stop offset={0} stopColor="#f7d35a" />
                <stop offset={0.5} stopColor="#f2c230" />
                <stop offset={1} stopColor="#c89414" />
              </linearGradient>
            </defs>
            {softBox(tx - s / 2, -s / 2, s, s, s * 0.02, s * 0.08)}
            <path d={`M${n2(tx + s * 0.45)} ${n2(-sw / 2)}L${n2(end - sw * 0.3)} ${n2(-sw * 0.6)}Q${n2(end)} ${n2(-sw * 0.6)} ${n2(end)} 0Q${n2(end)} ${n2(sw * 0.6)} ${n2(end - sw * 0.3)} ${n2(sw * 0.6)}L${n2(tx + s * 0.45)} ${n2(sw / 2)}Z`} fill="#000" opacity={0.18} transform={`translate(${n2(s * 0.03)} ${n2(s * 0.05)})`} data-halo="" />
            <path d={`M${n2(tx + s * 0.45)} ${n2(-sw / 2)}L${n2(end - sw * 0.3)} ${n2(-sw * 0.6)}Q${n2(end)} ${n2(-sw * 0.6)} ${n2(end)} 0Q${n2(end)} ${n2(sw * 0.6)} ${n2(end - sw * 0.3)} ${n2(sw * 0.6)}L${n2(tx + s * 0.45)} ${n2(sw / 2)}Z`} fill={`url(#${p}s)`} stroke="#b07f10" strokeWidth={n2(sw * 0.06)} />
            <path d={`M${n2(tx + s * 0.5)} 0L${n2(end - sw * 0.35)} 0`} stroke="#fff" strokeOpacity={0.45} strokeWidth={n2(sw * 0.14)} strokeLinecap="round" />
            <path d={`M${n2(tx - s / 2 - l * 0.045)} ${n2(-s * 0.18)}h${n2(l * 0.045)}M${n2(tx - s / 2 - l * 0.045)} ${n2(s * 0.18)}h${n2(l * 0.045)}`} stroke={tone(WOOD, -0.1)} strokeWidth={n2(s * 0.05)} strokeLinecap="round" />
            <path d={Array.from({length: 4}, (_, i) => `M${n2(tx - s / 2 - l * 0.045 + (i * l * 0.045) / 3)} ${n2(-s * 0.18)}v${n2(s * 0.36)}`).join('')} stroke={WOOD} strokeWidth={n2(s * 0.03)} />
            <g transform={`translate(${n2(tx)} 0)`}>{gableRoof(p, s, s, '#3f8f4a', s * 0.12)}</g>
          </>
        );
      }),
  },
  pingPong: {
    label: 'Table tennis',
    group: 'play',
    long: true,
    around: 'paving',
    thing: (b, p) =>
      along(inset(b, 0.06), (l, d) => {
        const len = Math.min(l * 0.94, d * 0.94 * 1.8);
        const wid = len / 1.8;
        const line = wid * 0.02;
        return (
          <>
            <defs>{face(p + 't', '#1f5d8c', 0.12, -0.15)}</defs>
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
  house: {label: 'House', group: 'buildings', around: 'paving', long: true, thing: (b, p) => hipRoof(p, b, '#b0573d')},
  shed: {
    label: 'Shed',
    group: 'buildings',
    around: 'gravel',
    long: true,
    thing: (b, p) =>
      along(inset(b, 0.05), (l, d) => (
        <>
          {softBox(-l / 2, -d / 2, l, d, d * 0.02, d * 0.06)}
          {gableRoof(p, l, d, '#5d675b')}
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
    thing: (b, p) =>
      along(inset(b, 0.05), (l, d) => {
        const rnd = random(p + 'glass');
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
    around: 'paving',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      const s = r * 0.84;
      const [l, t, rt, bt] = [cx - s, cy - s, cx + s, cy + s];
      const c = '#ece5d6';
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
    long: true,
    around: 'wood',
    thing: (b, p) =>
      along(inset(b, 0.04), (l, d) => {
        const rnd = random(p + 'pergola');
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
            <path d={circles(grapes.flatMap(([x, y, r]) => [0, 1, 2, 3].map((k): Dot => [x + (k % 2) * r * 0.4, y + r * 0.6 + Math.floor(k / 2) * r * 0.35, r * 0.2])))} fill="#7b4a9e" />
          </>
        );
      }),
  },
  kennel: {
    label: 'Hutch',
    group: 'buildings',
    long: true,
    around: 'meadow',
    thing: (b, p) =>
      along(inset(b, 0.05), (l, d) => {
        const s = Math.min(d * 0.86, l * 0.42);
        const hx = -l / 2 + s / 2;
        const [rx, rw] = [hx + s / 2, l / 2 - (hx + s / 2)];
        const rnd = random(p + 'hutch');
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
              {gableRoof(p, s, s, '#b5533c', s * 0.13)}
            </g>
          </>
        );
      }),
  },
  car: {
    label: 'Car',
    group: 'buildings',
    long: true,
    around: 'paving',
    thing: (b, p) =>
      along(b, (l, d) => {
        const len = Math.min(l * 0.9, d * 0.9 * 2.2);
        const wid = len / 2.2;
        const [x0, x1] = [-len / 2, len / 2];
        const body = `M${n2(x0 + wid * 0.25)} ${n2(-wid / 2)}H${n2(x1 - wid * 0.32)}Q${n2(x1)} ${n2(-wid / 2)} ${n2(x1)} ${n2(-wid * 0.2)}V${n2(wid * 0.2)}Q${n2(x1)} ${n2(wid / 2)} ${n2(x1 - wid * 0.32)} ${n2(wid / 2)}H${n2(x0 + wid * 0.25)}Q${n2(x0)} ${n2(wid / 2)} ${n2(x0)} ${n2(wid * 0.25)}V${n2(-wid * 0.25)}Q${n2(x0)} ${n2(-wid / 2)} ${n2(x0 + wid * 0.25)} ${n2(-wid / 2)}Z`;
        const glass = (x: number, w: number, k: number) => poly([[x, -wid * 0.36], [x + w, -wid * 0.38 * k], [x + w, wid * 0.38 * k], [x, wid * 0.36]]);
        return (
          <>
            <defs>
              <linearGradient id={p + 'b'} x1={0} y1={0} x2={0} y2={1}>
                <stop offset={0} stopColor="#6f8fbd" />
                <stop offset={0.45} stopColor="#4b6b9b" />
                <stop offset={1} stopColor="#2e4568" />
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
            <path d={body} fill={`url(#${p}b)`} stroke="#22344f" strokeWidth={n2(wid * 0.015)} />
            <polygon points={glass(len * 0.08, len * 0.13, 0.82)} fill={`url(#${p}g)`} />
            <polygon points={glass(-len * 0.3, -len * 0.08, 0.85)} fill={`url(#${p}g)`} />
            <rect x={n2(-len * 0.3)} y={n2(-wid * 0.32)} width={n2(len * 0.38)} height={n2(wid * 0.64)} rx={n2(wid * 0.08)} fill="#5f81b3" />
            <rect x={n2(-len * 0.26)} y={n2(-wid * 0.28)} width={n2(len * 0.3)} height={n2(wid * 0.12)} rx={n2(wid * 0.05)} fill="#fff" opacity={0.18} />
            <path d={`M${n2(-len * 0.3)} ${n2(-wid * 0.4)}H${n2(len * 0.08)}M${n2(-len * 0.3)} ${n2(wid * 0.4)}H${n2(len * 0.08)}`} stroke="#1c2633" strokeWidth={n2(wid * 0.06)} strokeLinecap="round" />
            <path d={`M${n2(len * 0.12)} ${n2(-wid * 0.25)}l${n2(len * 0.06)} ${n2(wid * 0.18)}`} stroke="#fff" strokeOpacity={0.3} strokeWidth={n2(wid * 0.04)} strokeLinecap="round" />
            <path d={`M${n2(len * 0.24)} ${n2(-wid * 0.42)}Q${n2(len * 0.36)} 0 ${n2(len * 0.24)} ${n2(wid * 0.42)}`} stroke="#22344f" strokeOpacity={0.5} strokeWidth={n2(wid * 0.012)} fill="none" />
            <path d={`M${n2(-len * 0.06)} ${n2(-wid * 0.5)}v${n2(wid * 0.06)}M${n2(-len * 0.06)} ${n2(wid * 0.5)}v${n2(-wid * 0.06)}`} stroke="#22344f" strokeWidth={n2(wid * 0.012)} />
            <ellipse cx={n2(len * 0.08)} cy={n2(-wid * 0.54)} rx={n2(wid * 0.07)} ry={n2(wid * 0.04)} fill="#3f5f8e" />
            <ellipse cx={n2(len * 0.08)} cy={n2(wid * 0.54)} rx={n2(wid * 0.07)} ry={n2(wid * 0.04)} fill="#3f5f8e" />
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
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(p + 'seat');
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
            return chair(cx + Math.cos(a) * r * 0.66, cy + Math.sin(a) * r * 0.66, r * 0.32, deg + 90);
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
    long: true,
    around: 'meadow',
    thing: (b, p) =>
      along(b, (l, d) => {
        const rnd = random(p + 'table');
        const c = Math.min(l * 0.17, d * 0.25);
        const [tl, td] = [l * 0.78, Math.max(d - 2 * c * 1.3, d * 0.3)];
        const places = [-1, 0, 1].flatMap((i) => [-1, 1].map((s) => ({x: i * tl * 0.3, s})));
        return (
          <>
            {places.map(({x, s}) => chair(x, s * (td / 2 + c * 0.55), c, s < 0 ? 0 : 180))}
            {softBox(-tl / 2, -td / 2, tl, td, td * 0.06, td * 0.07)}
            <rect x={n2(-tl / 2)} y={n2(-td / 2)} width={n2(tl)} height={n2(td)} rx={n2(td * 0.06)} fill="#8f6640" />
            {boards(-tl / 2 + td * 0.04, -td / 2 + td * 0.04, tl - td * 0.08, td * 0.92, 4, '#b5864f', rnd)}
            {places.map(({x, s}) => (
              <g key={`${x}${s}`}>
                <circle cx={n2(x)} cy={n2(s * td * 0.24)} r={n2(td * 0.13)} fill="#f4f2ed" stroke="#c9c4ba" strokeWidth={n2(td * 0.01)} />
                <circle cx={n2(x)} cy={n2(s * td * 0.24)} r={n2(td * 0.08)} fill="#fff" />
                <circle cx={n2(x + tl * 0.07)} cy={n2(s * td * 0.3)} r={n2(td * 0.045)} fill="#bfe3f2" stroke="#8fb9cc" strokeWidth={n2(td * 0.008)} />
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
    long: true,
    around: 'meadow',
    thing: (b, p) =>
      along(inset(b, 0.1), (l, d) => {
        const rnd = random(p + 'bench');
        const [bl, bd] = [l * 0.9, Math.min(d * 0.55, l * 0.3)];
        return (
          <>
            {softBox(-bl / 2, -bd / 2, bl, bd, bd * 0.06, bd * 0.12)}
            {boards(-bl / 2, -bd * 0.18, bl, bd * 0.68, 3, '#a8794a', rnd)}
            <rect x={n2(-bl / 2)} y={n2(-bd / 2)} width={n2(bl)} height={n2(bd * 0.24)} rx={n2(bd * 0.04)} fill="#7a5530" />
            <rect x={n2(-bl / 2)} y={n2(-bd / 2)} width={n2(bl)} height={n2(bd * 0.08)} rx={n2(bd * 0.03)} fill="#a8794a" />
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
    long: true,
    around: 'meadow',
    thing: (b, p) =>
      along(b, (l, d) => {
        const ll = Math.min(l * 0.95, d * 2.6);
        const ld = ll / 2.6;
        const stripes = Array.from({length: 7}, (_, i) => (
          <rect key={i} x={n2(-ll / 2 + ld * 0.1)} y={n2(-ld / 2 + ld * 0.12 + (ld * 0.76 * i) / 7)} width={n2(ll - ld * 0.2)} height={n2((ld * 0.76) / 14)} fill="#4e86b5" opacity={0.5} />
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
    long: true,
    around: 'wood',
    thing: (b, p) =>
      along(inset(b, 0.06), (l, d) => {
        const t = Math.min(l, d) * 0.24;
        const [x0, y0] = [-l / 2, -d / 2];
        const weave: string[] = [];
        for (let k = 0; k < l + d; k += t * 0.22) weave.push(`M${n2(x0 + k)} ${n2(y0)}l${n2(-d)} ${n2(d)}`);
        const cushion = '#cfd5d8';
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
    around: 'paving',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(p + 'grill');
      const g = r * 0.6;
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
              <stop offset={0} stopColor="#5d636b" />
              <stop offset={0.5} stopColor="#24272b" />
              <stop offset={1} stopColor="#0b0c0e" />
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
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(g)} fill="#1b1d20" />
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
    long: true,
    around: 'meadow',
    thing: (b, p) =>
      along(inset(b, 0.05), (l, d) => {
        const w = Math.min(d * 0.32, l * 0.15);
        const colors = ['#e0a83a', '#d4693f', '#3f8f8a', '#efe6d0', '#c94c4c'];
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
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const n = 8;
      const fabrics: [string, string][] = [['#ece2cb', '#ece2cb'], ['#c9643f', '#c9643f'], ['#8fae8a', '#8fae8a'], ['#f2efe6', '#3f6f9f'], ['#f2efe6', '#c9643f']];
      const [c, c2] = fabrics[Math.floor(random(p + 'parasol')() * fabrics.length)];
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
  sunSail: {
    label: 'Shade sail',
    group: 'outdoor',
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const c = '#e6dcc4';
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
    around: 'gravel',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(p + 'fire');
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
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const s = r * 0.34;
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
          <polygon points={poly([[cx - s * 0.8, cy - s * 0.8], [cx + s * 0.8, cy - s * 0.8], [cx, cy]])} fill="#4a4e53" />
          <polygon points={poly([[cx + s * 0.8, cy - s * 0.8], [cx + s * 0.8, cy + s * 0.8], [cx, cy]])} fill="#2c2f33" />
          <polygon points={poly([[cx + s * 0.8, cy + s * 0.8], [cx - s * 0.8, cy + s * 0.8], [cx, cy]])} fill="#25282b" />
          <polygon points={poly([[cx - s * 0.8, cy + s * 0.8], [cx - s * 0.8, cy - s * 0.8], [cx, cy]])} fill="#3d4146" />
          <path d={`M${n2(cx - s * 0.8)} ${n2(cy - s * 0.8)}L${n2(cx + s * 0.8)} ${n2(cy + s * 0.8)}M${n2(cx + s * 0.8)} ${n2(cy - s * 0.8)}L${n2(cx - s * 0.8)} ${n2(cy + s * 0.8)}`} stroke="#5d6268" strokeWidth={n2(s * 0.04)} />
          <rect x={n2(cx - s * 0.22)} y={n2(cy - s * 0.22)} width={n2(s * 0.44)} height={n2(s * 0.44)} fill="#55595e" stroke="#1c1e21" strokeWidth={n2(s * 0.03)} />
          <circle cx={n2(cx)} cy={n2(cy)} r={n2(s * 0.1)} fill="#1c1e21" />
        </>
      );
    },
  },

  // other
  clothesDryer: {
    label: 'Rotary dryer',
    group: 'other',
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(p + 'dryer');
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
    around: 'soil',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(p + 'compost');
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
    long: true,
    around: 'gravel',
    thing: (b, p) =>
      along(inset(b, 0.05), (l, d) => {
        const rnd = random(p + 'wood');
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
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(p + 'bird');
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
          <g transform={`translate(${n2(cx)} ${n2(cy)})`}>{gableRoof(p, s * 1.5, s * 1.3, '#a24a36', s * 0.18)}</g>
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
    around: 'gravel',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const s = r * 0.62;
      const stone = '#cdc7ba';
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
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const rnd = random(p + 'rocks');
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
    around: 'meadow',
    thing: (b, p) => {
      const {cx, cy, r} = middle(b);
      const s = r * 0.55;
      return (
        <>
          <defs>
            <radialGradient id={p + 'c'} cx={0.5} cy={0.62} r={0.6} fx={0.48} fy={0.72}>
              <stop offset={0} stopColor="#ff6b5e" />
              <stop offset={0.6} stopColor="#d9302a" />
              <stop offset={1} stopColor="#8f1914" />
            </radialGradient>
            {ball(p + 'b', '#2f64b5', 0.3, -0.35)}
          </defs>
          {halo(p + 'h', cx, cy, s * 1.1, s * 1.1, 0.32)}
          <path d={circles([-1, 1].map((i): Dot => [cx + i * s * 0.28, cy + s * 0.62, s * 0.16]))} fill="#2a2522" />
          <ellipse cx={n2(cx)} cy={n2(cy + s * 0.18)} rx={n2(s * 0.62)} ry={n2(s * 0.48)} fill={`url(#${p}b)`} />
          <path d={circles([[cx - s * 0.2, cy + s * 0.34, s * 0.2], [cx + s * 0.2, cy + s * 0.34, s * 0.2], [cx, cy + s * 0.44, s * 0.22], [cx, cy + s * 0.22, s * 0.24]])} fill="#f4f1ea" stroke="#cfc8bb" strokeWidth={n2(s * 0.02)} />
          <circle cx={n2(cx)} cy={n2(cy - s * 0.08)} r={n2(s * 0.46)} fill={`url(#${p}c)`} />
          <circle cx={n2(cx + s * 0.02)} cy={n2(cy + s * 0.12)} r={n2(s * 0.08)} fill="#ff8a7a" />
          <path d={circles([-1, 1].map((i): Dot => [cx + i * s * 0.6, cy + s * 0.2, s * 0.1]))} fill="#f0c2a0" />
        </>
      );
    },
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
  ['raisedBed', /hochbeet|raised/i],
  ['herbSpiral', /kräuterspirale|kraeuterspirale|herb ?spiral|spirale/i],
  ['vegetables', /gemüse|vegetable|kräuter|herb|salat|tomate/i],
  ['flowerMeadow', /blumenwiese|wildblume|wildflower|insekt|bienenweide/i],
  ['rockGarden', /steingarten|steinbeet|rock ?garden/i],
  ['fruitTree', /obst|apfel|birne|kirsch|pflaume|zwetsch|fruit|apple|cherry|pear|plum/i],
  ['conifer', /tanne|fichte|kiefer|nadel|conifer|pine|\bfir\b|spruce|thuja|lebensbaum/i],
  ['palm', /palme|palm/i],
  ['woodpile', /holzstapel|brennholz|feuerholz|kaminholz|holzlager|woodpile|firewood|log ?pile/i],
  ['tree', /baum|bäume|tree|linde|eiche|ahorn|birke|buche|walnuss|kastanie/i],
  ['hedge', /hecke|hedge|wald|forest/i],
  ['floweringBush', /rose|hortensie|hydrangea|flieder|lilac|rhododendron|azalee|azalea|blühstrauch|forsythie|forsythia|hibiskus|hibiscus/i],
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
