'use client';

import {CheckIcon, MergeIcon, ScissorsIcon, SimplifyIcon, TrashIcon} from '@/components/icons';
import {useId} from 'react';
import {anim, Lawn, ROOF, Scene, STONE, Tree} from './art';

// the drawings of the editor guide: the garden from above with the map on it, as the editor shows it over the aerial
// imagery, a hand doing what the step says and the editor's buttons below

type P = [number, number];
const poly = (pts: P[]) => 'M' + pts.map(([x, y]) => `${x} ${y}`).join(' L') + ' Z';
const moved = (from: P[], i: number, to: P) => from.map((p, j) => (j === i ? to : p));

const MOW = 'var(--c-mow)';
const PICK = 'var(--c-selected)';
const VERTEX = 'var(--c-vertex)';
const BLOCK = 'var(--c-obstacle)';

// the two lawns, and their areas on the map a little inside them like recorded ones
const LEFT_LAWN = 'M14 40 Q14 34 20 34 H146 Q152 34 152 40 V142 Q152 150 144 150 H22 Q14 150 14 142 Z';
const RIGHT_LAWN = 'M168 40 Q168 34 174 34 H300 Q306 34 306 40 V142 Q306 150 298 150 H176 Q168 150 168 142 Z';
const LA: P[] = [[22, 44], [84, 39], [143, 44], [144, 141], [80, 144], [23, 141]];
const RA: P[] = [[177, 43], [298, 43], [298, 141], [177, 141]];
const TREE = {x: 58, y: 90};
const BED = {x: 214, y: 70, w: 50, h: 28};

function Bed() {
  return (
    <>
      <rect x={BED.x} y={BED.y} width={BED.w} height={BED.h} rx={6} fill="#6d4c36" />
      {[0, 1, 2, 3, 4].map((i) => (
        <circle key={i} cx={BED.x + 8 + i * 8.5} cy={BED.y + (i % 2 ? 10 : 18)} r={3} fill={['#ff6f91', '#ffd54f', '#ba68c8'][i % 3]} />
      ))}
    </>
  );
}

function BedOnMap() {
  return <rect x={BED.x - 6} y={BED.y - 6} width={BED.w + 12} height={BED.h + 12} rx={8} fill={BLOCK} fillOpacity={0.25} stroke={BLOCK} strokeWidth={2} />;
}

function Garden({right = true}: {right?: boolean}) {
  return (
    <>
      <rect width={320} height={200} fill={STONE} />
      <rect x={152} y={0} width={16} height={200} fill="#b8b0a1" />
      <rect x={118} y={0} width={84} height={22} fill={ROOF} />
      <path d="M118 11 H202" stroke="#9aa0ab" strokeWidth={1.5} />
      <Lawn d={LEFT_LAWN} />
      <Lawn d={RIGHT_LAWN} />
      <Tree {...TREE} />
      <Bed />
      {/* the editor dims the imagery a little so the map stands out */}
      <rect width={320} height={200} fill="#000" opacity={0.22} />
      <circle cx={TREE.x} cy={TREE.y} r={22} fill={BLOCK} fillOpacity={0.25} stroke={BLOCK} strokeWidth={2} />
      {right && (
        <>
          <Area pts={RA} />
          <BedOnMap />
        </>
      )}
    </>
  );
}

function Area({pts, color = MOW, fill = 0.22, width = 2}: {pts: P[]; color?: string; fill?: number; width?: number}) {
  return <path d={poly(pts)} fill={color} fillOpacity={fill} stroke={color} strokeWidth={width} strokeLinejoin="round" />;
}

function Dot({x, y, r = 3.6}: {x: number; y: number; r?: number}) {
  return <circle cx={x} cy={y} r={r} fill={VERTEX} stroke="#fff" strokeWidth={1.3} />;
}

// a pointing hand, the tip of the index finger at its origin, the other fingers curled and the thumb out to the side
const HAND =
  'M-5 23 L-5 5 A5 5 0 0 1 5 5 L5 18 Q5 14 9 14 Q13 14 13 18 Q13 16 16.5 16 Q20 16 20 20 Q20.5 18.5 23 19.5 ' +
  'Q26 21 25.5 25 L25 37 Q24 47 15 51 L2 51 Q-6 49 -8 41 L-14 34 Q-17 30 -13 28 L-6 32 Z';

// press: the stretches of the loop it touches the screen, pushed in a little meanwhile
function Hand({dur, times, at, show, press}: {dur: number; times: number[]; at: P[]; show: [number, number]; press: [number, number][]}) {
  const id = useId();
  const keys = [0];
  const scale = [1];
  for (const [a, b] of press) {
    keys.push(a - 0.012, a, b, b + 0.012);
    scale.push(1, 0.88, 0.88, 1);
  }
  keys.push(1);
  scale.push(1);
  return (
    <g opacity={0}>
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dfe5eb" />
        </linearGradient>
        <filter id={`${id}s`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={1.8} />
        </filter>
      </defs>
      <animateTransform attributeName="transform" type="translate" dur={`${dur}s`} repeatCount="indefinite" keyTimes={times.join(';')} values={at.map(([x, y]) => `${x} ${y}`).join(';')} />
      {anim('opacity', dur, [0, show[0], show[0] + 0.03, show[1], show[1] + 0.03, 1], [0, 0, 1, 1, 0, 0])}
      <g>
        <animateTransform attributeName="transform" type="scale" dur={`${dur}s`} repeatCount="indefinite" keyTimes={keys.join(';')} values={scale.join(';')} />
        <g transform="rotate(-15) scale(0.9)">
          <path d={HAND} transform="translate(3 5)" fill="#000" opacity={0.3} filter={`url(#${id}s)`} />
          <path d={HAND} fill={`url(#${id}f)`} stroke="#56616c" strokeWidth={1.3} strokeLinejoin="round" />
          <path d="M-3 6 Q-3 2.2 0 2.2 Q3 2.2 3 6 L3 9 Q0 10.5 -3 9 Z" fill="#f6f8fa" stroke="#c4ccd4" strokeWidth={0.7} />
          <path d="M-3 15 Q0 16.5 3 15" stroke="#bcc5ce" strokeWidth={0.9} fill="none" strokeLinecap="round" />
          <path d="M13 18 Q13.6 21 12.6 24.5 M20 20 Q20.6 23 19.6 26.5" stroke="#bcc5ce" strokeWidth={0.9} fill="none" strokeLinecap="round" />
          <path d="M-7.5 34.5 Q-9.5 36 -10.5 38" stroke="#bcc5ce" strokeWidth={0.9} fill="none" strokeLinecap="round" />
        </g>
      </g>
    </g>
  );
}

// a tap at t of the loop, and how long the finger stays down for it
const taps = (...ts: number[]): [number, number][] => ts.map((t) => [t - 0.005, t + 0.03]);

function Tap({x, y, dur, at}: {x: number; y: number; dur: number; at: number}) {
  return (
    <circle cx={x} cy={y} r={8} fill="none" stroke="#fff" strokeWidth={2} opacity={0}>
      {anim('r', dur, [0, at, at + 0.06, 1], [8, 8, 20, 20])}
      {anim('opacity', dur, [0, at, at + 0.01, at + 0.06, 1], [0, 0, 0.95, 0, 0])}
    </circle>
  );
}

// the bar under the map, sliding up once an area is picked: split, merge, reduce points, delete
const BAR = {x: 64, y: 160, w: 192, h: 32};
const TOOLS = [ScissorsIcon, MergeIcon, SimplifyIcon, TrashIcon];
const toolX = (i: number) => BAR.x + 8 + i * 46;
const toolAt = (i: number): P => [toolX(i) + 19, BAR.y + 16];

function Bar({dur, upAt, goneAt, used}: {dur: number; upAt: number; goneAt?: number; used?: {tool: number; at: number}}) {
  const end = goneAt ?? 0.95;
  // already up when the loop starts: just there, faded out at the end
  const slide = upAt > 0;
  return (
    <g opacity={slide ? 0 : 1}>
      {slide && (
        <animateTransform attributeName="transform" type="translate" dur={`${dur}s`} repeatCount="indefinite" keyTimes={`0;${upAt};${upAt + 0.05};1`} values="0 44;0 44;0 0;0 0" />
      )}
      {slide
        ? anim('opacity', dur, [0, upAt, upAt + 0.03, end, end + 0.03, 1], [0, 0, 1, 1, 0, 0])
        : anim('opacity', dur, [0, end, end + 0.03, 1], [1, 1, 0, 0])}
      <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={12} fill="#161b21" fillOpacity={0.94} stroke="#fff" strokeOpacity={0.14} />
      {TOOLS.map((Icon, i) => (
        <g key={i}>
          <rect x={toolX(i)} y={BAR.y + 4} width={38} height={24} rx={8} fill="#fff" fillOpacity={0.08} stroke="#fff" strokeOpacity={0.12} />
          {used?.tool === i && (
            <rect x={toolX(i)} y={BAR.y + 4} width={38} height={24} rx={8} fill="var(--accent)" opacity={0}>
              {anim('opacity', dur, [0, used.at, used.at + 0.02, 1], [0, 0, 0.9, 0.9])}
            </rect>
          )}
          <g transform={`translate(${toolX(i) + 11} ${BAR.y + 8})`} color={i === 3 ? '#ff8a80' : '#e8edf2'}>
            <Icon size={16} />
          </g>
        </g>
      ))}
    </g>
  );
}

// what comes in the bar's place while a tool is under way: cancel and apply, and a slider for reduce points
const SLIDE: [number, number] = [BAR.x + 44, BAR.x + 126];
const APPLY: P = [BAR.x + BAR.w - 28, BAR.y + 16];

function ApplyBar({dur, from, to, slider}: {dur: number; from: number; to: number; slider?: {from: number; to: number}}) {
  const [x0, x1] = SLIDE;
  const y = BAR.y + 16;
  return (
    <g opacity={0}>
      {anim('opacity', dur, [0, from, from + 0.03, to, to + 0.03, 1], [0, 0, 1, 1, 0, 0])}
      <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={12} fill="#161b21" fillOpacity={0.94} stroke="#fff" strokeOpacity={0.14} />
      <path d={`M${BAR.x + 13} ${BAR.y + 11} l10 10 M${BAR.x + 23} ${BAR.y + 11} l-10 10`} stroke="#e8edf2" strokeWidth={2} strokeLinecap="round" />
      {slider && (
        <>
          <path d={`M${x0} ${y} H${x1 + 30}`} stroke="#fff" strokeOpacity={0.25} strokeWidth={4} strokeLinecap="round" />
          <path d={`M${x0} ${y} H${x0}`} stroke="var(--accent)" strokeWidth={4} strokeLinecap="round">
            {anim('d', dur, [0, slider.from, slider.to, 1], [`M${x0} ${y} H${x0}`, `M${x0} ${y} H${x0}`, `M${x0} ${y} H${x1}`, `M${x0} ${y} H${x1}`])}
          </path>
          <circle cx={x0} cy={y} r={7} fill="#fff">
            {anim('cx', dur, [0, slider.from, slider.to, 1], [x0, x0, x1, x1])}
          </circle>
        </>
      )}
      <rect x={BAR.x + BAR.w - 48} y={BAR.y + 4} width={40} height={24} rx={8} fill="var(--accent)" />
      <g transform={`translate(${BAR.x + BAR.w - 36} ${BAR.y + 8})`} color="#fff">
        <CheckIcon size={16} />
      </g>
    </g>
  );
}

// the picked area with its points on top: shown from..to of the loop
function Picked({pts, from, to, dur}: {pts: P[]; from: number; to: number; dur: number}) {
  return (
    <g opacity={from > 0 ? 0 : 1}>
      {from > 0
        ? anim('opacity', dur, [0, from, from + 0.02, to, to + 0.02, 1], [0, 0, 1, 1, 0, 0])
        : anim('opacity', dur, [0, to, to + 0.02, 1], [1, 1, 0, 0])}
      <Area pts={pts} color={PICK} fill={0.18} width={3} />
      {pts.map(([x, y]) => (
        <Dot key={`${x},${y}`} x={x} y={y} />
      ))}
    </g>
  );
}

// 1: tap an area: it's picked, its points show up and the bar comes up
function Select() {
  const dur = 6;
  return (
    <Scene still={dur * 0.6} label="">
      <Garden />
      <Area pts={LA} />
      <g opacity={0}>
        {anim('opacity', dur, [0, 0.27, 0.3, 0.93, 1], [0, 0, 1, 1, 0])}
        <Area pts={LA} color={PICK} fill={0.18} width={3} />
        {LA.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={0} fill={VERTEX} stroke="#fff" strokeWidth={1.3}>
            {anim('r', dur, [0, 0.28 + i * 0.015, 0.31 + i * 0.015, 0.33 + i * 0.015, 1], [0, 0, 5, 3.6, 3.6])}
          </circle>
        ))}
      </g>
      <Bar dur={dur} upAt={0.33} />
      <Hand dur={dur} times={[0, 0.2, 1]} at={[[300, 215], [104, 118], [104, 118]]} show={[0.02, 0.4]} press={taps(0.22)} />
      <Tap x={104} y={118} dur={dur} at={0.22} />
    </Scene>
  );
}

// 2: a dent dragged out to the edge, a cut off corner pulled back out between two points, a stray point deleted
function Points() {
  const dur = 9;
  // the dot between the two points by the corner as a point of its own, on the line at first
  const base: P[] = [[22, 44], [120, 40], [132.5, 55], [145, 70], [144, 141], [80, 126], [23, 141], [15, 92]];
  const k2 = moved(base, 5, [82, 146]);
  const k4 = moved(k2, 2, [145, 42]);
  const k6 = moved(k4, 7, [22.5, 92.5]);
  // the point only goes once its delete button is tapped
  const times = [0, 0.1, 0.27, 0.42, 0.6, 0.72, 0.84, 0.86, 1];
  const shapes = [base, base, k2, k2, k4, k4, k4, k6, k6];
  const bin: P = [36, 78];
  return (
    <Scene still={dur * 0.7} label="">
      <Garden />
      <path d={poly(base)} fill={PICK} fillOpacity={0.18} stroke={PICK} strokeWidth={3} strokeLinejoin="round">
        {anim('d', dur, times, shapes.map(poly))}
      </path>
      {[0, 1, 3, 4, 6].map((i) => (
        <Dot key={i} x={base[i][0]} y={base[i][1]} />
      ))}
      <circle cx={base[5][0]} cy={base[5][1]} r={3.6} fill={VERTEX} stroke="#fff" strokeWidth={1.3}>
        {anim('cx', dur, [0, 0.1, 0.27, 1], [base[5][0], base[5][0], 82, 82])}
        {anim('cy', dur, [0, 0.1, 0.27, 1], [base[5][1], base[5][1], 146, 146])}
        {anim('r', dur, [0, 0.1, 0.12, 0.27, 0.29, 1], [3.6, 3.6, 5.5, 5.5, 3.6, 3.6])}
      </circle>
      {/* the dot between two points: pulled out, it's a point */}
      <circle cx={base[2][0]} cy={base[2][1]} r={2.8} fill={VERTEX} fillOpacity={0} stroke="#fff" strokeWidth={1.4}>
        {anim('cx', dur, [0, 0.42, 0.6, 1], [base[2][0], base[2][0], 145, 145])}
        {anim('cy', dur, [0, 0.42, 0.6, 1], [base[2][1], base[2][1], 42, 42])}
        {anim('fill-opacity', dur, [0, 0.44, 0.47, 1], [0, 0, 1, 1])}
        {anim('r', dur, [0, 0.44, 0.47, 1], [2.8, 2.8, 3.6, 3.6])}
      </circle>
      <circle cx={base[7][0]} cy={base[7][1]} r={3.6} fill={VERTEX} stroke="#fff" strokeWidth={1.3}>
        {anim('opacity', dur, [0, 0.84, 0.86, 1], [1, 1, 0, 0])}
      </circle>
      {/* tapped, the point gets its delete button */}
      <g opacity={0}>
        {anim('opacity', dur, [0, 0.75, 0.77, 0.84, 0.86, 1], [0, 0, 1, 1, 0, 0])}
        <circle cx={bin[0]} cy={bin[1]} r={11} fill="#e53935" stroke="#fff" strokeWidth={1.5} />
        <g transform={`translate(${bin[0] - 7} ${bin[1] - 7})`} color="#fff">
          <TrashIcon size={14} />
        </g>
      </g>
      <Bar dur={dur} upAt={-1} />
      <Hand
        dur={dur}
        times={[0, 0.1, 0.27, 0.32, 0.42, 0.6, 0.66, 0.72, 0.78, 0.81, 0.9, 1]}
        at={[[300, 215], base[5], [82, 146], [82, 146], base[2], [145, 42], [145, 42], base[7], base[7], bin, bin, bin]}
        show={[0.01, 0.88]}
        press={[[0.1, 0.27], [0.42, 0.6], ...taps(0.73, 0.82)]}
      />
      <Tap x={base[7][0]} y={base[7][1]} dur={dur} at={0.73} />
      <Tap x={bin[0]} y={bin[1]} dur={dur} at={0.82} />
    </Scene>
  );
}

// 3: split: the scissors, a line across, apply: two areas
const WHOLE: P[] = [[22, 44], [143, 44], [144, 141], [23, 141]];
const CUT: [P, P] = [[78, 28], [92, 154]];
const across = (y: number) => CUT[0][0] + ((y - CUT[0][1]) / (CUT[1][1] - CUT[0][1])) * (CUT[1][0] - CUT[0][0]);
const LEFT_PART: P[] = [[22, 44], [across(44), 44], [across(141), 141], [23, 141]];
const RIGHT_PART: P[] = [[across(44), 44], [143, 44], [144, 141], [across(141), 141]];

function Split() {
  const dur = 9;
  return (
    <Scene still={dur * 0.85} label="">
      <Garden />
      <Picked pts={WHOLE} from={0} to={0.62} dur={dur} />
      <Bar dur={dur} upAt={-1} goneAt={0.16} used={{tool: 0, at: 0.12}} />
      <ApplyBar dur={dur} from={0.18} to={0.6} />
      {/* the cut line: first point, then the second and the line */}
      <g opacity={0}>
        {anim('opacity', dur, [0, 0.27, 0.28, 0.6, 0.62, 1], [0, 0, 1, 1, 0, 0])}
        <circle cx={CUT[0][0]} cy={CUT[0][1]} r={4} fill="#fff" />
      </g>
      <g opacity={0}>
        {anim('opacity', dur, [0, 0.42, 0.43, 0.6, 0.62, 1], [0, 0, 1, 1, 0, 0])}
        <path d={`M${CUT[0][0]} ${CUT[0][1]} L${CUT[1][0]} ${CUT[1][1]}`} stroke="#fff" strokeWidth={2.4} strokeDasharray="6 5" />
        <circle cx={CUT[1][0]} cy={CUT[1][1]} r={4} fill="#fff" />
      </g>
      <g opacity={0}>
        {anim('opacity', dur, [0, 0.62, 0.66, 0.94, 1], [0, 0, 1, 1, 0])}
        <g>
          <animateTransform attributeName="transform" type="translate" dur={`${dur}s`} repeatCount="indefinite" keyTimes="0;0.62;0.7;1" values="0 0;0 0;-4 0;-4 0" />
          <Area pts={LEFT_PART} />
        </g>
        <g>
          <animateTransform attributeName="transform" type="translate" dur={`${dur}s`} repeatCount="indefinite" keyTimes="0;0.62;0.7;1" values="0 0;0 0;4 0;4 0" />
          <Area pts={RIGHT_PART} />
        </g>
      </g>
      <Hand dur={dur} times={[0, 0.1, 0.16, 0.25, 0.32, 0.4, 0.47, 0.56, 1]} at={[[300, 215], toolAt(0), toolAt(0), CUT[0], CUT[0], CUT[1], CUT[1], APPLY, APPLY]} show={[0.01, 0.64]} press={taps(0.11, 0.26, 0.41, 0.57)} />
      <Tap x={toolAt(0)[0]} y={toolAt(0)[1]} dur={dur} at={0.11} />
      <Tap x={CUT[0][0]} y={CUT[0][1]} dur={dur} at={0.26} />
      <Tap x={CUT[1][0]} y={CUT[1][1]} dur={dur} at={0.41} />
      <Tap x={APPLY[0]} y={APPLY[1]} dur={dur} at={0.57} />
    </Scene>
  );
}

// 4: merge: the button, then the other area, apply: one area from both
const L: P[] = [[22, 44], [143, 44], [150, 141], [23, 141]];
const R: P[] = [[146, 60], [298, 43], [298, 141], [156, 128]];
const BOTH: P[] = [[22, 44], [143, 44], [144.6, 59.6], [298, 43], [298, 141], [156, 128], [149.6, 136.5], [150, 141], [23, 141]];

function Merge() {
  const dur = 9;
  return (
    <Scene still={dur * 0.85} label="">
      <Garden right={false} />
      <BedOnMap />
      <g>
        {anim('opacity', dur, [0, 0.6, 0.63, 1], [1, 1, 0, 0])}
        <Area pts={R} />
        <Area pts={L} color={PICK} fill={0.18} width={3} />
        {L.map(([x, y]) => (
          <Dot key={`${x},${y}`} x={x} y={y} />
        ))}
        {/* the other one, tapped: marked as the one to join */}
        <path d={poly(R)} fill="none" stroke="#fff" strokeWidth={2.5} strokeDasharray="5 4" opacity={0}>
          {anim('opacity', dur, [0, 0.32, 0.34, 1], [0, 0, 1, 1])}
        </path>
      </g>
      <Picked pts={BOTH} from={0.62} to={0.94} dur={dur} />
      <Bar dur={dur} upAt={-1} goneAt={0.16} used={{tool: 1, at: 0.12}} />
      <ApplyBar dur={dur} from={0.18} to={0.6} />
      <Hand dur={dur} times={[0, 0.1, 0.16, 0.3, 0.44, 0.56, 1]} at={[[300, 215], toolAt(1), toolAt(1), [236, 118], [236, 118], APPLY, APPLY]} show={[0.01, 0.64]} press={taps(0.11, 0.31, 0.57)} />
      <Tap x={toolAt(1)[0]} y={toolAt(1)[1]} dur={dur} at={0.11} />
      <Tap x={236} y={118} dur={dur} at={0.31} />
      <Tap x={APPLY[0]} y={APPLY[1]} dur={dur} at={0.57} />
    </Scene>
  );
}

// 5: a recorded edge with a point every few cm: the slider takes out the ones that barely matter
const BLOB = (n: number, wobble: number): P[] =>
  Array.from({length: n}, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const r = 1 + wobble * (0.04 * Math.sin(7 * a) + 0.022 * Math.sin(13 * a + 1) + 0.014 * Math.sin(29 * a + 2));
    return [Math.round((83 + 60 * r * Math.cos(a)) * 10) / 10, Math.round((92 + 48 * r * Math.sin(a)) * 10) / 10];
  });
const DENSE = BLOB(56, 1);
const FEW = BLOB(9, 0.45);

function Reduce() {
  const dur = 9;
  return (
    <Scene still={dur * 0.8} label="">
      <rect width={320} height={200} fill={STONE} />
      <Lawn d="M14 40 Q14 34 20 34 H300 Q306 34 306 40 V142 Q306 150 298 150 H22 Q14 150 14 142 Z" />
      <Bed />
      <rect width={320} height={200} fill="#000" opacity={0.22} />
      <BedOnMap />
      <g>
        {anim('opacity', dur, [0, 0.36, 0.44, 1], [1, 1, 0, 0])}
        <Area pts={DENSE} color={PICK} fill={0.18} width={2.5} />
        {DENSE.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2.1} fill={VERTEX} stroke="#fff" strokeWidth={0.7} />
        ))}
      </g>
      <g opacity={0}>
        {anim('opacity', dur, [0, 0.36, 0.44, 0.94, 1], [0, 0, 1, 1, 0])}
        <Area pts={FEW} color={PICK} fill={0.18} width={2.5} />
        {FEW.map(([x, y], i) => (
          <Dot key={i} x={x} y={y} />
        ))}
      </g>
      <Bar dur={dur} upAt={-1} goneAt={0.16} used={{tool: 2, at: 0.12}} />
      <ApplyBar dur={dur} from={0.18} to={0.66} slider={{from: 0.24, to: 0.46}} />
      <Hand
        dur={dur}
        times={[0, 0.1, 0.16, 0.22, 0.24, 0.46, 0.52, 0.6, 1]}
        at={[[300, 215], toolAt(2), toolAt(2), [SLIDE[0], BAR.y + 16], [SLIDE[0], BAR.y + 16], [SLIDE[1], BAR.y + 16], [SLIDE[1], BAR.y + 16], APPLY, APPLY]}
        show={[0.01, 0.68]}
        press={[...taps(0.11), [0.23, 0.46], ...taps(0.61)]}
      />
      <Tap x={toolAt(2)[0]} y={toolAt(2)[1]} dur={dur} at={0.11} />
      <Tap x={APPLY[0]} y={APPLY[1]} dur={dur} at={0.61} />
    </Scene>
  );
}

export const EDITOR_ART = [Select, Points, Split, Merge, Reduce];
