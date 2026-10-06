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
const yfDots = [-1, 1].flatMap((side) =>
  Array.from({length: 18}, (_, i) => {
    const row = i % 3;
    const col = Math.floor(i / 3);
    return <rect key={`${side}${i}`} x={-0.92 + row * 0.12} y={side * (0.16 + col * 0.08) - 0.015} width={0.03} height={0.03} fill="#111" />;
  }),
);

export const YF_STATION = {length: 0.64, width: 0.44, pins: 0.09}; // m, the pins this far behind the cap's front

export const DOCK_ICONS: {key: string; label: string; real?: typeof YF_STATION; draw: () => React.ReactNode}[] = [
  {key: 'dot', label: 'Dot', draw: () => <circle r={0.65} fill="var(--c-dock)" />},
  {
    key: 'yardforce',
    label: 'YardForce station',
    real: YF_STATION,
    draw: () => (
      <>
        <path
          d="M-0.94,-0.69 L0.48,-0.69 L0.69,-0.6 L0.69,0.6 L0.48,0.69 L-0.94,0.69 Q-1,0.69 -1,0.63 L-1,-0.63 Q-1,-0.69 -0.94,-0.69 Z"
          fill="#2b2b2b"
          stroke="#000"
          strokeWidth={0.75}
        />
        <path d="M0.66,-0.43 L-0.39,-0.64 M0.66,0.43 L-0.39,0.64" stroke="#111" strokeWidth={1.5} strokeLinecap="round" />
        {yfDots}
        <rect x={0.38} y={-0.22} width={0.08} height={0.04} fill="#bdbdbd" />
        <rect x={0.38} y={0.18} width={0.08} height={0.04} fill="#bdbdbd" />
        <path d="M0.45,-0.45 L0.95,-0.42 Q1,-0.41 1,-0.36 L1,0.36 Q1,0.41 0.95,0.42 L0.45,0.45 Q0.42,0.45 0.42,0.41 L0.42,-0.41 Q0.42,-0.45 0.45,-0.45 Z" fill="#f4612b" stroke="#000" strokeWidth={0.75} />
        <rect x={0.57} y={-0.23} width={0.27} height={0.46} rx={0.05} fill="#1e1e1e" />
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
