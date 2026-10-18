// The pictures of the garden map style, from above in the colors of the guides. A thing is drawn once into the box
// of its area (svg units, y down) and cut to the area's outline by the map, with a ground around it. A ground is a
// texture in meters, it grows and shrinks with the map.

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
  // a thing: drawn into the box, with this ground around it
  thing?: (b: Box) => React.ReactNode;
  around?: string;
  // a ground: the texture
  tile?: Tile;
}

const middle = (b: Box) => ({cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.min(b.w, b.h) / 2});
const shadow = (cx: number, cy: number, rx: number, ry = rx) => (
  <ellipse cx={cx + rx * 0.12} cy={cy + ry * 0.16} rx={rx} ry={ry} fill="#000" opacity={0.22} />
);
// drawn lying along the longer side of the box: l long, d deep, around 0,0
const along = (b: Box, draw: (l: number, d: number) => React.ReactNode) => (
  <g transform={`translate(${b.x + b.w / 2} ${b.y + b.h / 2})${b.w >= b.h ? '' : ' rotate(90)'}`}>{draw(Math.max(b.w, b.h), Math.min(b.w, b.h))}</g>
);
// a star: n points between the two radii
const star = (cx: number, cy: number, outer: number, inner: number, n: number, turn = 0) =>
  Array.from({length: 2 * n}, (_, i) => {
    const a = turn + (i * Math.PI) / n;
    const rr = i % 2 ? inner : outer;
    return `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
  }).join(' ');
// a hipped roof filling the box: the ridge along the long side, the hips from the corners to its ends
const roof = ({x, y, w, h}: Box, tile: string, ridge: string) => {
  const {cx, cy} = middle({x, y, w, h});
  const inset = Math.min(w, h) / 2;
  const wide = w >= h;
  const [a, b] = wide ? [`${x + inset} ${cy}`, `${x + w - inset} ${cy}`] : [`${cx} ${y + inset}`, `${cx} ${y + h - inset}`];
  const hips = wide
    ? `M${x} ${y} L${a} L${x} ${y + h} M${x + w} ${y} L${b} L${x + w} ${y + h}`
    : `M${x} ${y} L${a} L${x + w} ${y} M${x} ${y + h} L${b} L${x + w} ${y + h}`;
  return (
    <>
      <rect x={x} y={y} width={w} height={h} fill={tile} />
      <path d={hips} stroke={ridge} strokeOpacity={0.7} strokeWidth={1.2} fill="none" />
      <path d={`M${a} L${b}`} stroke={ridge} strokeWidth={2} />
    </>
  );
};
const inset = (b: Box, f: number): Box => {
  const d = Math.min(b.w, b.h) * f;
  return {x: b.x + d, y: b.y + d, w: b.w - 2 * d, h: b.h - 2 * d};
};
// a few blades of grass standing at x, y in meters
const tuft = (m: number, x: number, y: number) =>
  `M${x * m} ${y * m} l${-0.04 * m} ${-0.11 * m} l${0.03 * m} ${0.08 * m} l${0.01 * m} ${-0.12 * m} l${0.02 * m} ${0.12 * m} ` +
  `l${0.03 * m} ${-0.08 * m} l${-0.03 * m} ${0.11 * m} Z`;
const dots = (m: number, list: [number, number, number, string][]) =>
  list.map(([x, y, r, fill], i) => <circle key={i} cx={x * m} cy={y * m} r={r * m} fill={fill} />);

export const PICTURES: Record<string, Picture> = {
  // plants
  tree: {
    label: 'Tree',
    group: 'plants',
    around: 'meadow',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {shadow(cx, cy, r * 0.95, r * 0.85)}
          <circle cx={cx} cy={cy} r={r * 0.9} fill="#2e6a2a" />
          <circle cx={cx - r * 0.32} cy={cy - r * 0.26} r={r * 0.5} fill="#3d8236" />
          <circle cx={cx + r * 0.38} cy={cy + r * 0.22} r={r * 0.45} fill="#367732" />
          <circle cx={cx + r * 0.16} cy={cy - r * 0.45} r={r * 0.28} fill="#4a9142" />
        </>
      );
    },
  },
  conifer: {
    label: 'Conifer',
    group: 'plants',
    around: 'meadow',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {shadow(cx, cy, r * 0.9)}
          <polygon points={star(cx, cy, r * 0.92, r * 0.7, 14)} fill="#1f5a2c" />
          <polygon points={star(cx, cy, r * 0.66, r * 0.48, 11, 0.3)} fill="#2a6e36" />
          <polygon points={star(cx, cy, r * 0.4, r * 0.28, 8, 0.6)} fill="#33803f" />
          <circle cx={cx} cy={cy} r={r * 0.1} fill="#24502a" />
        </>
      );
    },
  },
  fruitTree: {
    label: 'Fruit tree',
    group: 'plants',
    around: 'meadow',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      const fruit: [number, number, string][] = [
        [-0.4, 0.1, '#e53935'],
        [0.2, -0.5, '#e53935'],
        [0.5, 0, '#fbc02d'],
        [-0.1, 0.45, '#e53935'],
        [0.3, 0.52, '#e53935'],
        [-0.55, -0.35, '#fbc02d'],
        [0.05, 0.05, '#e53935'],
      ];
      return (
        <>
          {shadow(cx, cy, r * 0.95, r * 0.85)}
          <circle cx={cx} cy={cy} r={r * 0.9} fill="#3a7d31" />
          <circle cx={cx - r * 0.3} cy={cy - r * 0.25} r={r * 0.5} fill="#469a3b" />
          <circle cx={cx + r * 0.36} cy={cy + r * 0.24} r={r * 0.44} fill="#3f8a35" />
          {fruit.map(([dx, dy, c], i) => (
            <circle key={i} cx={cx + dx * r} cy={cy + dy * r} r={r * 0.08} fill={c} />
          ))}
        </>
      );
    },
  },
  palm: {
    label: 'Palm',
    group: 'plants',
    around: 'meadow',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {shadow(cx, cy, r * 0.7)}
          {Array.from({length: 8}, (_, i) => {
            const deg = i * 45 + 10;
            const a = (deg * Math.PI) / 180;
            const [ex, ey] = [cx + Math.cos(a) * r * 0.46, cy + Math.sin(a) * r * 0.46];
            return (
              <g key={i} transform={`rotate(${deg} ${ex} ${ey})`}>
                <ellipse cx={ex} cy={ey} rx={r * 0.48} ry={r * 0.14} fill={i % 2 ? '#3e8e3a' : '#4a9c45'} />
                <rect x={ex - r * 0.44} y={ey - r * 0.01} width={r * 0.88} height={r * 0.02} fill="#2e6a2a" />
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r={r * 0.14} fill="#8d6e3f" />
        </>
      );
    },
  },
  bush: {
    label: 'Bush',
    group: 'plants',
    around: 'meadow',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {shadow(cx, cy, r * 0.85, r * 0.75)}
          <circle cx={cx - r * 0.3} cy={cy - r * 0.15} r={r * 0.5} fill="#3d8236" />
          <circle cx={cx + r * 0.3} cy={cy - r * 0.2} r={r * 0.45} fill="#367732" />
          <circle cx={cx} cy={cy + r * 0.3} r={r * 0.5} fill="#47913c" />
          <circle cx={cx - r * 0.25} cy={cy - r * 0.3} r={r * 0.18} fill="#5aa64b" />
        </>
      );
    },
  },
  hedge: {
    label: 'Hedge',
    group: 'plants',
    tile: {
      w: 1.4,
      h: 1.4,
      base: '#2e6a2a',
      draw: (m) =>
        dots(m, [
          [0.35, 0.4, 0.32, '#3d8236'],
          [1.05, 1, 0.3, '#367732'],
          [0.95, 0.3, 0.16, '#4a9142'],
          [0.3, 1.1, 0.14, '#4a9142'],
        ]),
    },
  },
  bed: {
    label: 'Flower bed',
    group: 'plants',
    tile: {
      w: 0.7,
      h: 0.7,
      base: '#6d4c36',
      draw: (m) =>
        dots(m, [
          [0.15, 0.18, 0.07, '#3d7a33'],
          [0.15, 0.18, 0.035, '#ff6f91'],
          [0.5, 0.3, 0.07, '#3d7a33'],
          [0.5, 0.3, 0.035, '#ffd54f'],
          [0.32, 0.56, 0.07, '#3d7a33'],
          [0.32, 0.56, 0.035, '#ba68c8'],
        ]),
    },
  },
  flowerMeadow: {
    label: 'Wildflowers',
    group: 'plants',
    tile: {
      w: 0.7,
      h: 0.7,
      base: '#5d8d3a',
      draw: (m) => (
        <>
          <path d={tuft(m, 0.1, 0.3)} fill="#4a7a2e" />
          <path d={tuft(m, 0.48, 0.62)} fill="#6e9c45" />
          {dots(m, [
            [0.22, 0.14, 0.04, '#fafafa'],
            [0.22, 0.14, 0.015, '#fbc02d'],
            [0.55, 0.3, 0.035, '#ba68c8'],
            [0.36, 0.48, 0.04, '#fafafa'],
            [0.36, 0.48, 0.015, '#fbc02d'],
            [0.12, 0.6, 0.03, '#ef5350'],
            [0.62, 0.08, 0.03, '#ffd54f'],
          ])}
        </>
      ),
    },
  },
  vegetables: {
    label: 'Vegetable patch',
    group: 'plants',
    tile: {
      w: 0.8,
      h: 0.45,
      base: '#5d4030',
      draw: (m) =>
        dots(m, [
          [0.2, 0.22, 0.1, '#4a9142'],
          [0.2, 0.22, 0.05, '#6fb04f'],
          [0.6, 0.22, 0.1, '#3d8236'],
          [0.6, 0.22, 0.05, '#5aa64b'],
        ]),
    },
  },
  raisedBed: {
    label: 'Raised bed',
    group: 'plants',
    around: 'meadow',
    thing: (b) =>
      along(inset(b, 0.06), (l, d) => {
        const f = d * 0.12;
        const n = Math.max(2, Math.round(((l - 2 * f) / (d - 2 * f)) * 2));
        return (
          <>
            <rect x={-l / 2 + d * 0.05} y={-d / 2 + d * 0.07} width={l} height={d} fill="#000" opacity={0.2} />
            <rect x={-l / 2} y={-d / 2} width={l} height={d} rx={f * 0.3} fill="#8d6e3f" />
            <rect x={-l / 2 + f} y={-d / 2 + f} width={l - 2 * f} height={d - 2 * f} fill="#5d4030" />
            {[-1, 1].map((row) =>
              Array.from({length: n}, (_, i) => (
                <circle
                  key={`${row}${i}`}
                  cx={-l / 2 + f + ((l - 2 * f) * (i + 0.5)) / n}
                  cy={(row * (d - 2 * f)) / 4}
                  r={Math.min((l - 2 * f) / n, (d - 2 * f) / 2) * 0.38}
                  fill={(i + row) % 2 ? '#4a9142' : '#3d8236'}
                />
              )),
            )}
          </>
        );
      }),
  },
  pot: {
    label: 'Planter',
    group: 'plants',
    around: 'paving',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {shadow(cx, cy, r * 0.82)}
          <circle cx={cx} cy={cy} r={r * 0.82} fill="#c46a3c" />
          <circle cx={cx} cy={cy} r={r * 0.66} fill="#5d4030" />
          <circle cx={cx} cy={cy} r={r * 0.46} fill="#3d8236" />
          <circle cx={cx - r * 0.15} cy={cy - r * 0.12} r={r * 0.22} fill="#4a9142" />
          <circle cx={cx + r * 0.16} cy={cy + r * 0.1} r={r * 0.08} fill="#ff6f91" />
        </>
      );
    },
  },
  rockGarden: {
    label: 'Rock garden',
    group: 'plants',
    tile: {
      w: 1.2,
      h: 1.2,
      base: '#b8b0a1',
      draw: (m) => (
        <>
          <ellipse cx={0.3 * m} cy={0.3 * m} rx={0.2 * m} ry={0.14 * m} fill="#9e9e9e" />
          <ellipse cx={0.26 * m} cy={0.26 * m} rx={0.08 * m} ry={0.05 * m} fill="#bdbdbd" />
          <ellipse cx={0.85 * m} cy={0.8 * m} rx={0.17 * m} ry={0.12 * m} fill="#8d8d8d" />
          {dots(m, [
            [0.75, 0.25, 0.07, '#5a9a4a'],
            [0.75, 0.25, 0.025, '#ba68c8'],
            [0.3, 0.85, 0.06, '#5a9a4a'],
            [1.05, 0.5, 0.05, '#6fb04f'],
          ])}
        </>
      ),
    },
  },
  meadow: {
    label: 'Meadow',
    group: 'plants',
    tile: {
      w: 0.6,
      h: 0.6,
      base: '#5d8d3a',
      draw: (m) => (
        <>
          <path d={tuft(m, 0.12, 0.22)} fill="#4a7a2e" />
          <path d={tuft(m, 0.42, 0.14)} fill="#6e9c45" />
          <path d={tuft(m, 0.3, 0.48)} fill="#4a7a2e" />
          <path d={tuft(m, 0.54, 0.44)} fill="#6e9c45" />
        </>
      ),
    },
  },

  // water
  pond: {
    label: 'Pond',
    group: 'water',
    around: 'meadow',
    thing: ({x, y, w, h}) => {
      const {cx, cy} = middle({x, y, w, h});
      return (
        <>
          <ellipse cx={cx} cy={cy} rx={w * 0.47} ry={h * 0.47} fill="#a9d8f2" />
          <ellipse cx={cx} cy={cy + h * 0.02} rx={w * 0.4} ry={h * 0.38} fill="#3d8fcf" />
          <ellipse cx={cx - w * 0.12} cy={cy - h * 0.12} rx={w * 0.12} ry={h * 0.03} fill="#fff" opacity={0.5} />
        </>
      );
    },
  },
  pool: {
    label: 'Pool',
    group: 'water',
    around: 'paving',
    thing: ({x, y, w, h}) => {
      const rim = Math.min(w, h) * 0.08;
      return (
        <>
          <rect x={x + rim} y={y + rim} width={w - 2 * rim} height={h - 2 * rim} rx={rim} fill="#eef4f7" />
          <rect x={x + 2 * rim} y={y + 2 * rim} width={w - 4 * rim} height={h - 4 * rim} rx={rim * 0.6} fill="#45b0e6" />
          <path
            d={`M${x + 3 * rim} ${y + h * 0.35} q${w * 0.1} ${-rim} ${w * 0.2} 0 M${x + w * 0.5} ${y + h * 0.62} q${w * 0.1} ${-rim} ${w * 0.2} 0`}
            stroke="#fff"
            strokeOpacity={0.6}
            strokeWidth={1.5}
            fill="none"
            strokeLinecap="round"
          />
        </>
      );
    },
  },
  roundPool: {
    label: 'Round pool',
    group: 'water',
    around: 'meadow',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {shadow(cx, cy, r * 0.9)}
          <circle cx={cx} cy={cy} r={r * 0.92} fill="#eef4f7" />
          <circle cx={cx} cy={cy} r={r * 0.8} fill="#45b0e6" />
          <path
            d={`M${cx - r * 0.45} ${cy - r * 0.2} q${r * 0.2} ${-r * 0.12} ${r * 0.4} 0`}
            stroke="#fff"
            strokeOpacity={0.6}
            strokeWidth={1.5}
            fill="none"
            strokeLinecap="round"
          />
        </>
      );
    },
  },
  fountain: {
    label: 'Fountain',
    group: 'water',
    around: 'paving',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {shadow(cx, cy, r * 0.9)}
          <circle cx={cx} cy={cy} r={r * 0.92} fill="#b0a89a" />
          <circle cx={cx} cy={cy} r={r * 0.72} fill="#3d8fcf" />
          <circle cx={cx} cy={cy} r={r * 0.48} fill="none" stroke="#a9d8f2" strokeWidth={1} />
          <circle cx={cx} cy={cy} r={r * 0.3} fill="none" stroke="#a9d8f2" strokeWidth={1} />
          <circle cx={cx} cy={cy} r={r * 0.13} fill="#cfc8ba" />
        </>
      );
    },
  },
  rainBarrel: {
    label: 'Rain barrel',
    group: 'water',
    around: 'gravel',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {shadow(cx, cy, r * 0.8)}
          <circle cx={cx} cy={cy} r={r * 0.8} fill="#2e7d32" />
          <circle cx={cx} cy={cy} r={r * 0.62} fill="#388e3c" />
          <circle cx={cx} cy={cy} r={r * 0.62} fill="none" stroke="#1b5e20" strokeWidth={1.5} />
          <rect x={cx - r * 0.3} y={cy - r * 0.06} width={r * 0.6} height={r * 0.12} rx={r * 0.06} fill="#1b5e20" />
        </>
      );
    },
  },
  water: {
    label: 'Water',
    group: 'water',
    tile: {
      w: 1.6,
      h: 1,
      base: '#3d8fcf',
      draw: (m) => (
        <>
          <ellipse cx={0.4 * m} cy={0.3 * m} rx={0.2 * m} ry={0.025 * m} fill="#a9d8f2" opacity={0.6} />
          <ellipse cx={1.2 * m} cy={0.75 * m} rx={0.16 * m} ry={0.02 * m} fill="#a9d8f2" opacity={0.5} />
        </>
      ),
    },
  },

  // play
  trampoline: {
    label: 'Trampoline',
    group: 'play',
    around: 'meadow',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {shadow(cx, cy, r * 0.9)}
          <circle cx={cx} cy={cy} r={r * 0.9} fill="#1f6fb2" />
          <circle cx={cx} cy={cy} r={r * 0.74} fill="#222" />
          <circle cx={cx} cy={cy} r={r * 0.74} fill="none" stroke="#9aa0ab" strokeWidth={1} strokeDasharray="2 3" />
        </>
      );
    },
  },
  sandbox: {
    label: 'Sandbox',
    group: 'play',
    around: 'meadow',
    thing: (b) =>
      along(inset(b, 0.08), (l, d) => {
        const f = d * 0.1;
        return (
          <>
            <rect x={-l / 2} y={-d / 2} width={l} height={d} fill="#a0743f" />
            <rect x={-l / 2 + f} y={-d / 2 + f} width={l - 2 * f} height={d - 2 * f} fill="#e3d19c" />
            <circle cx={l * 0.12} cy={-d * 0.08} r={d * 0.11} fill="#e53935" />
            <circle cx={l * 0.12} cy={-d * 0.08} r={d * 0.07} fill="#b71c1c" />
            <rect x={-l * 0.25} y={d * 0.05} width={l * 0.18} height={d * 0.05} rx={d * 0.02} fill="#1e88e5" />
          </>
        );
      }),
  },
  swing: {
    label: 'Swing',
    group: 'play',
    around: 'meadow',
    thing: (b) =>
      along(inset(b, 0.06), (l, d) => (
        <>
          <rect x={-l * 0.45 + d * 0.04} y={-d * 0.04 + d * 0.05} width={l * 0.9} height={d * 0.08} fill="#000" opacity={0.2} />
          {[-1, 1].map((s) => (
            <rect key={s} x={s * l * 0.42 - l * 0.025} y={-d * 0.45} width={l * 0.05} height={d * 0.9} fill="#7a5c35" />
          ))}
          <rect x={-l * 0.45} y={-d * 0.04} width={l * 0.9} height={d * 0.08} fill="#8d6e3f" />
          {[-1, 1].map((s) => (
            <rect key={s} x={s * l * 0.16 - l * 0.06} y={-d * 0.07} width={l * 0.12} height={d * 0.14} rx={d * 0.02} fill="#37474f" />
          ))}
        </>
      )),
  },
  goal: {
    label: 'Goal',
    group: 'play',
    around: 'meadow',
    thing: (b) =>
      along(inset(b, 0.06), (l, d) => (
        <>
          <rect x={-l * 0.42} y={-d * 0.35} width={l * 0.84} height={d * 0.55} fill="#fff" opacity={0.18} />
          {Array.from({length: 7}, (_, i) => (
            <rect key={i} x={-l * 0.42 + (l * 0.84 * (i + 1)) / 8} y={-d * 0.35} width={l * 0.008} height={d * 0.55} fill="#fff" opacity={0.5} />
          ))}
          <rect x={-l * 0.42} y={-d * 0.37} width={l * 0.84} height={d * 0.04} fill="#cfd8dc" />
          <rect x={-l * 0.44} y={d * 0.18} width={l * 0.88} height={d * 0.06} fill="#fff" />
        </>
      )),
  },

  // buildings
  house: {label: 'House', group: 'buildings', around: 'paving', thing: (b) => roof(b, '#aeb3bd', '#8d939e')},
  shed: {label: 'Shed', group: 'buildings', around: 'gravel', thing: (b) => roof(inset(b, 0.06), '#8d5a3b', '#6d4430')},
  greenhouse: {
    label: 'Greenhouse',
    group: 'buildings',
    around: 'gravel',
    thing: (b) =>
      along(inset(b, 0.06), (l, d) => (
        <>
          <rect x={-l / 2} y={-d / 2} width={l} height={d} fill="#d7eaf0" opacity={0.92} />
          {Array.from({length: 5}, (_, i) => (
            <rect key={i} x={-l / 2 + (l * (i + 1)) / 6 - 0.5} y={-d / 2} width={1} height={d} fill="#9fb8c2" />
          ))}
          <rect x={-l / 2} y={-0.75} width={l} height={1.5} fill="#7f9ea9" />
          <rect x={-l / 2} y={-d / 2} width={l} height={d} fill="none" stroke="#9fb8c2" strokeWidth={1.5} />
        </>
      )),
  },
  gazebo: {
    label: 'Gazebo',
    group: 'buildings',
    around: 'paving',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      const s = r * 0.88;
      const [l, t, rt, bt] = [cx - s, cy - s, cx + s, cy + s];
      return (
        <>
          <rect x={l + s * 0.08} y={t + s * 0.1} width={2 * s} height={2 * s} fill="#000" opacity={0.2} />
          <polygon points={`${l},${t} ${rt},${t} ${cx},${cy}`} fill="#f2efe8" />
          <polygon points={`${rt},${t} ${rt},${bt} ${cx},${cy}`} fill="#e3ddd0" />
          <polygon points={`${rt},${bt} ${l},${bt} ${cx},${cy}`} fill="#f2efe8" />
          <polygon points={`${l},${bt} ${l},${t} ${cx},${cy}`} fill="#e3ddd0" />
          <circle cx={cx} cy={cy} r={r * 0.07} fill="#8d6e3f" />
        </>
      );
    },
  },
  kennel: {
    label: 'Hutch',
    group: 'buildings',
    around: 'meadow',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {roof({x: cx - r * 0.7, y: cy - r * 0.5, w: r * 1.4, h: r}, '#b5533c', '#8f3f2c')}
          <circle cx={cx + r * 0.55} cy={cy + r * 0.72} r={r * 0.14} fill="#90a4ae" />
          <circle cx={cx + r * 0.55} cy={cy + r * 0.72} r={r * 0.09} fill="#5d4030" />
        </>
      );
    },
  },
  car: {
    label: 'Car',
    group: 'buildings',
    around: 'paving',
    thing: (b) =>
      along(b, (l, d) => {
        const len = Math.min(l * 0.9, d * 0.9 * 2.2);
        const wid = len / 2.2;
        return (
          <>
            <rect x={-len / 2 + wid * 0.06} y={-wid / 2 + wid * 0.08} width={len} height={wid} rx={wid * 0.25} fill="#000" opacity={0.22} />
            <rect x={-len / 2} y={-wid / 2} width={len} height={wid} rx={wid * 0.25} fill="#5677a8" />
            <rect x={-len * 0.12} y={-wid * 0.38} width={len * 0.36} height={wid * 0.76} rx={wid * 0.12} fill="#6f8fbf" />
            <rect x={len * 0.24} y={-wid * 0.38} width={len * 0.1} height={wid * 0.76} rx={wid * 0.05} fill="#2b3440" />
            <rect x={-len * 0.24} y={-wid * 0.36} width={len * 0.08} height={wid * 0.72} rx={wid * 0.04} fill="#2b3440" />
            {[-1, 1].map((s) => (
              <rect key={s} x={len * 0.18} y={s * wid * 0.5 - wid * 0.05} width={len * 0.05} height={wid * 0.1} fill="#3f5a85" />
            ))}
          </>
        );
      }),
  },

  // sitting and fire
  furniture: {
    label: 'Seating',
    group: 'outdoor',
    around: 'paving',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      const c = r * 0.26;
      return (
        <>
          {[0, 1, 2, 3].map((i) => {
            const a = (i * Math.PI) / 2;
            const [x, y] = [cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62];
            return <rect key={i} x={x - c / 2} y={y - c / 2} width={c} height={c} rx={c * 0.25} fill="#eceff1" />;
          })}
          {shadow(cx, cy, r * 0.38)}
          <circle cx={cx} cy={cy} r={r * 0.38} fill="#a0743f" />
          <circle cx={cx} cy={cy} r={r * 0.3} fill="#b4874e" />
        </>
      );
    },
  },
  table: {
    label: 'Table',
    group: 'outdoor',
    around: 'paving',
    thing: (b) =>
      along(inset(b, 0.06), (l, d) => {
        const [tl, td] = [l * 0.62, d * 0.42];
        const c = Math.min(tl / 4, d * 0.2);
        return (
          <>
            {[-1, 0, 1].flatMap((i) =>
              [-1, 1].map((s) => (
                <rect key={`${i}${s}`} x={i * tl * 0.33 - c / 2} y={s * (td / 2 + c * 0.75) - c / 2} width={c} height={c} rx={c * 0.25} fill="#eceff1" />
              )),
            )}
            <rect x={-tl / 2 + td * 0.06} y={-td / 2 + td * 0.08} width={tl} height={td} rx={td * 0.08} fill="#000" opacity={0.2} />
            <rect x={-tl / 2} y={-td / 2} width={tl} height={td} rx={td * 0.08} fill="#a0743f" />
            {[1, 2, 3].map((k) => (
              <rect key={k} x={-tl / 2} y={-td / 2 + (td * k) / 4 - td * 0.01} width={tl} height={td * 0.02} fill="#86602f" />
            ))}
          </>
        );
      }),
  },
  bench: {
    label: 'Bench',
    group: 'outdoor',
    around: 'meadow',
    thing: (b) =>
      along(inset(b, 0.1), (l, d) => {
        const [bl, bd] = [l * 0.9, Math.min(d * 0.5, l * 0.27)];
        return (
          <>
            <rect x={-bl / 2 + bd * 0.08} y={-bd / 2 + bd * 0.12} width={bl} height={bd} fill="#000" opacity={0.2} />
            <rect x={-bl / 2} y={-bd / 2} width={bl} height={bd} rx={bd * 0.06} fill="#a0743f" />
            {[1, 2].map((k) => (
              <rect key={k} x={-bl / 2} y={-bd / 2 + (bd * k) / 3 - bd * 0.02} width={bl} height={bd * 0.04} fill="#86602f" />
            ))}
            <rect x={-bl / 2} y={-bd / 2} width={bl} height={bd * 0.22} fill="#7d5a30" />
            {[-1, 1].map((s) => (
              <rect key={s} x={s * bl * 0.47 - bl * 0.03} y={-bd / 2} width={bl * 0.06} height={bd} fill="#6d4c41" />
            ))}
          </>
        );
      }),
  },
  lounger: {
    label: 'Sun lounger',
    group: 'outdoor',
    around: 'paving',
    thing: (b) =>
      along(inset(b, 0.08), (l, d) => {
        const [ll, ld] = [Math.min(l * 0.9, d * 2.6), Math.min(l * 0.9, d * 2.6) / 2.6];
        return (
          <>
            <rect x={-ll / 2 + ld * 0.06} y={-ld / 2 + ld * 0.1} width={ll} height={ld} rx={ld * 0.12} fill="#000" opacity={0.2} />
            <rect x={-ll / 2} y={-ld / 2} width={ll} height={ld} rx={ld * 0.12} fill="#eceff1" />
            <rect x={-ll / 2 + ld * 0.08} y={-ld / 2 + ld * 0.1} width={ll - ld * 0.16} height={ld * 0.8} rx={ld * 0.1} fill="#4fc3f7" />
            <rect x={ll / 2 - ld * 0.62} y={-ld / 2 + ld * 0.1} width={ld * 0.54} height={ld * 0.8} rx={ld * 0.1} fill="#29b6f6" />
            <rect x={-ll * 0.1} y={-ld / 2 + ld * 0.1} width={ll * 0.12} height={ld * 0.8} fill="#fff" opacity={0.55} />
          </>
        );
      }),
  },
  lounge: {
    label: 'Lounge sofa',
    group: 'outdoor',
    around: 'wood',
    thing: (b) =>
      along(inset(b, 0.06), (l, d) => {
        const t = Math.min(l, d) * 0.24;
        const [x0, y0] = [-l / 2, -d / 2];
        return (
          <>
            <rect x={x0 + t * 0.15} y={y0 + t * 0.2} width={l} height={t} fill="#000" opacity={0.18} />
            <rect x={x0} y={y0} width={l} height={t} rx={t * 0.2} fill="#78909c" />
            <rect x={x0} y={y0} width={t} height={d} rx={t * 0.2} fill="#78909c" />
            {[0.3, 0.55, 0.8].map((f) => (
              <rect key={f} x={x0 + l * f - t * 0.4} y={y0 + t * 0.12} width={t * 0.8} height={t * 0.76} rx={t * 0.12} fill="#b0bec5" />
            ))}
            {[0.45, 0.75].map((f) => (
              <rect key={f} x={x0 + t * 0.12} y={y0 + d * f - t * 0.4} width={t * 0.76} height={t * 0.8} rx={t * 0.12} fill="#b0bec5" />
            ))}
            <rect x={x0 + t * 0.2} y={y0 + t * 0.2} width={t * 0.6} height={t * 0.6} rx={t * 0.15} fill="#ffb74d" />
            <rect x={x0 + l * 0.42} y={y0 + d * 0.5} width={l * 0.3} height={d * 0.28} rx={t * 0.1} fill="#a0743f" />
          </>
        );
      }),
  },
  grill: {
    label: 'Barbecue',
    group: 'outdoor',
    around: 'paving',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      const g = r * 0.6;
      return (
        <>
          {shadow(cx, cy, g)}
          <circle cx={cx} cy={cy} r={g} fill="#263238" />
          <circle cx={cx} cy={cy} r={g * 0.8} fill="#37474f" />
          <circle cx={cx - g * 0.25} cy={cy - g * 0.25} r={g * 0.3} fill="#546e7a" opacity={0.6} />
          <rect x={cx - g * 0.3} y={cy - g * 0.05} width={g * 0.6} height={g * 0.1} rx={g * 0.05} fill="#8d6e3f" />
          <rect x={cx + g * 0.9} y={cy - g * 0.08} width={g * 0.35} height={g * 0.16} fill="#455a64" />
        </>
      );
    },
  },
  hammock: {
    label: 'Hammock',
    group: 'outdoor',
    around: 'meadow',
    thing: (b) =>
      along(inset(b, 0.06), (l, d) => {
        const p = Math.min(l, d) * 0.12;
        return (
          <>
            {[-1, 1].map((s) => (
              <rect key={s} x={s * (l / 2 - p) - p / 2} y={-p / 2} width={p} height={p} fill="#6d4c41" />
            ))}
            <rect x={-l / 2 + p} y={-p * 0.08} width={l - 2 * p} height={p * 0.16} fill="#bcaaa4" />
            <ellipse cx={0} cy={0} rx={l * 0.32} ry={Math.min(d * 0.3, l * 0.12)} fill="#ffb74d" />
            {[-0.16, 0, 0.16].map((f) => (
              <rect key={f} x={l * f - l * 0.02} y={-Math.min(d * 0.3, l * 0.12)} width={l * 0.04} height={2 * Math.min(d * 0.3, l * 0.12)} fill="#e65100" opacity={0.35} />
            ))}
          </>
        );
      }),
  },
  umbrella: {
    label: 'Parasol',
    group: 'outdoor',
    around: 'paving',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      const pts = Array.from({length: 8}, (_, i) => [cx + Math.cos((i * Math.PI) / 4) * r * 0.9, cy + Math.sin((i * Math.PI) / 4) * r * 0.9]);
      return (
        <>
          {shadow(cx, cy, r * 0.88)}
          {pts.map(([x, y], i) => {
            const [nx, ny] = pts[(i + 1) % 8];
            return <polygon key={i} points={`${cx},${cy} ${x},${y} ${nx},${ny}`} fill={i % 2 ? '#fafafa' : '#e53935'} />;
          })}
          <circle cx={cx} cy={cy} r={r * 0.07} fill="#6d4c41" />
        </>
      );
    },
  },
  firePit: {
    label: 'Fire pit',
    group: 'outdoor',
    around: 'gravel',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          <circle cx={cx} cy={cy} r={r * 0.85} fill="#8a8580" />
          {Array.from({length: 10}, (_, i) => {
            const a = (i * Math.PI) / 5;
            return <circle key={i} cx={cx + Math.cos(a) * r * 0.72} cy={cy + Math.sin(a) * r * 0.72} r={r * 0.11} fill="#6f6a65" />;
          })}
          <circle cx={cx} cy={cy} r={r * 0.56} fill="#3b3633" />
          <circle cx={cx} cy={cy} r={r * 0.34} fill="#ff7043" opacity={0.35} />
          <circle cx={cx - r * 0.1} cy={cy + r * 0.05} r={r * 0.1} fill="#ff7043" />
          <circle cx={cx + r * 0.12} cy={cy - r * 0.08} r={r * 0.08} fill="#ffb300" />
          <circle cx={cx + r * 0.02} cy={cy + r * 0.16} r={r * 0.06} fill="#ffca28" />
        </>
      );
    },
  },

  // other
  clothesDryer: {
    label: 'Rotary dryer',
    group: 'other',
    around: 'meadow',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {[0.32, 0.56, 0.8].map((f) => (
            <rect key={f} x={cx - r * f} y={cy - r * f} width={2 * r * f} height={2 * r * f} fill="none" stroke="#eceff1" strokeWidth={1} />
          ))}
          {[45, 135].map((deg) => (
            <rect key={deg} x={cx - r * 1.1} y={cy - r * 0.025} width={r * 2.2} height={r * 0.05} fill="#b0bec5" transform={`rotate(${deg} ${cx} ${cy})`} />
          ))}
          <circle cx={cx} cy={cy} r={r * 0.07} fill="#78909c" />
        </>
      );
    },
  },
  compost: {
    label: 'Compost',
    group: 'other',
    around: 'soil',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      const s = r * 0.85;
      return (
        <>
          <rect x={cx - s} y={cy - s} width={2 * s} height={2 * s} fill="#8d6e3f" />
          {[1, 2, 3, 4].map((i) => (
            <rect key={i} x={cx - s} y={cy - s + (2 * s * i) / 5} width={2 * s} height={s * 0.04} fill="#6d5230" />
          ))}
          <rect x={cx - s * 0.78} y={cy - s * 0.78} width={s * 1.56} height={s * 1.56} fill="#4a3528" />
          {(
            [
              [-0.4, -0.3, '#6a8f3a'],
              [0.3, -0.45, '#e07b39'],
              [0.1, 0.3, '#6a8f3a'],
              [-0.35, 0.45, '#8bc34a'],
              [0.45, 0.2, '#e07b39'],
            ] as const
          ).map(([dx, dy, c], i) => (
            <circle key={i} cx={cx + dx * s} cy={cy + dy * s} r={s * 0.09} fill={c} />
          ))}
        </>
      );
    },
  },
  bins: {
    label: 'Bins',
    group: 'other',
    around: 'paving',
    thing: (b) =>
      along(inset(b, 0.06), (l, d) => {
        const n = 4;
        const w = Math.min(l / (n + 0.6), d * 0.8);
        const colors = ['#616161', '#1e88e5', '#6d4c41', '#fdd835'];
        return colors.map((c, i) => {
          const x = -((n - 1) / 2) * (w * 1.15) + i * w * 1.15;
          return (
            <g key={c}>
              <rect x={x - w / 2 + w * 0.06} y={-w / 2 + w * 0.08} width={w} height={w} rx={w * 0.12} fill="#000" opacity={0.2} />
              <rect x={x - w / 2} y={-w / 2} width={w} height={w} rx={w * 0.12} fill={c} />
              <rect x={x - w / 2} y={-w / 2 + w * 0.18} width={w} height={w * 0.05} fill="#000" opacity={0.25} />
            </g>
          );
        });
      }),
  },
  rocks: {
    label: 'Rocks',
    group: 'other',
    around: 'meadow',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      return (
        <>
          {shadow(cx, cy, r * 0.85, r * 0.7)}
          <ellipse cx={cx - r * 0.25} cy={cy - r * 0.1} rx={r * 0.48} ry={r * 0.38} fill="#9e9e9e" />
          <ellipse cx={cx + r * 0.32} cy={cy + r * 0.25} rx={r * 0.38} ry={r * 0.3} fill="#8d8d8d" />
          <ellipse cx={cx - r * 0.35} cy={cy - r * 0.22} rx={r * 0.2} ry={r * 0.12} fill="#bdbdbd" />
          <ellipse cx={cx + r * 0.25} cy={cy + r * 0.16} rx={r * 0.14} ry={r * 0.08} fill="#acacac" />
        </>
      );
    },
  },
  gnome: {
    label: 'Garden gnome',
    group: 'other',
    around: 'meadow',
    thing: (b) => {
      const {cx, cy, r} = middle(b);
      const s = r * 0.55;
      return (
        <>
          {shadow(cx, cy, s * 0.8)}
          <ellipse cx={cx} cy={cy + s * 0.35} rx={s * 0.55} ry={s * 0.35} fill="#1565c0" />
          <ellipse cx={cx} cy={cy + s * 0.12} rx={s * 0.5} ry={s * 0.3} fill="#fafafa" />
          <circle cx={cx} cy={cy - s * 0.15} r={s * 0.5} fill="#e53935" />
          <circle cx={cx - s * 0.15} cy={cy - s * 0.3} r={s * 0.16} fill="#ff8a80" />
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
      base: '#aeb3bd',
      draw: (m) => (
        <>
          <rect y={0.48 * m} width={m} height={0.03 * m} fill="#9aa0ab" />
          <rect y={0.97 * m} width={m} height={0.03 * m} fill="#9aa0ab" />
          <rect x={0.48 * m} width={0.03 * m} height={0.5 * m} fill="#9aa0ab" />
          <rect x={0.97 * m} y={0.5 * m} width={0.03 * m} height={0.5 * m} fill="#9aa0ab" />
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
      base: '#d9cfc2',
      draw: (m) => (
        <>
          <rect x={0.01 * m} y={0.01 * m} width={0.22 * m} height={0.08 * m} fill="#b5533c" />
          <rect x={0.25 * m} y={0.01 * m} width={0.22 * m} height={0.08 * m} fill="#a84a35" />
          <rect x={-0.11 * m} y={0.11 * m} width={0.22 * m} height={0.08 * m} fill="#a84a35" />
          <rect x={0.13 * m} y={0.11 * m} width={0.22 * m} height={0.08 * m} fill="#b5533c" />
          <rect x={0.37 * m} y={0.11 * m} width={0.22 * m} height={0.08 * m} fill="#a84a35" />
        </>
      ),
    },
  },
  concrete: {
    label: 'Concrete',
    group: 'ground',
    tile: {
      w: 0.8,
      h: 0.8,
      base: '#b9b9b4',
      draw: (m) =>
        dots(m, [
          [0.12, 0.2, 0.012, '#a3a39d'],
          [0.5, 0.1, 0.01, '#cacac5'],
          [0.3, 0.55, 0.012, '#a3a39d'],
          [0.68, 0.48, 0.01, '#cacac5'],
          [0.6, 0.72, 0.012, '#a3a39d'],
        ]),
    },
  },
  wood: {
    label: 'Decking',
    group: 'ground',
    tile: {
      w: 1.2,
      h: 0.3,
      base: '#a0743f',
      draw: (m) => (
        <>
          <rect y={0.135 * m} width={1.2 * m} height={0.015 * m} fill="#7d5a30" />
          <rect y={0.285 * m} width={1.2 * m} height={0.015 * m} fill="#7d5a30" />
          <rect x={0.3 * m} width={0.015 * m} height={0.135 * m} fill="#7d5a30" />
          <rect x={0.9 * m} y={0.15 * m} width={0.015 * m} height={0.135 * m} fill="#7d5a30" />
        </>
      ),
    },
  },
  gravel: {
    label: 'Gravel',
    group: 'ground',
    tile: {
      w: 0.5,
      h: 0.5,
      base: '#b8b0a1',
      draw: (m) =>
        dots(m, [
          [0.1, 0.12, 0.035, '#a59c8c'],
          [0.33, 0.08, 0.025, '#cfc8ba'],
          [0.22, 0.32, 0.03, '#a59c8c'],
          [0.42, 0.4, 0.028, '#cfc8ba'],
        ]),
    },
  },
  sand: {
    label: 'Sand',
    group: 'ground',
    tile: {
      w: 0.4,
      h: 0.4,
      base: '#e3d19c',
      draw: (m) =>
        dots(m, [
          [0.08, 0.1, 0.015, '#c9b47f'],
          [0.28, 0.18, 0.012, '#f2e6be'],
          [0.16, 0.32, 0.014, '#c9b47f'],
          [0.34, 0.36, 0.01, '#f2e6be'],
        ]),
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
        (
          [
            [0.1, 0.1, 20, '#8a6142'],
            [0.32, 0.14, 120, '#4f3524'],
            [0.2, 0.3, 70, '#8a6142'],
            [0.42, 0.36, 160, '#4f3524'],
            [0.08, 0.42, 100, '#7a5438'],
          ] as const
        ).map(([x, y, deg, c], i) => (
          <ellipse key={i} cx={x * m} cy={y * m} rx={0.06 * m} ry={0.018 * m} fill={c} transform={`rotate(${deg} ${x * m} ${y * m})`} />
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
      draw: (m) =>
        dots(m, [
          [0.1, 0.14, 0.02, '#5a3e2c'],
          [0.36, 0.08, 0.015, '#7d5a40'],
          [0.24, 0.34, 0.02, '#5a3e2c'],
          [0.44, 0.42, 0.015, '#7d5a40'],
        ]),
    },
  },
  wall: {
    label: 'Wall',
    group: 'ground',
    tile: {
      w: 0.6,
      h: 0.3,
      base: '#cfc6b8',
      draw: (m) => (
        <>
          <rect x={0.01 * m} y={0.01 * m} width={0.28 * m} height={0.13 * m} fill="#9e9488" />
          <rect x={0.31 * m} y={0.01 * m} width={0.28 * m} height={0.13 * m} fill="#8f857a" />
          <rect x={-0.14 * m} y={0.16 * m} width={0.28 * m} height={0.13 * m} fill="#8f857a" />
          <rect x={0.16 * m} y={0.16 * m} width={0.28 * m} height={0.13 * m} fill="#9e9488" />
          <rect x={0.46 * m} y={0.16 * m} width={0.28 * m} height={0.13 * m} fill="#8f857a" />
        </>
      ),
    },
  },
};

export const PICTURE_KEYS = Object.keys(PICTURES);

// from the name, the first that fits, the more particular ones first (a garden house before a house, a wall before a
// house: the keep-out strip along one)
export const BY_NAME: [string, RegExp][] = [
  ['raisedBed', /hochbeet|raised/i],
  ['vegetables', /gemüse|vegetable|kräuter|herb|salat|tomate/i],
  ['flowerMeadow', /blumenwiese|wildblume|wildflower|insekt|bienenweide/i],
  ['rockGarden', /steingarten|steinbeet|rock ?garden/i],
  ['fruitTree', /obst|apfel|birne|kirsch|pflaume|zwetsch|fruit|apple|cherry|pear|plum/i],
  ['conifer', /tanne|fichte|kiefer|nadel|conifer|pine|\bfir\b|spruce|thuja|lebensbaum/i],
  ['palm', /palme|palm/i],
  ['tree', /baum|bäume|tree|linde|eiche|ahorn|birke|buche|walnuss|kastanie/i],
  ['hedge', /hecke|hedge|wald|forest/i],
  ['bush', /busch|büsche|bush|strauch|sträucher|shrub|rose|hortensie|flieder/i],
  ['pot', /kübel|topf|\bpots?\b|planter|amphore/i],
  ['roundPool', /rundpool|planschbecken|paddling|aufstellpool|frame ?pool/i],
  ['pool', /pool|schwimm|swim/i],
  ['fountain', /brunnen|fountain|vogeltränke|birdbath/i],
  ['rainBarrel', /regentonne|regenfass|wasserfass|barrel|zisterne/i],
  ['pond', /teich|pond|biotop|tümpel|\bsee\b|lake|bach|wasser|water/i],
  ['trampoline', /trampolin/i],
  ['sandbox', /sandkasten|sandkiste|sandbox|sandpit/i],
  ['swing', /schaukel|swing|spielturm|kletter|spielplatz|playground|rutsche|slide/i],
  ['goal', /fußballtor|fussballtor|\btor\b|goal|fußball|fussball|football|soccer/i],
  ['greenhouse', /gewächshaus|greenhouse|frühbeet|treibhaus/i],
  ['gazebo', /pavillon|gazebo|pergola/i],
  ['kennel', /hund|dog|hühner|chicken|kaninchen|hase|rabbit|stall|coop|voliere/i],
  ['car', /carport|\bauto\b|\bcar\b|stellplatz|parkplatz|parking/i],
  ['shed', /gartenhaus|schuppen|shed|hütte|laube|geräte/i],
  ['wall', /mauer|wall|wand|zaun|fence/i],
  ['house', /haus|house|dach|roof|garage|anbau/i],
  ['grill', /grill|bbq|barbecue/i],
  ['firePit', /feuer|fire/i],
  ['umbrella', /schirm|umbrella|parasol/i],
  ['hammock', /hängematte|hammock/i],
  ['lounger', /liege|lounger/i],
  ['lounge', /lounge|sofa|couch/i],
  ['furniture', /sitzgruppe|sitzecke|stuhl|stühle|chair|möbel|furniture|seating/i],
  ['table', /tisch|table/i],
  ['bench', /bank|bench/i],
  ['clothesDryer', /wäsche|laundry|clothes/i],
  ['compost', /kompost|compost/i],
  ['bins', /müll|tonne|\bbins?\b|trash|abfall|container/i],
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
