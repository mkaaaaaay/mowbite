// Map symbols to pick from in the settings. Mower icons face +x and span about -1..1, the caller
// scales and rotates them. A side view (side: true) has the ground at +y, the caller mirrors it when the
// mower heads left so it stays upright. A figure (upright: true) isn't turned at all, only faces left or right.
// A real mower from above (fit: its width over its length) fills -1..1 both ways from its back to its front: with the
// mower's sizes set the map stretches it onto the body exactly, otherwise it's drawn that much narrower.
// Dock icons are drawn upright in the same unit box.
import {useId} from 'react';
import {OPENMOWER_EDGE, OPENMOWER_PATHS} from './openmowerArt';

const mouth = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  const x = Math.cos(a).toFixed(3);
  const y = Math.sin(a).toFixed(3);
  return `M0,0 L${x},${y} A1,1 0 1,1 ${x},${-y} Z`;
};

// strokes in the icon's own units, the map and the settings draw lines non-scaling
const SCALING = {vectorEffect: 'none'} as const;

// a leg from the hip at 0,0, black trousers and a brown shoe unless told otherwise, swinging while the mower drives,
// one step cycle per half metre
export const stepDur = (speed: number) => Math.min(2, Math.max(0.4, 0.5 / speed));
export const leg = (from: number, speed: number, trousers = '#141414', shoe = '#5d4037') => (
  <g transform={`rotate(${from / 4})`}>
    {speed > 0.08 && (
      <animateTransform
        attributeName="transform"
        type="rotate"
        values={`${from};${-from};${from}`}
        dur={`${stepDur(speed).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    )}
    <path d="M-0.065,0 L0.065,0 L0.07,0.64 L-0.07,0.64 Z" fill={trousers} />
    <path d="M-0.075,0.62 L0.1,0.63 Q0.21,0.65 0.2,0.76 L-0.075,0.76 Z" fill={shoe} />
  </g>
);

// a wheel of the push mower with a cross in it, rolling along as fast as the mower goes
const pushWheel = (cx: number, cy: number, r: number, speed: number) => (
  <g>
    <circle cx={cx} cy={cy} r={r} fill="#212121" />
    <g>
      {speed > 0.05 && (
        <animateTransform
          attributeName="transform"
          type="rotate"
          values={`0 ${cx} ${cy};360 ${cx} ${cy}`}
          dur={`${Math.min(3, Math.max(0.3, 0.4 / speed)).toFixed(1)}s`}
          repeatCount="indefinite"
        />
      )}
      <path
        d={`M${cx - r * 0.8},${cy} L${cx + r * 0.8},${cy} M${cx},${cy - r * 0.8} L${cx},${cy + r * 0.8}`}
        stroke="#757575"
        strokeWidth={0.035}
        style={SCALING}
      />
    </g>
    <circle cx={cx} cy={cy} r={r * 0.42} fill="#9e9e9e" />
  </g>
);

// a cordless push mower: grass box, rounded hood with the battery on top, big rear wheels. the handle ends at about
// -0.08,-0.2, the deck runs from 0.28 to 1.04, the wheels stand on 0.88
export const pushMower = (speed: number, hood = 'var(--c-mower)') => (
  <>
    <path d="M0.1,0.2 L0.34,0.24 L0.36,0.52 L0.14,0.52 Q0.08,0.36 0.1,0.2 Z" fill="#546e7a" />
    <path d="M0.14,0.3 L0.33,0.32 M0.13,0.4 L0.34,0.42" stroke="#78909c" strokeWidth={0.03} style={SCALING} />
    <path d="M-0.12,-0.14 L-0.02,-0.18 Q0.16,0.1 0.42,0.4 L0.34,0.44 Q0.06,0.14 -0.12,-0.14 Z" fill="#37474f" />
    <path d="M-0.16,-0.2 L0.0,-0.24 L0.02,-0.16 L-0.14,-0.12 Z" fill="#212121" />
    <path
      d="M0.3,0.62 L0.3,0.44 Q0.36,0.28 0.62,0.27 Q0.92,0.27 1.0,0.46 L1.02,0.62 Z"
      fill={hood}
      stroke="#fff"
      strokeWidth={0.05}
      style={SCALING}
    />
    <path d="M0.4,0.42 Q0.62,0.34 0.94,0.46" stroke="#fff" strokeOpacity={0.5} strokeWidth={0.04} fill="none" style={SCALING} />
    <rect x={0.52} y={0.2} width={0.22} height={0.09} rx={0.03} fill="#212121" />
    <circle cx={0.69} cy={0.245} r={0.018} fill="#76ff03" />
    <rect x={0.28} y={0.58} width={0.76} height={0.08} rx={0.03} fill="#263238" />
    {pushWheel(0.38, 0.72, 0.16, speed)}
    {pushWheel(0.92, 0.75, 0.12, speed)}
  </>
);

// cut grass flying from under the deck into the grass box while the blade runs
const BOX_CLIPPINGS = [
  {c: '#7cb342', d: 0},
  {c: '#9ccc65', d: 0.2},
  {c: '#558b2f', d: 0.4},
  {c: '#aed581', d: 0.6},
].map((g, i) => (
  <circle key={`b${i}`} cx={0.62} cy={0.58} r={0.035} fill={g.c} opacity={0}>
    <animate attributeName="cx" values="0.62;0.42;0.24" dur="0.8s" begin={`${g.d}s`} repeatCount="indefinite" />
    <animate attributeName="cy" values="0.58;0.12;0.3" dur="0.8s" begin={`${g.d}s`} repeatCount="indefinite" />
    <animate attributeName="opacity" values="0;1;0" dur="0.8s" begin={`${g.d}s`} repeatCount="indefinite" />
  </circle>
));

// speed in m/s, for icons that move along with the mower, emergency while the emergency stop is active
type MowerIcon = {
  key: string;
  label: string;
  side?: boolean;
  upright?: boolean;
  fit?: number;
  // blades: the blade is running, as far as the mower tells (position/json)
  draw: (o?: {speed?: number; emergency?: boolean; blades?: boolean}) => React.ReactNode;
};

// the wheel of the openmower logo is its second part, turning around its middle while the mower drives. the
// other parts are passed through as they are
const OPENMOWER_WHEEL = '416.751 153.017';
const wheel = (part: number, speed: number, el: React.ReactElement, key: string) =>
  part === 1 && speed > 0.05 ? (
    <g key={key}>
      <animateTransform
        attributeName="transform"
        type="rotate"
        values={`0 ${OPENMOWER_WHEEL};-360 ${OPENMOWER_WHEEL}`}
        dur={`${Math.min(3, Math.max(0.4, 0.5 / speed)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
      {el}
    </g>
  ) : (
    <g key={key}>{el}</g>
  );

// bits of grass flying up behind the openmower while the blade runs, each on its own beat
const CLIPPINGS = [
  {x: 300, c: '#7cb342', d: 0},
  {x: 250, c: '#9ccc65', d: 0.25},
  {x: 330, c: '#558b2f', d: 0.5},
  {x: 280, c: '#aed581', d: 0.75},
].map((g, i) => (
  <circle key={`g${i}`} cx={g.x} cy={250} r={11} fill={g.c} opacity={0}>
    <animate attributeName="cx" values={`${g.x};${g.x + 150}`} dur="1s" begin={`${g.d}s`} repeatCount="indefinite" />
    <animate attributeName="cy" values="250;150;215" dur="1s" begin={`${g.d}s`} repeatCount="indefinite" />
    <animate attributeName="opacity" values="0;1;0" dur="1s" begin={`${g.d}s`} repeatCount="indefinite" />
  </circle>
));

// the yard force models OpenMower is built into, from above with their colours. Lines stay thin at any size
const BLACK = '#262626';
const ORANGE = '#f57c00';
const WHEEL = '#9e9e9e';
const SILVER = '#cfd8dc';
const STOP = '#e53935';
const line = {stroke: '#000', strokeWidth: 0.75, strokeOpacity: 0.6} as const;

// the red stop button, blinking on an emergency stop
const stopButton = (x: number, w: number, h: number, emergency: boolean) => (
  <rect x={x} y={-h / 2} width={w} height={h} rx={0.05} fill={STOP} {...line}>
    {emergency && <animate attributeName="fill" values={`${STOP};#fff;${STOP}`} dur="0.8s" repeatCount="indefinite" />}
  </rect>
);

const rearWheels = (x: number, len: number, inner: number) => (
  <>
    <rect x={x} y={-1} width={len} height={1 - inner} rx={0.04} fill={WHEEL} {...line} />
    <rect x={x} y={inner} width={len} height={1 - inner} rx={0.04} fill={WHEEL} {...line} />
  </>
);

const soft = {stroke: '#000', strokeWidth: 0.6, strokeOpacity: 0.25} as const;
const stopText = {
  fill: '#fff',
  fontFamily: 'Arial Black, Arial, Helvetica, sans-serif',
  fontWeight: 900,
  textAnchor: 'middle',
} as const;

type Pt = readonly [number, number];

// a closed outline through the points, curving between them (Catmull-Rom as Béziers), sharp at the corners given
function outline(pts: readonly Pt[], corners: readonly number[] = []): string {
  const n = pts.length;
  const at = (i: number) => pts[(i + n) % n];
  const f = (v: number) => +v.toFixed(3);
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const [a, b, c, e] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const from = corners.includes(i);
    const to = corners.includes((i + 1) % n);
    if (from && to) {
      d += `L${f(c[0])},${f(c[1])}`;
      continue;
    }
    const c1 = from ? b : [b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6];
    const c2 = to ? c : [c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6];
    d += `C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(c[0])},${f(c[1])}`;
  }
  return d + 'Z';
}

// a symmetric outline from its left half, both ends of it on the middle line
function both(half: readonly Pt[], corners: readonly number[] = []): string {
  const n = half.length;
  const right = half.slice(1, -1).reverse().map(([x, y]): Pt => [x, -y]);
  return outline([...half, ...right], [...corners, ...corners.filter((i) => i > 0 && i < n - 1).map((i) => 2 * n - 2 - i)]);
}

// gradients need ids of their own on the page, one inside a hidden svg would paint nothing
function Shaded({draw}: {draw: (id: string) => React.ReactNode}) {
  return draw(useId());
}

// the left and the right one of a part drawn for the left
const SIDES = [1, -1];

// a Classic 500B, traced from a photo from straight above. Symmetric parts as their left half from the front round to
// the back, both() adds the right one
const C500 = {
  base: both(
    [
      [1, 0], [0.996, -0.214], [0.982, -0.397], [0.966, -0.506], [0.958, -0.53], [0.916, -0.533], [0.904, -0.625],
      [0.884, -0.717], [0.857, -0.781], [0.826, -0.824], [0.789, -0.849], [0.742, -0.86], [0.62, -0.872],
      [0.485, -0.886], [0.282, -0.909], [0.147, -0.934], [0.011, -0.956], [-0.09, -0.971], [-0.191, -0.982],
      [-0.293, -0.991], [-0.394, -0.996], [-0.462, -0.995], [-0.523, -0.989], [-0.527, -0.941], [-0.529, -0.695],
      [-0.935, -0.695], [-0.982, -0.658], [-0.996, -0.585], [-0.999, 0],
    ],
    [4, 5, 22, 23, 24, 28],
  ),
  bumper: both(
    [
      [0.991, 0], [0.986, -0.214], [0.973, -0.397], [0.958, -0.501], [0.95, -0.512], [0.924, -0.512], [0.932, -0.384],
      [0.942, -0.214], [0.945, 0],
    ],
    [3, 4, 5],
  ),
  shell: both(
    [
      [0.943, 0], [0.941, -0.137], [0.935, -0.229], [0.931, -0.269], [0.918, -0.375], [0.904, -0.463], [0.89, -0.527],
      [0.877, -0.584], [0.863, -0.637], [0.85, -0.676], [0.836, -0.705], [0.823, -0.724], [0.796, -0.753],
      [0.755, -0.776], [0.701, -0.788], [0.62, -0.804], [0.539, -0.823], [0.458, -0.839], [0.377, -0.855],
      [0.295, -0.868], [0.214, -0.88], [0.133, -0.892], [0.052, -0.902], [-0.029, -0.912], [-0.11, -0.921],
      [-0.191, -0.93], [-0.272, -0.939], [-0.354, -0.947], [-0.452, -0.622], [-0.489, -0.625], [-0.597, -0.64],
      [-0.8, -0.643], [-0.922, -0.639], [-0.954, -0.618], [-0.974, -0.576], [-0.986, -0.512], [-0.991, -0.43],
      [-0.992, 0],
    ],
    [27, 28],
  ),
  hood: both(
    [
      [0.942, 0], [0.939, -0.399], [0.877, -0.404], [0.782, -0.43], [0.682, -0.469], [0.489, -0.507], [0.295, -0.547],
      [0.147, -0.572], [0.011, -0.587], [-0.124, -0.601], [-0.259, -0.611], [-0.354, -0.614], [-0.452, -0.617],
      [-0.489, -0.618], [-0.597, -0.494], [-0.732, -0.457], [-0.992, -0.452], [-0.992, 0],
    ],
    [11, 12],
  ),
  spine: both(
    [
      [0.89, 0], [0.876, -0.366], [0.654, -0.355], [0.431, -0.322], [0.282, -0.302], [0.228, -0.315], [0.079, -0.343],
      [-0.124, -0.37], [-0.293, -0.393], [-0.496, -0.419], [-0.732, -0.439], [-0.992, -0.446], [-0.992, 0],
    ],
  ),
  window: both(
    [
      [0.88, 0], [0.876, -0.252], [0.823, -0.265], [0.62, -0.274], [0.451, -0.28], [0.436, -0.269], [0.436, 0],
    ],
  ),
  windowIn: both([[0.832, 0], [0.83, -0.216], [0.755, -0.225], [0.62, -0.232], [0.471, -0.239], [0.47, 0]]),
  lip: both([[0.47, 0], [0.471, -0.239], [0.452, -0.274], [0.435, -0.271], [0.435, 0]]),
  plateau: both(
    [
      [0.248, 0], [0.241, -0.274], [0.174, -0.311], [0.011, -0.329], [-0.191, -0.34], [-0.276, -0.347], [-0.276, 0],
    ],
  ),
  fender: outline(
    [
      [-0.285, -0.92], [-0.45, -0.6], [-0.524, -0.598], [-0.436, -0.881], [-0.439, -0.956], [-0.335, -0.956],
    ],
    [0, 1, 2, 3, 4, 5],
  ),
  fenderTop: outline([[-0.285, -0.92], [-0.45, -0.6], [-0.47, -0.6], [-0.308, -0.914]], [0, 1, 2, 3]),
  shine:
    outline(
      [
        [0.939, -0.399], [0.877, -0.404], [0.782, -0.43], [0.682, -0.469], [0.489, -0.507], [0.295, -0.547],
        [0.147, -0.572], [0.011, -0.587], [-0.124, -0.601], [-0.259, -0.611], [-0.354, -0.614], [-0.354, -0.629],
        [-0.259, -0.625], [-0.124, -0.616], [0.011, -0.601], [0.147, -0.587], [0.295, -0.561], [0.489, -0.522],
        [0.682, -0.484], [0.782, -0.444], [0.877, -0.419], [0.939, -0.413],
      ],
      [0, 10, 11, 21],
    ) +
    outline(
      [
        [-0.462, -0.437], [-0.597, -0.442], [-0.8, -0.448], [-0.976, -0.452], [-0.976, -0.472], [-0.8, -0.468],
        [-0.597, -0.463], [-0.462, -0.457],
      ],
      [0, 3, 4, 7],
    ),
  keypad: outline(
    [
      [-0.284, -0.332], [-0.284, 0.334], [-0.298, 0.353], [-0.604, 0.353], [-0.632, 0.334], [-0.632, 0.054],
      [-0.546, -0.083], [-0.546, -0.33], [-0.529, -0.352], [-0.3, -0.352],
    ],
  ),
};

function classic500(id: string, emergency: boolean) {
  return (
    <>
      <defs>
        <linearGradient id={id + 's'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9520b" />
          <stop offset="0.2" stopColor="#f4650f" />
          <stop offset="0.5" stopColor="#ff7016" />
          <stop offset="0.8" stopColor="#f4650f" />
          <stop offset="1" stopColor="#d9520b" />
        </linearGradient>
        <linearGradient id={id + 'h'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f96a12" />
          <stop offset="0.5" stopColor="#ff7d26" />
          <stop offset="1" stopColor="#f96a12" />
        </linearGradient>
        <linearGradient id={id + 'p'} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#ff8a3a" />
          <stop offset="0.55" stopColor="#ff8030" />
          <stop offset="1" stopColor="#ff7a26" />
        </linearGradient>
        <radialGradient id={id + 'k'} cx="0.42" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#4a4f57" />
          <stop offset="1" stopColor="#1f2226" />
        </radialGradient>
        <linearGradient id={id + 'r'} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#f23a52" />
          <stop offset="1" stopColor="#c8132f" />
        </linearGradient>
      </defs>
      {/* the rear wheels with their tread and the rim outside */}
      {SIDES.map((s) => (
        <g key={s} transform={`scale(1 ${s})`}>
          <rect x={-0.945} y={-0.902} width={0.49} height={0.208} rx={0.024} ry={0.033} fill="#232323" {...line} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={-0.579 - i * 0.065} y={-0.856} width={0.03} height={0.141} rx={0.007} ry={0.009} fill="#3d3d3d" />
          ))}
          <rect x={-0.935} y={-0.902} width={0.47} height={0.023} rx={0.008} ry={0.011} fill="#a9abad" />
        </g>
      ))}
      <path d={C500.base} fill="#2a2d32" {...line} />
      <path d={C500.bumper} fill="#474b52" />
      {SIDES.map((s) => (
        <g key={s} transform={`scale(1 ${s})`}>
          <path d={C500.fender} fill="#2e3137" {...line} />
          <path d={C500.fenderTop} fill="#50545b" />
        </g>
      ))}
      <path d={C500.shell} fill={`url(#${id}s)`} {...line} />
      <path d={C500.hood} fill={`url(#${id}h)`} {...soft} />
      <path d={C500.spine} fill={`url(#${id}p)`} {...soft} />
      {SIDES.map((s) => (
        <path key={s} transform={`scale(1 ${s})`} d={C500.shine} fill="#ffb07a" fillOpacity={0.55} />
      ))}
      <path d={C500.window} fill="#ff8d45" {...soft} />
      <path d={C500.windowIn} fill="#ff9752" />
      <path d={C500.lip} fill="#ffc8a2" />
      {/* the height knob on its plateau */}
      <path d={C500.plateau} fill="#ff8a3e" {...soft} />
      <ellipse cx={0.015} cy={0} rx={0.161} ry={0.218} fill="#1b1d20" {...line} />
      {[
        [0.167, 0],
        [0.015, 0.205],
        [-0.137, 0],
        [0.015, -0.205],
      ].map(([cx, cy]) => (
        <ellipse key={`${cx} ${cy}`} cx={cx} cy={cy} rx={0.006} ry={0.008} fill="#f2f2f2" />
      ))}
      <ellipse cx={0.017} cy={0} rx={0.116} ry={0.157} fill={`url(#${id}k)`} />
      <ellipse cx={0.018} cy={0} rx={0.065} ry={0.088} fill="#16181b" />
      <ellipse cx={0.037} cy={-0.024} rx={0.027} ry={0.037} fill="#fff" fillOpacity={0.22} />
      {/* the keypad */}
      <path d={C500.keypad} fill="#2c3036" {...line} />
      <g fill="#383d45" stroke="#ff7a3c" strokeOpacity={0.85} strokeWidth={0.6}>
        <rect x={-0.347} y={-0.283} width={0.03} height={0.093} rx={0.008} ry={0.011} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect key={'b' + i} x={-0.406} y={-0.288 + i * 0.1} width={0.035} height={0.08} rx={0.009} ry={0.013} />
        ))}
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <rect key={'d' + i} x={-0.448} y={-0.301 + i * 0.085} width={0.03} height={0.073} rx={0.008} ry={0.011} />
        ))}
      </g>
      {/* the panel at the back with the stop button */}
      <rect x={-0.999} y={-0.399} width={0.351} height={0.799} rx={0.018} ry={0.024} fill="#2b2e33" {...line} />
      <rect x={-0.89} y={-0.223} width={0.174} height={0.446} rx={0.02} ry={0.027} fill="#8f0f22" />
      <rect x={-0.867} y={-0.207} width={0.142} height={0.413} rx={0.015} ry={0.02} fill={`url(#${id}r)`} />
      {emergency && (
        <rect x={-0.867} y={-0.207} width={0.142} height={0.413} rx={0.015} ry={0.02} fill="#fff" opacity={0}>
          <animate attributeName="opacity" values="0;1;0" dur="0.8s" repeatCount="indefinite" />
        </rect>
      )}
      {/* upright on the button: across the mower, the tops of the letters to the front */}
      <text transform={`matrix(0 1 ${-42.5 / 57} 0 -0.839 0)`} fontSize={0.154} letterSpacing={0.004} {...stopText}>
        STOP
      </text>
    </>
  );
}

// a John Deere Tango E5 (the same as a SABO MOWiT 500F), traced from a photo from straight above. Symmetric parts as
// their left half from the front round to the back, both() adds the right one; vent, stripe, panel, faces and ear are
// the left ones, the right ones are drawn mirrored
const TANGO = {
  base: both(
    [
      [1, 0], [1, -0.239], [0.917, -0.564], [0.837, -0.71], [0.662, -0.778], [0.396, -0.871], [-0.006, -0.92],
      [-0.11, -0.968], [-0.265, -0.994], [-0.471, -0.998], [-0.695, -0.938], [-0.734, -0.879], [-0.801, -0.68],
      [-0.902, -0.613], [-0.948, -0.557], [-1, -0.389], [-1, 0],
    ],
  ),
  shell: both(
    [
      [0.972, 0], [0.972, -0.198], [0.892, -0.527], [0.823, -0.677], [0.656, -0.763], [0.396, -0.871], [-0.006, -0.92],
      [-0.11, -0.968], [-0.265, -0.994], [-0.471, -0.998], [-0.695, -0.938], [-0.734, -0.879], [-0.801, -0.68],
      [-0.902, -0.613], [-0.948, -0.557], [-1, -0.389], [-1, 0],
    ],
  ),
  hood: both(
    [
      [0.965, 0], [0.961, -0.164], [0.946, -0.331], [0.799, -0.379], [0.602, -0.374], [0.415, -0.372], [0.133, -0.391],
      [-0.144, -0.419], [-0.144, 0],
    ],
    [3, 7, 8],
  ),
  vent: outline([[0.94, -0.316], [0.943, -0.348], [0.794, -0.472], [0.789, -0.439]], [0, 1, 2, 3]),
  chrome: outline([[0.943, -0.348], [0.941, -0.357], [0.793, -0.481], [0.794, -0.472]], [0, 1, 2, 3]),
  brow: outline([[0.803, -0.379], [0.803, 0.379], [0.791, 0.379], [0.791, -0.379]], [0, 1, 2, 3]),
  stripeEdge: outline(
    [
      [0.79, -0.485], [0.696, -0.547], [0.583, -0.593], [0.471, -0.641], [0.358, -0.677], [0.246, -0.707],
      [0.133, -0.73], [0.021, -0.75], [-0.092, -0.768], [-0.205, -0.779], [-0.317, -0.79], [-0.43, -0.797],
      [-0.514, -0.795], [-0.514, -0.765], [-0.43, -0.766], [-0.317, -0.76], [-0.205, -0.749], [-0.092, -0.737],
      [0.021, -0.72], [0.133, -0.699], [0.246, -0.677], [0.358, -0.646], [0.471, -0.611], [0.583, -0.563],
      [0.696, -0.516], [0.79, -0.455],
    ],
    [0, 12, 13, 25],
  ),
  stripe: outline(
    [
      [0.79, -0.477], [0.696, -0.539], [0.583, -0.586], [0.471, -0.634], [0.358, -0.669], [0.246, -0.699],
      [0.133, -0.722], [0.021, -0.742], [-0.092, -0.76], [-0.205, -0.771], [-0.317, -0.783], [-0.43, -0.789],
      [-0.514, -0.788], [-0.514, -0.773], [-0.43, -0.774], [-0.317, -0.768], [-0.205, -0.756], [-0.092, -0.745],
      [0.021, -0.727], [0.133, -0.707], [0.246, -0.684], [0.358, -0.654], [0.471, -0.619], [0.583, -0.571],
      [0.696, -0.524], [0.79, -0.462],
    ],
    [0, 12, 13, 25],
  ),
  panel: outline(
    [
      [0.799, -0.379], [0.787, -0.47], [0.696, -0.516], [0.583, -0.563], [0.471, -0.611], [0.358, -0.646],
      [0.246, -0.677], [0.133, -0.699], [0.021, -0.72], [-0.092, -0.737], [-0.205, -0.749], [-0.317, -0.76],
      [-0.43, -0.766], [-0.486, -0.765], [-0.486, -0.423], [-0.144, -0.419], [0.133, -0.391], [0.415, -0.372],
      [0.602, -0.374],
    ],
    [0, 1, 12, 13, 14],
  ),
  rearFace: outline(
    [
      [-0.486, -0.423], [-0.486, -0.765], [-0.617, -0.763], [-0.739, -0.747], [-0.803, -0.697], [-0.885, -0.638],
      [-0.938, -0.574], [-0.976, -0.486], [-0.991, -0.381], [-0.955, -0.379], [-0.867, -0.376], [-0.711, -0.402],
      [-0.523, -0.417],
    ],
    [0, 1, 8, 9, 10],
  ),
  haunch: outline(
    [
      [-0.101, -0.808], [-0.242, -0.884], [-0.43, -0.928], [-0.617, -0.919], [-0.73, -0.871], [-0.692, -0.816],
      [-0.486, -0.818], [-0.289, -0.808],
    ],
  ),
  plate: both([[-0.015, 0], [-0.015, -0.331], [-0.023, -0.355], [-0.135, -0.375], [-0.144, -0.364], [-0.144, 0]]),
  bezel: both(
    [
      [-0.135, 0], [-0.139, -0.253], [-0.148, -0.412], [-0.169, -0.427], [-0.336, -0.424], [-0.486, -0.417],
      [-0.711, -0.402], [-0.833, -0.386], [-0.865, -0.348], [-0.868, 0],
    ],
  ),
  bezelTop: both(
    [
      [-0.135, 0], [-0.139, -0.253], [-0.148, -0.412], [-0.169, -0.427], [-0.225, -0.426], [-0.221, -0.253],
      [-0.22, 0],
    ],
    [4, 5],
  ),
  handle: both([[-0.867, 0], [-0.868, -0.376], [-0.901, -0.379], [-0.953, -0.348], [-0.957, 0]], [1]),
  lip: both([[-0.959, 0], [-0.958, -0.331], [-0.985, -0.318], [-0.993, 0]]),
  ear: outline(
    [
      [0.072, 0.055], [0.072, 0.078], [0.078, 0.102], [0.091, 0.122], [0.104, 0.139], [0.054, 0.156], [0.06, 0.132],
      [0.064, 0.107], [0.061, 0.082], [0.052, 0.062],
    ],
    [0, 4, 5, 9],
  ),
  earHole: outline(
    [
      [0.081, 0.156], [0.068, 0.159], [0.058, 0.159], [0.054, 0.156], [0.057, 0.15], [0.065, 0.144], [0.077, 0.139],
      [0.09, 0.136], [0.099, 0.136], [0.104, 0.139], [0.101, 0.145], [0.093, 0.151],
    ],
  ),
  // the warning triangles on the stickers
  warn: [
    'M-0.29,-0.322L-0.339,-0.286L-0.339,-0.358L-0.29,-0.322Z',
    'M-0.29,-0.202L-0.339,-0.166L-0.339,-0.238L-0.29,-0.202Z',
    'M-0.29,0.202L-0.339,0.238L-0.339,0.166L-0.29,0.202Z',
    'M-0.29,0.322L-0.339,0.358L-0.339,0.286L-0.29,0.322Z',
  ].join(''),
};

// the maker's badge on the hood: the deer as on the photo, upright seen from in front of the mower
const TANGO_DEER = outline(
  [
    [0.741, -0.077], [0.736, -0.07], [0.728, -0.062], [0.719, -0.033], [0.712, -0.02], [0.712, 0.026], [0.711, 0.045],
    [0.715, 0.045], [0.721, 0.038], [0.726, 0.031], [0.723, 0.043], [0.717, 0.053], [0.712, 0.062], [0.707, 0.067],
    [0.703, 0.065], [0.7, 0.054], [0.699, 0.042], [0.697, 0.038], [0.687, 0.033], [0.68, 0.031], [0.678, 0.037],
    [0.675, 0.039], [0.671, 0.029], [0.667, 0.049], [0.664, 0.033], [0.657, 0.046], [0.66, 0.029], [0.651, 0.031],
    [0.659, 0.021], [0.647, 0.012], [0.659, 0.01], [0.661, 0.006], [0.668, -0.007], [0.67, 0.004], [0.673, 0.009],
    [0.678, 0.011], [0.686, 0.013], [0.69, 0.011], [0.693, 0.007], [0.695, -0.036], [0.691, -0.038], [0.682, -0.034],
    [0.687, -0.043], [0.692, -0.047], [0.699, -0.046], [0.714, -0.053], [0.726, -0.068], [0.732, -0.076],
  ],
  [0, 9, 23, 24, 25, 26, 27, 28, 29, 30, 32, 41],
);

function johnDeereTango(id: string, emergency: boolean, blades: boolean) {
  return (
    <>
      <defs>
        <linearGradient id={id + 's'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c7a23" />
          <stop offset="0.22" stopColor="#3b922f" />
          <stop offset="0.5" stopColor="#46a237" />
          <stop offset="0.78" stopColor="#3b922f" />
          <stop offset="1" stopColor="#2c7a23" />
        </linearGradient>
        <linearGradient id={id + 'r'} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#ef3b44" />
          <stop offset="1" stopColor="#c4161f" />
        </linearGradient>
        <linearGradient id={id + 'l'} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a7b19a" />
          <stop offset="1" stopColor="#7d8873" />
        </linearGradient>
      </defs>
      {/* the grey bumper along the front, the green shell over all the rest */}
      <path d={TANGO.base} fill="#5a6066" {...line} />
      <path d={TANGO.shell} fill={`url(#${id}s)`} {...line} />
      {/* its faces: the wheel arches in the light, the side panels and the faces sloping down at the back darker, the
          hood in the middle lighter */}
      {SIDES.map((s) => (
        <g key={s} transform={`scale(1 ${s})`}>
          <path d={TANGO.haunch} fill="#fff" fillOpacity={0.1} />
          <path d={TANGO.panel} fill="#000" fillOpacity={0.1} />
          <path d={TANGO.rearFace} fill="#000" fillOpacity={0.24} />
        </g>
      ))}
      <path d={TANGO.hood} fill="#fff" fillOpacity={0.1} {...soft} />
      <path d={TANGO.brow} fill="#fff" fillOpacity={0.28} />
      {/* the maker's badge */}
      <rect x={0.638} y={-0.102} width={0.116} height={0.205} rx={0.013} ry={0.018} fill="#1a1a1a" />
      <rect x={0.64} y={-0.1} width={0.113} height={0.199} rx={0.012} ry={0.016} fill="#ffd400" />
      <rect x={0.647} y={-0.091} width={0.099} height={0.182} rx={0.009} ry={0.013} fill="#151515" />
      <path d={TANGO_DEER} fill="#ffd400" />
      {/* the slots beside the hood's front with their silver edge, the yellow stripes along the shoulders */}
      {SIDES.map((s) => (
        <g key={s} transform={`scale(1 ${s})`}>
          <path d={TANGO.vent} fill="#14301a" />
          <path d={TANGO.chrome} fill="#dfe4e8" />
          <path d={TANGO.stripeEdge} fill="#111" />
          <path d={TANGO.stripe} fill="#ffd400" />
        </g>
      ))}
      {/* the GPS antenna, with the ears of the ogre this mower was named after, wiggling while it mows */}
      <ellipse cx={0.038} cy={-0.013} rx={0.064} ry={0.086} fill="#000" fillOpacity={0.3} />
      {SIDES.map((s) => (
        <g key={s} transform={`scale(1 ${s})`}>
          <g>
            {blades && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                values="0 0.063 0.061;10 0.063 0.061;0 0.063 0.061"
                dur="0.5s"
                repeatCount="indefinite"
              />
            )}
            <path d={TANGO.ear} fill="#a6cf3f" stroke="#4d6814" strokeWidth={0.6} />
            <path d={TANGO.earHole} fill="#55741a" />
          </g>
        </g>
      ))}
      <ellipse cx={0.061} cy={0} rx={0.059} ry={0.08} fill="#17191b" {...line} />
      <ellipse cx={0.066} cy={0} rx={0.047} ry={0.063} fill="#2c3034" />
      <ellipse cx={0.084} cy={-0.025} rx={0.013} ry={0.018} fill="#fff" fillOpacity={0.3} />
      {/* the console: the plate, the bezel with the stop button between the stickers, the display and keypad, the handle */}
      <path d={TANGO.plate} fill="#1c1f22" {...line} />
      {/* and the name of the mower it was drawn from on the plate, where the real one says what it is, the same way round */}
      <text
        transform={`matrix(0 -1 ${53.5 / 77.5} 0 -0.042 0)`}
        fontSize={0.15}
        letterSpacing={0.004}
        {...stopText}
        fill="#ffd400"
      >
        Shrek
      </text>
      <path d={TANGO.bezel} fill="#6d7479" {...line} />
      <path d={TANGO.bezelTop} fill="#a9afb4" />
      <g fill="#1b1d20">
        <rect x={-0.474} y={-0.396} width={0.244} height={0.268} rx={0.013} ry={0.018} />
        <rect x={-0.474} y={0.129} width={0.244} height={0.268} rx={0.013} ry={0.018} />
        <rect x={-0.474} y={-0.114} width={0.244} height={0.227} rx={0.013} ry={0.018} />
      </g>
      <g fill="#f4cf00">
        <rect x={-0.444} y={-0.381} width={0.181} height={0.24} rx={0.008} ry={0.01} />
        <rect x={-0.444} y={0.141} width={0.181} height={0.24} rx={0.008} ry={0.01} />
      </g>
      <path d={TANGO.warn} fill="none" stroke="#000" strokeWidth={0.5} />
      <rect
        x={-0.454}
        y={-0.091}
        width={0.206}
        height={0.182}
        rx={0.017}
        ry={0.023}
        fill={`url(#${id}r)`}
        stroke="#7d0d14"
        strokeWidth={0.75}
      />
      {emergency && (
        <rect x={-0.454} y={-0.091} width={0.206} height={0.182} rx={0.017} ry={0.023} fill="#fff" opacity={0}>
          <animate attributeName="opacity" values="0;1;0" dur="0.8s" repeatCount="indefinite" />
        </rect>
      )}
      <text transform={`matrix(0 1 ${-53.5 / 77.5} 0 -0.365 0)`} fontSize={0.055} letterSpacing={0.002} {...stopText}>
        STOP
      </text>
      <rect x={-0.839} y={-0.379} width={0.326} height={0.758} rx={0.021} ry={0.028} fill="#25282c" {...line} />
      <rect x={-0.735} y={-0.212} width={0.125} height={0.357} rx={0.008} ry={0.01} fill={`url(#${id}l)`} {...soft} />
      <g fill="#9aa0a5">
        <rect x={-0.639} y={-0.318} width={0.024} height={0.076} rx={0.006} ry={0.008} />
        <rect x={-0.681} y={-0.318} width={0.024} height={0.076} rx={0.006} ry={0.008} />
        <rect x={-0.723} y={-0.318} width={0.024} height={0.076} rx={0.006} ry={0.008} />
      </g>
      <ellipse cx={-0.672} cy={0.274} rx={0.075} ry={0.101} fill="#b5bbc0" {...soft} />
      <ellipse cx={-0.672} cy={0.274} rx={0.03} ry={0.04} fill="#8a9095" />
      <g fill="#b5bbc0">
        <rect x={-0.808} y={-0.307} width={0.04} height={0.082} rx={0.008} ry={0.01} />
        <rect x={-0.808} y={0.141} width={0.04} height={0.08} rx={0.008} ry={0.01} />
        <rect x={-0.808} y={0.251} width={0.04} height={0.096} rx={0.008} ry={0.01} />
      </g>
      <path d={TANGO.handle} fill="#121416" {...soft} />
      <path d={TANGO.lip} fill="#fff" fillOpacity={0.12} />
    </>
  );
}

// a black NX60 with the Punisher skull on its front, traced from photos from above. Fin, scoop and wing are the left
// ones, the right ones are drawn mirrored. The skull is upright seen from the front, its teeth to the front
const NX60 = {
  skirt: both(
    [
      [0.997, 0], [0.995, -0.311], [0.929, -0.51], [0.86, -0.733], [0.792, -0.817], [0.723, -0.848], [0.608, -0.868],
      [0.449, -0.891], [0.312, -0.92], [0.175, -0.942], [0.038, -0.955], [-0.132, -0.967], [-0.296, -0.986],
      [-0.46, -0.996], [-0.597, -1.002], [-0.707, -0.996], [-0.803, -0.967], [-0.885, -0.875], [-0.953, -0.642],
      [-0.989, -0.35], [-1, 0],
    ],
  ),
  shell: both(
    [
      [0.995, 0], [0.992, -0.311], [0.929, -0.51], [0.86, -0.733], [0.792, -0.817], [0.723, -0.848], [0.608, -0.868],
      [0.449, -0.891], [0.312, -0.92], [0.175, -0.942], [0.038, -0.955], [-0.132, -0.967], [-0.296, -0.986],
      [-0.46, -0.996], [-0.597, -1], [-0.7, -0.99], [-0.782, -0.957], [-0.852, -0.879], [-0.899, -0.739],
      [-0.926, -0.486], [-0.94, 0],
    ],
  ),
  hood: both(
    [
      [0.992, 0], [0.99, -0.311], [0.973, -0.389], [0.841, -0.428], [0.704, -0.451], [0.533, -0.467], [0.327, -0.479],
      [0.197, -0.486], [0.197, 0],
    ],
  ),
  fin: outline(
    [
      [0.722, -0.739], [0.636, -0.786], [0.553, -0.8], [0.416, -0.794], [0.285, -0.776], [0.341, -0.642],
      [0.416, -0.549], [0.533, -0.51], [0.738, -0.533], [0.649, -0.576], [0.619, -0.623], [0.636, -0.681],
    ],
    [0, 4, 8],
  ),
  scoop: outline(
    [
      [0.722, -0.739], [0.636, -0.681], [0.619, -0.623], [0.649, -0.576], [0.738, -0.533], [0.704, -0.584],
      [0.674, -0.642], [0.69, -0.7],
    ],
    [0, 4],
  ),
  frame: both(
    [
      [0.652, 0], [0.648, -0.195], [0.622, -0.307], [0.575, -0.374], [0.523, -0.405], [0.416, -0.42], [0.293, -0.432],
      [0.244, -0.451], [0.192, -0.584], [0.118, -0.732], [0.033, -0.704], [-0.077, -0.673], [-0.268, -0.65],
      [-0.405, -0.623], [-0.455, -0.568], [-0.477, -0.467], [-0.488, -0.346], [-0.515, -0.323], [-0.614, -0.323],
      [-0.63, -0.292], [-0.633, 0],
    ],
    [16],
  ),
  wing: outline(
    [
      [0.195, -0.44], [0.156, -0.576], [0.104, -0.685], [0.005, -0.661], [-0.173, -0.634], [-0.364, -0.611],
      [-0.419, -0.568], [-0.436, -0.486], [-0.405, -0.432], [-0.132, -0.416], [0.115, -0.416],
    ],
  ),
  lid: both(
    [
      [0.622, 0], [0.616, -0.214], [0.581, -0.323], [0.512, -0.374], [0.416, -0.389], [0.279, -0.397], [0.115, -0.401],
      [-0.132, -0.397], [-0.364, -0.385], [-0.405, -0.342], [-0.408, 0],
    ],
  ),
  tomb: both(
    [
      [0.255, 0], [0.247, -0.156], [0.211, -0.253], [0.142, -0.307], [0.033, -0.323], [-0.132, -0.327], [-0.4, -0.327],
      [-0.403, 0],
    ],
  ),
  skull:
    both(
      [
        [0.642, 0], [0.648, -0.11], [0.664, -0.176], [0.692, -0.217], [0.728, -0.231], [0.765, -0.227], [0.799, -0.215],
        [0.818, -0.204], [0.829, -0.202], [0.843, -0.197], [0.852, -0.184], [0.855, -0.162], [0.855, -0.136],
        [0.851, -0.126], [0.847, -0.121], [0.85, -0.099], [0.86, -0.081], [0.871, -0.072], [0.937, -0.072],
        [0.942, -0.068], [0.942, -0.044], [0.937, -0.04], [0.873, -0.04], [0.873, -0.035], [0.94, -0.035],
        [0.944, -0.031], [0.944, -0.007], [0.94, -0.003], [0.873, -0.003], [0.873, 0],
      ],
      [13, 14, 17, 18, 21, 22, 23, 24, 27, 28],
    ) +
    outline(
      [
        [0.746, -0.195], [0.751, -0.147], [0.765, -0.088], [0.783, -0.044], [0.801, -0.018], [0.802, -0.074],
        [0.795, -0.132], [0.781, -0.176], [0.765, -0.191],
      ],
      [0, 4],
    ) +
    outline(
      [
        [0.746, 0.195], [0.751, 0.147], [0.765, 0.088], [0.783, 0.044], [0.801, 0.018], [0.802, 0.074], [0.795, 0.132],
        [0.781, 0.176], [0.765, 0.191],
      ],
      [0, 4],
    ) +
    outline([[0.818, -0.037], [0.81, -0.028], [0.812, -0.005], [0.84, -0.005]], [0, 1, 2, 3]) +
    outline([[0.818, 0.037], [0.81, 0.028], [0.812, 0.005], [0.84, 0.005]], [0, 1, 2, 3]),
};

function punisherNx60(id: string, emergency: boolean) {
  return (
    <>
      <defs>
        <linearGradient id={id + 's'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#26282b" />
          <stop offset="0.22" stopColor="#36383c" />
          <stop offset="0.5" stopColor="#3d4044" />
          <stop offset="0.78" stopColor="#36383c" />
          <stop offset="1" stopColor="#26282b" />
        </linearGradient>
        <linearGradient id={id + 'h'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b3e42" />
          <stop offset="0.5" stopColor="#4a4d52" />
          <stop offset="1" stopColor="#3b3e42" />
        </linearGradient>
        <linearGradient id={id + 'f'} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#55585e" />
          <stop offset="1" stopColor="#36393d" />
        </linearGradient>
        <linearGradient id={id + 'l'} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#4e5156" />
          <stop offset="1" stopColor="#43464b" />
        </linearGradient>
        <linearGradient id={id + 'g'} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a3138" />
          <stop offset="1" stopColor="#121519" />
        </linearGradient>
        <linearGradient id={id + 'r'} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#ee3049" />
          <stop offset="1" stopColor="#c0152e" />
        </linearGradient>
        <radialGradient id={id + 'k'} cx="0.6" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#74777c" />
          <stop offset="1" stopColor="#3a3d41" />
        </radialGradient>
      </defs>
      {/* the skirt all round, with a light edge so the black mower shows on a dark map */}
      <path d={NX60.skirt} fill="#17181a" stroke="#9aa0a6" strokeWidth={0.75} strokeOpacity={0.5} />
      <path d={NX60.shell} fill={`url(#${id}s)`} {...line} />
      <path d={NX60.hood} fill={`url(#${id}h)`} {...soft} />
      {/* the skull, faded like the real one */}
      <path d={NX60.skull} fill="#dfe2e6" fillOpacity={0.4} fillRule="evenodd" />
      {SIDES.map((s) => (
        <g key={s} transform={`scale(1 ${s})`}>
          <path d={NX60.fin} fill={`url(#${id}f)`} {...line} />
          <path d={NX60.scoop} fill="#0f1012" />
        </g>
      ))}
      {/* the ridge round the back of the lid */}
      <path
        d="M0.088,-0.712C0.024,-0.702 -0.191,-0.675 -0.296,-0.65C-0.401,-0.625 -0.485,-0.607 -0.542,-0.564C-0.6,-0.52 -0.622,-0.483 -0.641,-0.389C-0.66,-0.295 -0.658,-0.13 -0.658,0C-0.658,0.13 -0.66,0.295 -0.641,0.389C-0.622,0.483 -0.6,0.52 -0.542,0.564C-0.485,0.607 -0.401,0.625 -0.296,0.65C-0.191,0.675 0.024,0.702 0.088,0.712"
        fill="none"
        stroke="#fff"
        strokeOpacity={0.16}
        strokeWidth={0.8}
      />
      {/* the lid in its dark frame, the wings beside it, the display window */}
      <path d={NX60.frame} fill="#121315" />
      {SIDES.map((s) => (
        <path key={s} transform={`scale(1 ${s})`} d={NX60.wing} fill="#3e4146" />
      ))}
      <path d={NX60.lid} fill={`url(#${id}l)`} />
      <path d={NX60.tomb} fill="#52565b" {...soft} />
      <rect x={-0.337} y={-0.274} width={0.248} height={0.549} rx={0.025} ry={0.035} fill={`url(#${id}g)`} {...line} />
      <path d="M-0.337,-0.214 L-0.089,-0.058 L-0.089,0.019 L-0.337,-0.136Z" fill="#fff" fillOpacity={0.07} />
      {/* the stop button in its well */}
      <rect x={-0.627} y={-0.319} width={0.238} height={0.638} rx={0.03} ry={0.043} fill="#18191b" />
      <rect
        x={-0.604}
        y={-0.286}
        width={0.195}
        height={0.572}
        rx={0.027}
        ry={0.039}
        fill={`url(#${id}r)`}
        stroke="#7d0d1d"
        strokeWidth={0.75}
      />
      {emergency && (
        <rect x={-0.604} y={-0.286} width={0.195} height={0.572} rx={0.027} ry={0.039} fill="#fff" opacity={0}>
          <animate attributeName="opacity" values="0;1;0" dur="0.8s" repeatCount="indefinite" />
        </rect>
      )}
      <text transform={`matrix(0 1 ${-41 / 61} 0 -0.552 0)`} fontSize={0.187} letterSpacing={0.004} {...stopText}>
        STOP
      </text>
      {/* the knob at the back, the two sensors at the front */}
      <ellipse cx={-0.792} cy={0} rx={0.077} ry={0.109} fill="#1b1c1e" {...line} />
      <ellipse cx={-0.77} cy={0} rx={0.068} ry={0.097} fill={`url(#${id}k)`} />
      <ellipse cx={-0.751} cy={-0.027} rx={0.022} ry={0.031} fill="#fff" fillOpacity={0.25} />
      {SIDES.map((s) => (
        <rect key={s} x={0.958} y={s > 0 ? -0.051 : 0.008} width={0.026} height={0.043} rx={0.004} ry={0.006} fill="#ececec" />
      ))}
    </>
  );
}

const MODELS: MowerIcon[] = [
  {
    key: 'yf500',
    label: 'YardForce Classic 500',
    fit: 42.5 / 57,
    // a Classic 500B (57 x 42.5 cm) from above: the shell with its creases, the height knob, the keypad and the stop button
    // at the back, under it the base with the bumper and the fenders over the rear wheels
    draw: ({emergency = false} = {}) => <Shaded draw={(id) => classic500(id, emergency)} />,
  },
  {
    key: 'sa650',
    label: 'YardForce SA650',
    fit: 39 / 57,
    // black with round arches over the rear wheels, an orange lid with the stop button at its back, orange nose
    draw: ({emergency = false} = {}) => (
      <>
        {rearWheels(-0.9, 0.5, 0.9)}
        <path
          d="M-0.98,-0.7 Q-1,-0.96 -0.8,-0.97 L-0.45,-0.97 Q-0.3,-0.96 -0.25,-0.8 L0.55,-0.76 Q0.95,-0.7 1,-0.3 L1,0.3 Q0.95,0.7 0.55,0.76 L-0.25,0.8 Q-0.3,0.96 -0.45,0.97 L-0.8,0.97 Q-1,0.96 -0.98,0.7 Z"
          fill={BLACK}
          {...line}
        />
        <path d="M-0.5,-0.44 L0.38,-0.38 Q0.5,-0.36 0.5,-0.24 L0.5,0.24 Q0.5,0.36 0.38,0.38 L-0.5,0.44 Q-0.58,0.44 -0.58,0.36 L-0.58,-0.36 Q-0.58,-0.44 -0.5,-0.44 Z" fill={ORANGE} {...line} />
        <rect x={-0.18} y={-0.22} width={0.46} height={0.44} rx={0.05} fill="#3a3a3a" {...line} />
        {stopButton(-0.78, 0.18, 0.5, emergency)}
        <path d="M0.68,-0.4 Q0.94,-0.36 0.97,-0.12 L0.97,0.12 Q0.94,0.36 0.68,0.4 Z" fill={ORANGE} {...line} />
        <rect x={0.8} y={-0.24} width={0.1} height={0.14} fill={BLACK} />
        <rect x={0.8} y={0.1} width={0.1} height={0.14} fill={BLACK} />
      </>
    ),
  },
  {
    key: 'nx100',
    label: 'YardForce NX100',
    fit: 0.72,
    // black on an orange skirt, big wheels at the back, the orange lid with the stop button at its back, silver fins and
    // the silver plate in front of it, the orange charging ports at the very front
    draw: ({emergency = false} = {}) => (
      <>
        {rearWheels(-0.94, 0.56, 0.86)}
        <path
          d="M-0.98,-0.84 L0.55,-0.84 Q0.98,-0.8 1,-0.35 L1,0.35 Q0.98,0.8 0.55,0.84 L-0.98,0.84 Q-1,0.84 -1,0.78 L-1,-0.78 Q-1,-0.84 -0.98,-0.84 Z"
          fill={ORANGE}
          {...line}
        />
        <path
          d="M-0.92,-0.78 L0.5,-0.78 Q0.92,-0.74 0.94,-0.32 L0.94,0.32 Q0.92,0.74 0.5,0.78 L-0.92,0.78 Q-0.95,0.78 -0.95,0.72 L-0.95,-0.72 Q-0.95,-0.78 -0.92,-0.78 Z"
          fill={BLACK}
          {...line}
        />
        <path d="M-0.5,-0.42 L0.3,-0.36 Q0.42,-0.34 0.42,-0.22 L0.42,0.22 Q0.42,0.34 0.3,0.36 L-0.5,0.42 Q-0.56,0.42 -0.56,0.36 L-0.56,-0.36 Q-0.56,-0.42 -0.5,-0.42 Z" fill={ORANGE} {...line} />
        <rect x={-0.2} y={-0.2} width={0.4} height={0.4} rx={0.05} fill="#3a3a3a" {...line} />
        {stopButton(-0.76, 0.18, 0.46, emergency)}
        <path d="M0.42,-0.3 L0.62,-0.24 L0.62,0.24 L0.42,0.3 Z" fill={SILVER} {...line} />
        <path d="M0.3,-0.62 L0.66,-0.5 L0.6,-0.42 L0.28,-0.5 Z" fill={SILVER} {...line} />
        <path d="M0.3,0.62 L0.66,0.5 L0.6,0.42 L0.28,0.5 Z" fill={SILVER} {...line} />
        <rect x={0.9} y={-0.3} width={0.08} height={0.2} rx={0.02} fill={ORANGE} />
        <rect x={0.9} y={0.1} width={0.08} height={0.2} rx={0.02} fill={ORANGE} />
      </>
    ),
  },
  {
    key: 'jd-tango',
    label: 'John Deere Tango E5',
    fit: 53.5 / 77.5,
    draw: ({emergency = false, blades = false} = {}) => <Shaded draw={(id) => johnDeereTango(id, emergency, blades)} />,
  },
  {
    key: 'punisher',
    label: 'NX60 Punisher',
    fit: 41 / 61,
    draw: ({emergency = false} = {}) => <Shaded draw={(id) => punisherNx60(id, emergency)} />,
  },
];

export const MOWER_ICONS: MowerIcon[] = [
  {
    key: 'triangle',
    label: 'Arrowhead',
    draw: () => <polygon points="1,0 -0.6,0.6 -0.6,-0.6" fill="var(--c-mower)" stroke="#fff" strokeWidth={0.5} />,
  },
  {
    key: 'arrow',
    label: 'Arrow',
    draw: () => (
      <path d="M1,0 L-0.2,-0.8 L-0.2,-0.3 L-1,-0.3 L-1,0.3 L-0.2,0.3 L-0.2,0.8 Z" fill="var(--c-mower)" stroke="#fff" strokeWidth={0.5} />
    ),
  },
  {
    key: 'robot',
    label: 'Mower',
    draw: () => (
      <>
        <rect x={-1} y={-0.95} width={0.55} height={0.3} rx={0.1} fill="#222" />
        <rect x={-1} y={0.65} width={0.55} height={0.3} rx={0.1} fill="#222" />
        <rect x={-0.95} y={-0.7} width={1.9} height={1.4} rx={0.45} fill="var(--c-mower)" stroke="#fff" strokeWidth={0.5} />
        <circle cx={0.15} cy={0} r={0.32} fill="rgba(0,0,0,0.35)" />
        <circle cx={0.62} cy={0} r={0.12} fill="#fff" />
      </>
    ),
  },
  {
    key: 'dot',
    label: 'Dot',
    draw: () => (
      <>
        <line x1={0} y1={0} x2={1.1} y2={0} stroke="var(--c-mower)" strokeWidth={2} strokeLinecap="round" />
        <circle r={0.6} fill="var(--c-mower)" stroke="#fff" strokeWidth={0.5} />
      </>
    ),
  },
  {
    key: 'chomper',
    label: 'Chomper',
    draw: () => (
      <>
        <path d={mouth(35)} fill="var(--c-mower)" stroke="#000" strokeWidth={0.5}>
          <animate attributeName="d" values={`${mouth(35)};${mouth(3)};${mouth(35)}`} dur="0.4s" repeatCount="indefinite" />
        </path>
        <circle cx={0.05} cy={-0.5} r={0.12} fill="#000" />
      </>
    ),
  },
  {
    key: 'rocket',
    label: 'Rocket',
    draw: () => (
      <>
        <path d="M-0.75,-0.18 L-1.25,0 L-0.75,0.18 Z" fill="#ffb300">
          <animate attributeName="d" values="M-0.75,-0.18 L-1.25,0 L-0.75,0.18 Z;M-0.75,-0.2 L-1.45,0 L-0.75,0.2 Z;M-0.75,-0.18 L-1.25,0 L-0.75,0.18 Z" dur="0.25s" repeatCount="indefinite" />
        </path>
        <path d="M-0.55,-0.3 L-0.95,-0.65 L-0.95,-0.2 Z M-0.55,0.3 L-0.95,0.65 L-0.95,0.2 Z" fill="#555" />
        <path d="M1,0 C0.6,-0.45 -0.2,-0.4 -0.8,-0.3 L-0.8,0.3 C-0.2,0.4 0.6,0.45 1,0 Z" fill="var(--c-mower)" stroke="#fff" strokeWidth={0.5} />
        <circle cx={0.25} cy={0} r={0.15} fill="#9be7ff" stroke="#fff" strokeWidth={0.3} />
      </>
    ),
  },
  {
    key: 'gardener',
    label: 'Gardener',
    side: true,
    upright: true,
    // the middle of the push mower sits on the mower's position, the man walks behind it
    draw: ({speed = 0, emergency = false, blades = false} = {}) => {
      const walking = speed > 0.08;
      return (
        <g transform="scale(0.8) translate(-0.65 -0.46)">
          {pushMower(emergency ? 0 : speed)}
          {blades && walking && !emergency && BOX_CLIPPINGS}
          {emergency ? (
            // emergency stop: he lies next to it, holding his knee and rocking with the pain
            <g transform="translate(-0.3 0.11) scale(0.85)">
              <g>
                <animateTransform attributeName="transform" type="rotate" values="-3 -0.4 0.7;3 -0.4 0.7;-3 -0.4 0.7" dur="1.2s" repeatCount="indefinite" />
                <path d="M-0.2,0.58 L0.14,0.6 L0.15,0.72 L-0.2,0.7 Z" fill="#141414" />
                <path d="M0.1,0.58 L0.22,0.59 Q0.27,0.66 0.24,0.73 L0.12,0.72 Z" fill="#5d4037" />
                <path d="M-0.2,0.5 L-0.1,0.44 L0.02,0.18 L0.12,0.22 L0.12,0.56 L0.02,0.56 L0.03,0.34 L-0.08,0.62 L-0.2,0.64 Z" fill="#141414" />
                <path d="M0.0,0.5 L0.13,0.5 Q0.18,0.56 0.14,0.62 L0.0,0.6 Z" fill="#5d4037" />
                <path d="M-0.72,0.44 Q-0.75,0.72 -0.68,0.72 L-0.18,0.72 L-0.16,0.46 Z" fill="#43a047" />
                <path d="M-0.5,0.46 L-0.44,0.4 L0.02,0.22 L0.04,0.3 Z" fill="#43a047" />
                <circle cx={0.04} cy={0.25} r={0.07} fill="#f1c27d" />
                <circle cx={-0.88} cy={0.56} r={0.16} fill="#f1c27d" />
                <path d="M-0.94,0.4 Q-1.1,0.5 -1.06,0.68 L-1.08,0.76 L-1.02,0.76 L-1.02,0.42 Z" fill="#c9a45c" />
              </g>
              <path
                d="M0.12,0.02 L0.2,-0.1 M0.24,0.12 L0.38,0.06 M0.0,0.0 L-0.02,-0.14"
                stroke="#ff5252"
                strokeWidth={0.05}
                strokeLinecap="round"
                style={SCALING}
              >
                <animate attributeName="opacity" values="1;0.2;1" dur="0.6s" repeatCount="indefinite" />
              </path>
            </g>
          ) : (
            // the man pushing it. walking he bobs along with his steps and now and then wipes the sweat off his
            // forehead, standing he lifts his hat now and then
            <>
              <g transform="translate(-0.45 0.12)">
                {leg(22, walking ? speed : 0)}
                {leg(-22, walking ? speed : 0)}
              </g>
              <g>
                {walking && (
                  <animateTransform
                    attributeName="transform"
                    type="translate"
                    values="0 0;0 -0.035;0 0"
                    dur={`${(stepDur(speed) / 2).toFixed(2)}s`}
                    repeatCount="indefinite"
                  />
                )}
                <path d="M-0.6,-0.5 Q-0.45,-0.6 -0.3,-0.5 L-0.28,0.16 L-0.62,0.16 Z" fill="#43a047" />
                <path d="M-0.42,-0.46 L-0.34,-0.52 L-0.04,-0.18 L-0.1,-0.1 Z" fill="#43a047" />
                <circle cx={-0.06} cy={-0.14} r={0.07} fill="#f1c27d" />
                <circle cx={-0.43} cy={-0.72} r={0.17} fill="#f1c27d" />
                <path d="M-0.64,-0.76 Q-0.43,-1.08 -0.22,-0.76 L-0.14,-0.74 L-0.14,-0.7 L-0.66,-0.7 Z" fill="#c9a45c">
                  {!walking && (
                    <animateTransform
                      attributeName="transform"
                      type="translate"
                      values="0 0;0 0;0 -0.16;0 -0.16;0 0;0 0"
                      keyTimes="0;0.8;0.84;0.92;0.96;1"
                      dur="7s"
                      repeatCount="indefinite"
                    />
                  )}
                </path>
                {walking && (
                  <>
                    <path d="M-0.27,-0.66 Q-0.22,-0.58 -0.27,-0.55 Q-0.32,-0.58 -0.27,-0.66 Z" fill="#81d4fa" opacity={0}>
                      <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;0.76;0.78;0.86;0.9;1" dur="9s" repeatCount="indefinite" />
                      <animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 0.25;0 0.25" keyTimes="0;0.8;0.9;1" dur="9s" repeatCount="indefinite" />
                    </path>
                    <g opacity={0}>
                      <path d="M-0.44,-0.5 L-0.36,-0.5 L-0.16,-0.4 L-0.24,-0.74 L-0.3,-0.72 L-0.24,-0.47 L-0.42,-0.4 Z" fill="#388e3c" />
                      <circle cx={-0.27} cy={-0.75} r={0.07} fill="#f1c27d" />
                      <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;0.8;0.81;0.95;0.96;1" dur="9s" repeatCount="indefinite" />
                      <animateTransform
                        attributeName="transform"
                        type="rotate"
                        values="0 -0.2 -0.42;0 -0.2 -0.42;-14 -0.2 -0.42;10 -0.2 -0.42;-14 -0.2 -0.42;10 -0.2 -0.42;0 -0.2 -0.42"
                        keyTimes="0;0.82;0.85;0.88;0.91;0.94;1"
                        dur="9s"
                        repeatCount="indefinite"
                      />
                    </g>
                  </>
                )}
              </g>
            </>
          )}
        </g>
      );
    },
  },
  {
    key: 'openmower',
    label: 'OpenMower',
    side: true,
    draw: ({speed = 0, emergency = false, blades = false} = {}) => (
      // like the logo: black lines between the parts, a black edge and a white one around it so it shows on any map.
      // the edges grow with the icon (the map draws lines at a fixed width otherwise). driving, the wheel turns as fast
      // as the mower goes, with the blade on grass flies out behind it, on an emergency stop it shakes and the lines
      // flash red
      <g transform="scale(-0.0042 0.0042) translate(-269 -136)" strokeLinejoin="round">
        <g>
          {emergency && (
            <animateTransform attributeName="transform" type="translate" values="0 0;9 -3;-9 3;6 0;0 0" dur="0.35s" repeatCount="indefinite" />
          )}
          {OPENMOWER_EDGE.map((p, i) => wheel(i, speed, <path transform={p.transform} d={p.d} fill="none" stroke="#fff" strokeWidth={26} style={SCALING} />, `w${i}`))}
          {OPENMOWER_PATHS.map((p, i) =>
            wheel(
              i,
              speed,
              <path transform={p.transform} d={p.d} fill="#000" stroke="#000" strokeWidth={16} style={SCALING}>
                {emergency && (
                  <>
                    <animate attributeName="fill" values="#000;#e53935;#000" dur="0.8s" repeatCount="indefinite" />
                    <animate attributeName="stroke" values="#000;#e53935;#000" dur="0.8s" repeatCount="indefinite" />
                  </>
                )}
              </path>,
              `b${i}`,
            ),
          )}
          {OPENMOWER_PATHS.map((p, i) => wheel(i, speed, <path transform={p.transform} d={p.d} fill="var(--c-mower)" />, `c${i}`))}
          {blades && !emergency && speed > 0.05 && CLIPPINGS}
        </g>
      </g>
    ),
  },
  ...MODELS,
];

// the yard force charging station from above, the tower at +x: the plate with the guide rails and the grip at the
// entry, the orange cap with its window and the two charging pins under it. -1..1 from the entry to the tower
// the YardForce station of the NX models from above, measured on one: the plate 37 cm wide at the front, flaring to
// 45.8 at the back, the U of rails 4.3 cm wide the wheels run in, the studded fields for the wheels at the back and the
// tower at the front under its 20 x 15 cm cap, which reaches over the contacts. In units of half its length, the front at
// +x
const YF_PLATE = both(
  [
    [0.984, 0], [0.984, -0.532], [0.965, -0.581], [0.919, -0.597], [0.165, -0.597], [-0.303, -0.739], [-0.939, -0.739],
    [-0.984, -0.726], [-1, -0.677], [-1, 0],
  ],
  [0, 1, 3, 4, 5, 6, 8, 9],
);
const YF_RAILS = both(
  [
    [0.758, 0], [0.758, -0.489], [0.739, -0.535], [0.694, -0.553], [0.165, -0.553], [-0.303, -0.694], [-0.332, -0.665],
    [-0.323, -0.568], [-0.3, -0.555], [0.142, -0.415], [0.671, -0.415], [0.706, -0.4], [0.719, -0.365], [0.719, 0],
  ],
  [0, 1, 3, 4, 5, 8, 9, 10, 12, 13],
);
const YF_RAIL_TOP = outline(
  [
    [0.681, -0.535], [0.174, -0.535], [-0.29, -0.674], [-0.3, -0.635], [0.152, -0.5], [0.681, -0.5],
  ],
  [0, 1, 2, 3, 4, 5],
);
// the studs for the wheels, both sides
const YF_STUDS = [1, -1]
  .flatMap((s) =>
    Array.from({length: 12 * 13}, (_, i) => {
      const x = -0.355 - Math.floor(i / 13) * 0.055;
      const y = s * (0.213 + (i % 13) * 0.04);
      return `M${(x - 0.008).toFixed(3)},${(y - 0.008).toFixed(3)}h0.016v0.016h-0.016z`;
    }),
  )
  .join('');

export const YF_STATION = {length: 0.62, width: 0.46, pins: 0.09}; // m, the contacts this far behind the cap's front

// the station with a cap on its tower: the plate, the U of rails, the studs, the holes for the pegs, then the cap, its
// back edge sloping down over the contacts
const yfStation = (cap: React.ReactNode) => (
  <>
    <path d={YF_PLATE} fill="#262626" stroke="#000" strokeWidth={0.75} />
    <path d={YF_STUDS} fill="#111" />
    <path d={YF_RAILS} fill="#34373b" stroke="#000" strokeWidth={0.5} />
    {SIDES.map((s) => (
      <path key={s} transform={`scale(1 ${s})`} d={YF_RAIL_TOP} fill="#4a4e53" />
    ))}
    <g fill="#0d0d0d">
      <circle cx={0.668} cy={-0.361} r={0.015} />
      <circle cx={0.668} cy={0.361} r={0.015} />
      <circle cx={0.355} cy={0} r={0.015} />
    </g>
    {cap}
  </>
);

// the John Deere Tango E5's station (the SABO MOWiT 500F's too) from above, from photos: the plate with the tread for
// the wheels at the back, the U of the hood round the mower's nose at the front with the two contact plates inside
const TANGO_HOOD = both(
  [
    [1, 0], [1, -0.4], [0.98, -0.5], [0.9, -0.55], [0.36, -0.55], [0.33, -0.5], [0.36, -0.42], [0.81, -0.42],
    [0.81, 0],
  ],
  [4, 6, 7, 8],
);
export const TANGO_STATION = {length: 0.95, width: 0.56, pins: 0.09}; // m, the contacts this far behind the hood's front

export const DOCK_ICONS: {key: string; label: string; real?: typeof YF_STATION; draw: () => React.ReactNode}[] = [
  {key: 'dot', label: 'Dot', draw: () => <circle r={0.65} fill="var(--c-dock)" />},
  {
    key: 'yardforce',
    label: 'YardForce station',
    real: YF_STATION,
    draw: () =>
      yfStation(
        <>
          <rect x={0.516} y={-0.323} width={0.484} height={0.645} rx={0.071} fill="#f4612b" {...line} />
          <rect x={0.516} y={-0.3} width={0.055} height={0.6} rx={0.02} fill="#000" fillOpacity={0.18} />
          <rect x={0.645} y={-0.177} width={0.226} height={0.355} rx={0.048} fill="#1e1e1e" />
        </>,
      ),
  },
  {
    key: 'punisher',
    label: 'Punisher station',
    real: YF_STATION,
    // the YardForce station with the cap painted black and the skull on it, like the NX60 Punisher's: in the cap's
    // recess, its top to the front
    draw: () =>
      yfStation(
        <>
          <rect
            x={0.516}
            y={-0.323}
            width={0.484}
            height={0.645}
            rx={0.071}
            fill="#202224"
            stroke="#55595e"
            strokeWidth={0.75}
          />
          <rect x={0.516} y={-0.3} width={0.055} height={0.6} rx={0.02} fill="#000" fillOpacity={0.3} />
          <rect
            x={0.608}
            y={-0.161}
            width={0.242}
            height={0.323}
            rx={0.045}
            fill="#141516"
            stroke="#3a3d40"
            strokeWidth={0.5}
          />
          <path d={NX60.skull} transform="matrix(-0.523 0 0 0.2446 1.1438 0)" fill="#f2f2f2" fillRule="evenodd" />
        </>,
      ),
  },
  {
    key: 'tango',
    label: 'Tango station',
    real: TANGO_STATION,
    draw: () => (
      <>
        <rect x={-1} y={-0.589} width={2} height={1.178} rx={0.06} fill="#2e3033" stroke="#000" strokeWidth={0.75} />
        {/* the tread for the wheels at the back */}
        {SIDES.map((s) => (
          <path
            key={s}
            transform={`scale(1 ${s})`}
            d={[-0.94, -0.86, -0.78, -0.7, -0.62].map((x) => `M${x},-0.5 L${x + 0.08},-0.42`).join('')}
            stroke="#1c1d1f"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        ))}
        <path d={TANGO_HOOD} fill="#1b1c1e" stroke="#000" strokeWidth={0.75} />
        {/* its top in the light, the contact plates inside, the lamp */}
        <path
          d="M0.36,-0.5 L0.9,-0.5 Q0.95,-0.48 0.955,-0.4 L0.955,0.4 Q0.95,0.48 0.9,0.5 L0.36,0.5"
          fill="none"
          stroke="#45484c"
          strokeWidth={1}
        />
        <g fill="#c3c8cc">
          <rect x={0.77} y={-0.24} width={0.04} height={0.13} rx={0.01} />
          <rect x={0.77} y={0.11} width={0.04} height={0.13} rx={0.01} />
        </g>
        <circle cx={0.93} cy={-0.36} r={0.022} fill="#5ccf5e" />
      </>
    ),
  },
  {
    key: 'bolt',
    label: 'Charger',
    draw: () => (
      <>
        <rect x={-0.9} y={-0.9} width={1.8} height={1.8} rx={0.4} fill="var(--c-dock)" stroke="#fff" strokeWidth={0.5} />
        <path d="M0.15,-0.7 L-0.4,0.1 L-0.02,0.1 L-0.15,0.7 L0.4,-0.1 L0.02,-0.1 Z" fill="#fff" />
      </>
    ),
  },
  {
    key: 'house',
    label: 'House',
    draw: () => (
      <>
        <path d="M0,-1 L1,-0.1 L0.75,-0.1 L0.75,0.9 L-0.75,0.9 L-0.75,-0.1 L-1,-0.1 Z" fill="var(--c-dock)" stroke="#fff" strokeWidth={0.5} />
        <rect x={-0.22} y={0.3} width={0.44} height={0.6} fill="#fff" />
      </>
    ),
  },
  {
    key: 'plug',
    label: 'Plug',
    draw: () => (
      <>
        <circle r={0.9} fill="var(--c-dock)" stroke="#fff" strokeWidth={0.5} />
        <rect x={-0.4} y={-0.35} width={0.2} height={0.7} rx={0.08} fill="#fff" />
        <rect x={0.2} y={-0.35} width={0.2} height={0.7} rx={0.08} fill="#fff" />
      </>
    ),
  },
  {
    key: 'ghost',
    label: 'Ghost',
    draw: () => (
      <>
        <path
          d="M-0.85,0.9 L-0.85,-0.1 C-0.85,-1.05 0.85,-1.05 0.85,-0.1 L0.85,0.9 L0.57,0.65 L0.28,0.9 L0,0.65 L-0.28,0.9 L-0.57,0.65 Z"
          fill="var(--c-dock)"
          stroke="#fff"
          strokeWidth={0.5}
        />
        <circle cx={-0.3} cy={-0.2} r={0.22} fill="#fff" />
        <circle cx={0.3} cy={-0.2} r={0.22} fill="#fff" />
        <circle cx={-0.24} cy={-0.18} r={0.1} fill="#1a237e" />
        <circle cx={0.36} cy={-0.18} r={0.1} fill="#1a237e" />
      </>
    ),
  },
  {
    key: 'flag',
    label: 'Flag',
    draw: () => (
      <>
        <line x1={-0.6} y1={1} x2={-0.6} y2={-1} stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
        <path d="M-0.55,-0.95 L0.9,-0.6 L-0.55,-0.2 Z" fill="var(--c-dock)" stroke="#fff" strokeWidth={0.4} />
      </>
    ),
  },
  {
    key: 'shed',
    label: 'Garden shed',
    draw: () => (
      <>
        <rect x={-0.78} y={-0.2} width={1.56} height={1.12} fill="#a1714a" stroke="#fff" strokeWidth={0.06} />
        <path d="M-0.78,0.08 L0.78,0.08 M-0.78,0.36 L0.78,0.36 M-0.78,0.64 L0.78,0.64" stroke="#7b5233" strokeWidth={0.05} />
        <path d="M-1,-0.12 L0,-1 L1,-0.12 L0.82,-0.12 L0,-0.82 L-0.82,-0.12 Z" fill="var(--c-dock)" stroke="#fff" strokeWidth={0.06} />
        <path d="M-0.82,-0.12 L0,-0.82 L0.82,-0.12 Z" fill="var(--c-dock)" opacity={0.7} />
        <rect x={-0.22} y={0.22} width={0.44} height={0.7} fill="#5d3b22" />
        <circle cx={0.13} cy={0.58} r={0.04} fill="#ffd54f" />
        <rect x={0.36} y={0.02} width={0.3} height={0.26} fill="#bbdefb" stroke="#5d3b22" strokeWidth={0.05} />
        <rect x={-0.66} y={0.02} width={0.3} height={0.26} fill="#bbdefb" stroke="#5d3b22" strokeWidth={0.05} />
      </>
    ),
  },
];

export function mowerIcon(key: string | undefined) {
  return MOWER_ICONS.find((i) => i.key === key) ?? MOWER_ICONS[0];
}

// an icon as it's drawn without the mower's sizes: a real mower as narrow as it is
export function drawMower(icon: MowerIcon, o?: Parameters<MowerIcon['draw']>[0]) {
  return icon.fit ? <g transform={`scale(1 ${icon.fit})`}>{icon.draw(o)}</g> : icon.draw(o);
}

// a dock icon for the settings, a station from above with its tower up
export function drawDock(icon: (typeof DOCK_ICONS)[number]) {
  return icon.real ? <g transform="rotate(-90)">{icon.draw()}</g> : icon.draw();
}

export function dockIcon(key: string | undefined) {
  return DOCK_ICONS.find((i) => i.key === key) ?? DOCK_ICONS[0];
}
