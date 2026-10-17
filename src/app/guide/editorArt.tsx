'use client';

import {anim, Scene} from './art';

// the drawings of the editor guide: the map as the app shows it, a finger doing what the step says

type P = [number, number];
const poly = (pts: P[]) => 'M' + pts.map(([x, y]) => `${x} ${y}`).join(' L') + ' Z';

const MOW = 'var(--c-mow)';
const PICK = 'var(--c-selected)';
const VERTEX = 'var(--c-vertex)';

function MapGround() {
  return (
    <>
      <rect width={320} height={200} fill="#11171c" />
      {Array.from({length: 16}, (_, i) => (
        <path key={`v${i}`} d={`M${i * 20} 0 V200`} stroke="#fff" strokeOpacity={0.05} />
      ))}
      {Array.from({length: 10}, (_, i) => (
        <path key={`h${i}`} d={`M0 ${i * 20} H320`} stroke="#fff" strokeOpacity={0.05} />
      ))}
    </>
  );
}

function Area({d, color = MOW, fill = 0.25, width = 2}: {d: string; color?: string; fill?: number; width?: number}) {
  return <path d={d} fill={color} fillOpacity={fill} stroke={color} strokeWidth={width} strokeLinejoin="round" />;
}

function Dot({x, y, r = 3.4}: {x: number; y: number; r?: number}) {
  return <circle cx={x} cy={y} r={r} fill={VERTEX} stroke="#fff" strokeWidth={1.2} />;
}

// a fingertip: where it goes over the loop, and a ring where it taps
function Finger({dur, times, xs, ys, show}: {dur: number; times: number[]; xs: number[]; ys: number[]; show: [number, number]}) {
  return (
    <circle r={11} fill="#fff" fillOpacity={0.35} stroke="#fff" strokeOpacity={0.9} strokeWidth={1.5} opacity={0}>
      {anim('cx', dur, times, xs)}
      {anim('cy', dur, times, ys)}
      {anim('opacity', dur, [0, show[0], show[0] + 0.03, show[1], show[1] + 0.03, 1], [0, 0, 1, 1, 0, 0])}
    </circle>
  );
}

function Tap({x, y, dur, at}: {x: number; y: number; dur: number; at: number}) {
  return (
    <circle cx={x} cy={y} r={10} fill="none" stroke="#fff" strokeWidth={2} opacity={0}>
      {anim('r', dur, [0, at, at + 0.07, 1], [10, 10, 24, 24])}
      {anim('opacity', dur, [0, at, at + 0.01, at + 0.07, 1], [0, 0, 0.9, 0, 0])}
    </circle>
  );
}

// the button that applies a split or a merge, as a round check
function ApplyButton({dur, from, to}: {dur: number; from: number; to: number}) {
  return (
    <g opacity={0}>
      {anim('opacity', dur, [0, from, from + 0.02, to, to + 0.02, 1], [0, 0, 1, 1, 0, 0])}
      <circle cx={288} cy={176} r={14} fill="var(--accent)" />
      <path d="M281 176 l5 5 l9 -10" stroke="#fff" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

// 1: tap an area, its points show up
const A: P[] = [
  [40, 40],
  [150, 30],
  [175, 95],
  [140, 165],
  [50, 160],
  [30, 100],
];
const B: P[] = [
  [195, 40],
  [290, 50],
  [285, 160],
  [200, 170],
  [185, 110],
];

function Select() {
  const dur = 6;
  return (
    <Scene still={dur * 0.6} label="">
      <MapGround />
      <Area d={poly(A)} />
      <Area d={poly(B)} />
      <circle cx={95} cy={100} r={16} fill="var(--c-obstacle)" fillOpacity={0.25} stroke="var(--c-obstacle)" strokeWidth={2} />
      <g opacity={0}>
        {anim('opacity', dur, [0, 0.27, 0.3, 0.92, 1], [0, 0, 1, 1, 0])}
        <path d={poly(A)} fill="none" stroke={PICK} strokeWidth={3} strokeLinejoin="round" />
        {A.map(([x, y]) => (
          <Dot key={`${x},${y}`} x={x} y={y} />
        ))}
      </g>
      <Finger dur={dur} times={[0, 0.22, 1]} xs={[280, 120, 120]} ys={[185, 135, 135]} show={[0.02, 0.45]} />
      <Tap x={120} y={135} dur={dur} at={0.23} />
    </Scene>
  );
}

// 2: drag a point, pull a new one out between two, delete one
function Points() {
  const dur = 9;
  // with the dot between the first two as a point of its own, on the line at first
  const base: P[] = [[40, 40], [95, 35], [150, 30], [175, 95], [140, 165], [50, 160], [30, 100]];
  const moved = (from: P[], i: number, to: P) => from.map((p, j) => (j === i ? to : p));
  const k2 = moved(base, 3, [206, 108]);
  const k4 = moved(k2, 1, [95, 10]);
  const k6 = moved(k4, 5, [85, 132.5]);
  // the point only goes once its delete button is tapped
  const times = [0, 0.1, 0.27, 0.42, 0.6, 0.72, 0.84, 0.86, 1];
  const shapes = [base, base, k2, k2, k4, k4, k4, k6, k6];
  return (
    <Scene still={dur * 0.7} label="">
      <MapGround />
      <path d={poly(base)} fill={PICK} fillOpacity={0.18} stroke={PICK} strokeWidth={3} strokeLinejoin="round">
        {anim('d', dur, times, shapes.map(poly))}
      </path>
      {[0, 2, 4, 6].map((i) => (
        <Dot key={i} x={base[i][0]} y={base[i][1]} />
      ))}
      <circle cx={175} cy={95} r={3.4} fill={VERTEX} stroke="#fff" strokeWidth={1.2}>
        {anim('cx', dur, [0, 0.1, 0.27, 1], [175, 175, 206, 206])}
        {anim('cy', dur, [0, 0.1, 0.27, 1], [95, 95, 108, 108])}
      </circle>
      {/* the dot between two points: pulled out, it's a point */}
      <circle cx={95} cy={35} r={2.6} fill={VERTEX} fillOpacity={0} stroke={VERTEX} strokeWidth={1.4}>
        {anim('cy', dur, [0, 0.42, 0.6, 1], [35, 35, 10, 10])}
        {anim('fill-opacity', dur, [0, 0.44, 0.47, 1], [0, 0, 1, 1])}
        {anim('r', dur, [0, 0.44, 0.47, 1], [2.6, 2.6, 3.4, 3.4])}
      </circle>
      <circle cx={50} cy={160} r={3.4} fill={VERTEX} stroke="#fff" strokeWidth={1.2}>
        {anim('opacity', dur, [0, 0.84, 0.86, 1], [1, 1, 0, 0])}
      </circle>
      {/* tapped, the point gets its delete button */}
      <g opacity={0}>
        {anim('opacity', dur, [0, 0.75, 0.77, 0.84, 0.86, 1], [0, 0, 1, 1, 0, 0])}
        <circle cx={68} cy={146} r={9} fill="#e53935" />
        <path d="M64.5 142.5 l7 7 M71.5 142.5 l-7 7" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
      </g>
      <Finger
        dur={dur}
        times={[0, 0.1, 0.27, 0.32, 0.42, 0.6, 0.66, 0.72, 0.78, 0.81, 0.9, 1]}
        xs={[280, 175, 206, 206, 95, 95, 95, 50, 50, 68, 68, 68]}
        ys={[185, 95, 108, 108, 35, 10, 10, 160, 160, 146, 146, 146]}
        show={[0.01, 0.88]}
      />
      <Tap x={50} y={160} dur={dur} at={0.73} />
      <Tap x={68} y={146} dur={dur} at={0.82} />
    </Scene>
  );
}

// 3: a line across, applied: two areas
const WHOLE: P[] = [
  [40, 40],
  [280, 40],
  [285, 165],
  [35, 170],
];
const LEFT: P[] = [
  [40, 40],
  [152.4, 40],
  [167.4, 167.7],
  [35, 170],
];
const RIGHT: P[] = [
  [152.4, 40],
  [280, 40],
  [285, 165],
  [167.4, 167.7],
];

function Split() {
  const dur = 8;
  return (
    <Scene still={dur * 0.8} label="">
      <MapGround />
      <g>
        {anim('opacity', dur, [0, 0.58, 0.6, 1], [1, 1, 0, 0])}
        <Area d={poly(WHOLE)} color={PICK} fill={0.18} width={3} />
        {WHOLE.map(([x, y]) => (
          <Dot key={`${x},${y}`} x={x} y={y} />
        ))}
      </g>
      {/* the cut line: first point, then the second and the line */}
      <g opacity={0}>
        {anim('opacity', dur, [0, 0.15, 0.16, 0.58, 0.6, 1], [0, 0, 1, 1, 0, 0])}
        <circle cx={150} cy={18} r={4} fill="#fff" />
      </g>
      <g opacity={0}>
        {anim('opacity', dur, [0, 0.37, 0.38, 0.58, 0.6, 1], [0, 0, 1, 1, 0, 0])}
        <path d="M150 18 L170 192" stroke="#fff" strokeWidth={2.4} strokeDasharray="6 5" />
        <circle cx={170} cy={192} r={4} fill="#fff" />
      </g>
      <g opacity={0}>
        {anim('opacity', dur, [0, 0.6, 0.64, 0.92, 1], [0, 0, 1, 1, 0])}
        <g>
          <animateTransform attributeName="transform" type="translate" dur={`${dur}s`} repeatCount="indefinite" keyTimes="0;0.6;0.68;1" values="0 0;0 0;-5 0;-5 0" />
          <Area d={poly(LEFT)} />
        </g>
        <g>
          <animateTransform attributeName="transform" type="translate" dur={`${dur}s`} repeatCount="indefinite" keyTimes="0;0.6;0.68;1" values="0 0;0 0;5 0;5 0" />
          <Area d={poly(RIGHT)} />
        </g>
      </g>
      <ApplyButton dur={dur} from={0.38} to={0.58} />
      <Finger dur={dur} times={[0, 0.13, 0.2, 0.34, 0.42, 0.52, 1]} xs={[280, 150, 150, 170, 170, 288, 288]} ys={[185, 18, 18, 192, 192, 176, 176]} show={[0.01, 0.6]} />
      <Tap x={150} y={18} dur={dur} at={0.14} />
      <Tap x={170} y={192} dur={dur} at={0.35} />
      <Tap x={288} y={176} dur={dur} at={0.53} />
    </Scene>
  );
}

// 4: one area picked, then the other one: one area from both
const L: P[] = [
  [40, 50],
  [160, 40],
  [170, 160],
  [45, 165],
];
const R: P[] = [
  [155, 60],
  [280, 55],
  [275, 170],
  [162, 150],
];
const BOTH: P[] = [
  [40, 50],
  [160, 40],
  [161.6, 59.7],
  [280, 55],
  [275, 170],
  [169.3, 151.3],
  [170, 160],
  [45, 165],
];

function Merge() {
  const dur = 8;
  return (
    <Scene still={dur * 0.8} label="">
      <MapGround />
      <g>
        {anim('opacity', dur, [0, 0.5, 0.53, 1], [1, 1, 0, 0])}
        <Area d={poly(L)} />
        <Area d={poly(R)} />
        <g opacity={0}>
          {anim('opacity', dur, [0, 0.15, 0.17, 1], [0, 0, 1, 1])}
          <path d={poly(L)} fill="none" stroke={PICK} strokeWidth={3} strokeLinejoin="round" />
        </g>
      </g>
      <g opacity={0}>
        {anim('opacity', dur, [0, 0.5, 0.55, 0.92, 1], [0, 0, 1, 1, 0])}
        <Area d={poly(BOTH)} color={PICK} fill={0.2} width={3} />
        {BOTH.map(([x, y]) => (
          <Dot key={`${x},${y}`} x={x} y={y} />
        ))}
      </g>
      <Finger dur={dur} times={[0, 0.13, 0.22, 0.42, 1]} xs={[280, 100, 100, 225, 225]} ys={[185, 105, 105, 115, 115]} show={[0.01, 0.6]} />
      <Tap x={100} y={105} dur={dur} at={0.14} />
      <Tap x={225} y={115} dur={dur} at={0.43} />
    </Scene>
  );
}

// 5: a recorded edge with a point every few cm, the slider takes out the ones that barely matter
const BLOB = (n: number, wobble: number): P[] =>
  Array.from({length: n}, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const r = 1 + wobble * (0.035 * Math.sin(7 * a) + 0.02 * Math.sin(13 * a + 1) + 0.012 * Math.sin(29 * a + 2));
    return [Math.round((160 + 118 * r * Math.cos(a)) * 10) / 10, Math.round((86 + 62 * r * Math.sin(a)) * 10) / 10];
  });
const DENSE = BLOB(64, 1);
const FEW = BLOB(10, 0.4);

function Reduce() {
  const dur = 8;
  // the slider's knob from the left end towards the right
  const [x0, x1] = [104, 196];
  return (
    <Scene still={dur * 0.7} label="">
      <MapGround />
      <g>
        {anim('opacity', dur, [0, 0.32, 0.4, 1], [1, 1, 0, 0])}
        <Area d={poly(DENSE)} color={PICK} fill={0.18} width={2.5} />
        {DENSE.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2} fill={VERTEX} stroke="#fff" strokeWidth={0.6} />
        ))}
      </g>
      <g opacity={0}>
        {anim('opacity', dur, [0, 0.32, 0.4, 0.92, 1], [0, 0, 1, 1, 0])}
        <Area d={poly(FEW)} color={PICK} fill={0.18} width={2.5} />
        {FEW.map(([x, y], i) => (
          <Dot key={i} x={x} y={y} />
        ))}
      </g>
      <path d={`M${x0} 178 H216`} stroke="#fff" strokeOpacity={0.3} strokeWidth={4} strokeLinecap="round" />
      <path d={`M${x0} 178 H${x0}`} stroke="var(--accent)" strokeWidth={4} strokeLinecap="round">
        {anim('d', dur, [0, 0.14, 0.42, 1], [`M${x0} 178 H${x0}`, `M${x0} 178 H${x0}`, `M${x0} 178 H${x1}`, `M${x0} 178 H${x1}`])}
      </path>
      <circle cx={x0} cy={178} r={7} fill="#fff">
        {anim('cx', dur, [0, 0.14, 0.42, 1], [x0, x0, x1, x1])}
      </circle>
      <Finger dur={dur} times={[0, 0.12, 0.14, 0.42, 1]} xs={[280, x0, x0, x1, x1]} ys={[192, 178, 178, 178, 178]} show={[0.01, 0.5]} />
    </Scene>
  );
}

export const EDITOR_ART = [Select, Points, Split, Merge, Reduce];
