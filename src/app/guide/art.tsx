'use client';

import {drawDock, type dockIcon} from '@/components/mapIcons';
import {useEffect, useId, useRef} from 'react';

// the drawings of the guide: a garden from above and the map growing on it, in the colors of the map. each one
// loops, with prefers-reduced-motion it stands still on its last picture

type Dock = ReturnType<typeof dockIcon>;
export interface ArtProps {
  dock: Dock;
}

const STONE = '#8f8778';
const ROOF = '#aeb3bd';
const LINE = 2.2;
const FILL = 0.28;

// what the mower drives along while recording, the lawn and its obstacles
const LAWN = 'M24 58 H296 V182 Q296 192 286 192 H34 Q24 192 24 182 Z';
const EDGE = 'M32 124 V66 H288 V178 Q288 184 282 184 H38 Q32 184 32 178 Z';
const TREE = {x: 92, y: 128};
const TREE_AROUND = 'M117 128 A25 25 0 1 1 67 128 A25 25 0 1 1 117 128 Z';
const POND = {x: 236, y: 132};
const POND_AROUND = 'M271 132 A35 26 0 1 1 201 132 A35 26 0 1 1 271 132 Z';

export function Scene({children, still, label}: {children: React.ReactNode; still: number; label: string}) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    ref.current?.pauseAnimations();
    ref.current?.setCurrentTime(still);
  }, [still]);
  return (
    <svg ref={ref} viewBox="0 0 320 200" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

// fractions of the loop, the values to go through at those
export const anim = (attr: string, dur: number, times: number[], values: (number | string)[]) => (
  <animate attributeName={attr} dur={`${dur}s`} repeatCount="indefinite" keyTimes={times.join(';')} values={values.join(';')} />
);

// a line that is drawn along while it plays: from t0 to t1 of the loop
function Drawn({d, color, dur, t0, t1, fill, f0, f1, dash}: {d: string; color: string; dur: number; t0: number; t1: number; fill?: boolean; f0?: number; f1?: number; dash?: boolean}) {
  return (
    <>
      {fill && (
        <path d={d} fill={color} opacity={0}>
          {anim('opacity', dur, [0, f0!, f1!, 1], [0, 0, FILL, FILL])}
        </path>
      )}
      <path d={d} pathLength={1} fill="none" stroke={color} strokeWidth={LINE} strokeLinejoin="round" strokeDasharray="1 1" strokeDashoffset={1}>
        {anim('stroke-dashoffset', dur, [0, t0, t1, 1], [1, 1, 0, 0])}
      </path>
      {dash && <path d={d} fill="none" stroke="#fff" strokeOpacity={0.5} strokeWidth={0.8} strokeDasharray="3 4" />}
    </>
  );
}

function Lawn({d = LAWN}: {d?: string}) {
  const id = useId();
  return (
    <>
      <defs>
        <pattern id={id} width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
          <rect width="26" height="26" fill="#4a873b" />
          <rect width="13" height="26" fill="#539340" />
        </pattern>
      </defs>
      <path d={d} fill={`url(#${id})`} />
    </>
  );
}

function Tree({x, y}: {x: number; y: number}) {
  return (
    <g>
      <ellipse cx={x + 5} cy={y + 6} rx={19} ry={15} fill="#000" opacity={0.2} />
      <circle cx={x} cy={y} r={17} fill="#2e6a2a" />
      <circle cx={x - 6} cy={y - 5} r={9} fill="#3d8236" />
      <circle cx={x + 7} cy={y + 4} r={8} fill="#367732" />
      <circle cx={x + 3} cy={y - 8} r={5} fill="#4a9142" />
    </g>
  );
}

function Pond({x, y}: {x: number; y: number}) {
  return (
    <g>
      <ellipse cx={x} cy={y} rx={27} ry={18} fill="#a9d8f2" />
      <ellipse cx={x} cy={y + 1} rx={23} ry={14.5} fill="#3d8fcf" />
      <path d={`M${x - 12} ${y - 4} q6 -3 12 0`} stroke="#fff" strokeOpacity={0.6} strokeWidth={1.2} fill="none" strokeLinecap="round" />
    </g>
  );
}

function House() {
  return (
    <g>
      <rect x={100} y={0} width={120} height={40} fill={ROOF} />
      <path d="M100 20 H220" stroke="#9aa0ab" strokeWidth={2} />
      <path d="M100 0 L112 20 L100 40 M220 0 L208 20 L220 40" stroke="#9aa0ab" strokeWidth={1.2} fill="none" />
      <rect x={124} y={40} width={72} height={16} fill="#a59c8c" />
    </g>
  );
}

// the station with the way in facing down, the mower drives up into it
function Station({dock, x, y, size}: {dock: Dock; x: number; y: number; size: number}) {
  const shadow = useId();
  // the shadow it casts on the ground, off to the lower right like the others
  return (
    <>
      <defs>
        <filter id={shadow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceAlpha" stdDeviation={size / 14} />
          <feOffset dx={size / 9} dy={size / 7} />
          <feComponentTransfer>
            <feFuncA type="linear" slope={0.45} />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${shadow})`}>
        <g className="icon" transform={`translate(${x} ${y}) scale(${size})`}>
          {drawDock(dock)}
        </g>
      </g>
    </>
  );
}

// the edge of the garden: a hedge along the top
function Hedge({y = 0, h = 22}: {y?: number; h?: number}) {
  return (
    <g>
      <rect y={y} width={320} height={h} fill="#2c5f28" />
      {Array.from({length: 17}, (_, i) => (
        <circle key={i} cx={i * 20 + (i % 2) * 6} cy={y + h - 2} r={10 + (i % 3) * 2} fill={i % 2 ? '#356f30' : '#2f662b'} />
      ))}
    </g>
  );
}

// the guide's own mower from above, facing right: a white shell, the lid in the green of the logo, the stop button
// and the gps antenna on top
function GuideMower() {
  const lid = useId();
  return (
    <g>
      <defs>
        <linearGradient id={lid} x1="0" y1="-1" x2="0" y2="1">
          <stop offset="0" stopColor="#8fe07c" />
          <stop offset="1" stopColor="#35a64f" />
        </linearGradient>
      </defs>
      <ellipse cx={-0.05} cy={0.12} rx={1.05} ry={0.82} fill="#000" opacity={0.22} />
      {[-1, 1].map((side) => (
        <g key={side}>
          <rect x={-0.82} y={side * 0.66 - 0.17} width={0.62} height={0.34} rx={0.1} fill="#262626" />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M${-0.74 + i * 0.14} ${side * 0.66 - 0.15} v0.3`} stroke="#4a4a4a" strokeWidth={0.05} />
          ))}
        </g>
      ))}
      <rect x={-0.92} y={-0.62} width={1.86} height={1.24} rx={0.5} fill="#f4f6f8" stroke="#c9ced6" strokeWidth={0.05} />
      <path d="M0.62 -0.5 Q0.98 0 0.62 0.5" fill="none" stroke="#c9ced6" strokeWidth={0.06} strokeLinecap="round" />
      <rect x={-0.5} y={-0.42} width={1.02} height={0.84} rx={0.32} fill={`url(#${lid})`} />
      <rect x={-0.42} y={-0.34} width={0.5} height={0.14} rx={0.07} fill="#fff" opacity={0.35} />
      <circle cx={0.26} cy={0} r={0.13} fill="#20262c" />
      <circle cx={0.23} cy={-0.04} r={0.04} fill="#fff" opacity={0.6} />
      <circle cx={-0.7} cy={0} r={0.13} fill="#e53935" stroke="#b71c1c" strokeWidth={0.04} />
    </g>
  );
}

function MowerAt({size, children}: {size: number; children?: React.ReactNode}) {
  return (
    <g>
      {children}
      <g transform={`scale(${size})`}>
        <GuideMower />
      </g>
    </g>
  );
}

function GardenGround() {
  return (
    <>
      <rect width={320} height={200} fill={STONE} />
      <House />
      <Lawn />
      <Tree {...TREE} />
      <Pond {...POND} />
    </>
  );
}

// 1: the garden becomes a map, piece by piece
function Intro({dock}: ArtProps) {
  const dur = 7;
  return (
    <Scene still={dur * 0.9} label="">
      <GardenGround />
      <Station dock={dock} x={56} y={50} size={11} />
      <g transform="translate(56 64) rotate(-90)">
        <MowerAt size={8} />
      </g>
      <g>
        {anim('opacity', dur, [0, 0.93, 1], [1, 1, 0])}
        <Drawn d={EDGE} color="var(--c-mow)" dur={dur} t0={0} t1={0.34} fill f0={0.34} f1={0.41} />
        <Drawn d={TREE_AROUND} color="var(--c-obstacle)" dur={dur} t0={0.41} t1={0.55} fill f0={0.55} f1={0.59} />
        <Drawn d={POND_AROUND} color="var(--c-obstacle)" dur={dur} t0={0.59} t1={0.73} fill f0={0.73} f1={0.77} />
        <circle cx={56} cy={56} r={8} fill="none" stroke="var(--c-dock)" strokeWidth={2.5} opacity={0}>
          {anim('r', dur, [0, 0.77, 0.9, 1], [8, 8, 22, 22])}
          {anim('opacity', dur, [0, 0.77, 0.79, 0.9, 1], [0, 0, 1, 0, 0])}
        </circle>
      </g>
    </Scene>
  );
}

// 2: a meter in front of the station, then straight in until it sits on the contacts
function Docking({dock}: ArtProps) {
  const dur = 7;
  // the mower's middle: start, a meter in front, on the contacts
  const [from, front, docked] = [198, 136, 88];
  const at = (y: number) => (from - y) / (from - docked);
  return (
    <Scene still={dur * 0.85} label="">
      <Lawn d="M0 0 H320 V200 H0 Z" />
      <Hedge />
      <Station dock={dock} x={160} y={66} size={30} />
      {/* how far in front to stop, and the way in that becomes the docking direction */}
      <g opacity={0} color="#fff">
        {anim('opacity', dur, [0, 0.13, 0.16, 0.36, 0.39, 1], [0, 0, 1, 1, 0, 0])}
        <path d={`M204 ${front - 14} V${docked - 8}`} stroke="currentColor" strokeWidth={1.4} strokeDasharray="3 3" />
        <path d={`M198 ${front - 14} H210 M198 ${docked - 8} H210`} stroke="currentColor" strokeWidth={1.4} />
        <text x={214} y={(front + docked) / 2 - 6} fontSize={14} fontWeight={700} fill="currentColor">
          1 m
        </text>
      </g>
      <path d={`M160 ${front} V${docked + 12}`} stroke="var(--c-dock)" strokeWidth={3} strokeLinecap="round" opacity={0}>
        {anim('opacity', dur, [0, 0.38, 0.6, 0.94, 1], [0, 0, 1, 1, 0])}
      </path>
      <g>
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" rotate="auto" calcMode="linear" keyTimes="0;0.15;0.38;0.62;1" keyPoints={`0;${at(front)};${at(front)};1;1`} path={`M160 ${from} V${docked}`} />
        <MowerAt size={15} />
      </g>
      {/* a tap on record docking station while it waits in front */}
      <circle cx={160} cy={front} r={10} fill="none" stroke="#fff" strokeWidth={2} opacity={0}>
        {anim('r', dur, [0, 0.22, 0.32, 1], [10, 10, 30, 30])}
        {anim('opacity', dur, [0, 0.22, 0.23, 0.32, 1], [0, 0, 0.9, 0, 0])}
      </circle>
      {/* on the contacts: charging */}
      <g opacity={0}>
        {anim('opacity', dur, [0, 0.62, 0.65, 0.92, 0.95, 1], [0, 0, 1, 1, 0, 0])}
        <circle cx={160} cy={docked - 30} r={12} fill="#4caf50" />
        <path d={`M155 ${docked - 30} l4 4 l7 -8`} stroke="#fff" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </Scene>
  );
}

// 3: once around the edge, the outline closes by itself and becomes the mowing area
function Outline({dock}: ArtProps) {
  const dur = 8;
  return (
    <Scene still={dur * 0.9} label="">
      <GardenGround />
      <Station dock={dock} x={56} y={50} size={11} />
      <g>
        {anim('opacity', dur, [0, 0.95, 1], [1, 1, 0])}
        <Drawn d={EDGE} color="var(--c-mow)" dur={dur} t0={0} t1={0.75} fill f0={0.75} f1={0.82} />
        <circle cx={32} cy={124} r={4} fill="var(--c-mow)" stroke="#fff" strokeWidth={1.2} />
      </g>
      <g>
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" rotate="auto" calcMode="linear" keyTimes="0;0.75;1" keyPoints="0;1;1" path={EDGE} />
        <MowerAt size={8} />
      </g>
    </Scene>
  );
}

// 4: the lawn is in, now closely around the tree; the pond is done already
function Obstacles({dock}: ArtProps) {
  const dur = 7;
  return (
    <Scene still={dur * 0.9} label="">
      <GardenGround />
      <Station dock={dock} x={56} y={50} size={11} />
      <path d={EDGE} fill="var(--c-mow)" opacity={FILL} />
      <path d={EDGE} fill="none" stroke="var(--c-mow)" strokeWidth={LINE} strokeLinejoin="round" />
      <path d={POND_AROUND} fill="var(--c-obstacle)" opacity={FILL} />
      <path d={POND_AROUND} fill="none" stroke="var(--c-obstacle)" strokeWidth={LINE} />
      <g>
        {anim('opacity', dur, [0, 0.95, 1], [1, 1, 0])}
        <Drawn d={TREE_AROUND} color="var(--c-obstacle)" dur={dur} t0={0} t1={0.62} fill f0={0.62} f1={0.68} />
      </g>
      <g>
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" rotate="auto" calcMode="linear" keyTimes="0;0.62;1" keyPoints="0;1;1" path={TREE_AROUND} />
        <MowerAt size={8} />
      </g>
    </Scene>
  );
}

// 5: everything a map has, two lawns joined by a way across the path
const LEFT = 'M18 50 H146 V182 Q146 190 138 190 H26 Q18 190 18 182 Z';
const RIGHT = 'M174 50 H302 V182 Q302 190 294 190 H182 Q174 190 174 182 Z';
const LEFT_AREA = 'M26 58 H138 V176 Q138 182 132 182 H32 Q26 182 26 176 Z';
const RIGHT_AREA = 'M182 58 H294 V176 Q294 182 288 182 H188 Q182 182 182 176 Z';
const WAY = 'M128 148 H192 V174 H128 Z';
const BED = 'M214 98 H262 Q268 98 268 104 V122 Q268 128 262 128 H214 Q208 128 208 122 V104 Q208 98 214 98 Z';
const BED_AROUND = 'M210 92 H266 Q274 92 274 100 V126 Q274 134 266 134 H210 Q202 134 202 126 V100 Q202 92 210 92 Z';
const TREE_LEFT = {x: 80, y: 118};
const ACROSS = 'M104 158 H216 Q226 165 216 172 H104 Q94 165 104 158 Z';

function Elements({dock}: ArtProps) {
  const dur = 7;
  const stroke = (color: string) => ({fill: 'none', stroke: color, strokeWidth: LINE, strokeLinejoin: 'round' as const});
  return (
    <Scene still={0} label="">
      <rect width={320} height={200} fill={STONE} />
      <rect x={146} y={0} width={28} height={200} fill="#b8b0a1" />
      <g transform="translate(-40 0)">
        <rect x={160} y={0} width={80} height={34} fill={ROOF} />
        <path d="M160 17 H240" stroke="#9aa0ab" strokeWidth={2} />
      </g>
      <Lawn d={LEFT} />
      <Lawn d={RIGHT} />
      <Tree {...TREE_LEFT} />
      <path d={BED} fill="#6d4c36" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle key={i} cx={220 + i * 8} cy={i % 2 ? 108 : 118} r={3} fill={['#ff6f91', '#ffd54f', '#ba68c8'][i % 3]} />
      ))}
      <path d={LEFT_AREA} fill="var(--c-mow)" opacity={FILL} />
      <path d={LEFT_AREA} {...stroke('var(--c-mow)')} />
      <path d={RIGHT_AREA} fill="var(--c-mow)" opacity={FILL} />
      <path d={RIGHT_AREA} {...stroke('var(--c-mow)')} />
      <path d={WAY} fill="var(--c-nav)" opacity={0.35} />
      <path d={WAY} {...stroke('var(--c-nav)')} />
      <circle cx={TREE_LEFT.x} cy={TREE_LEFT.y} r={25} fill="var(--c-obstacle)" opacity={FILL} />
      <circle cx={TREE_LEFT.x} cy={TREE_LEFT.y} r={25} {...stroke('var(--c-obstacle)')} />
      <path d={BED_AROUND} fill="var(--c-obstacle)" opacity={FILL} />
      <path d={BED_AROUND} {...stroke('var(--c-obstacle)')} />
      <Station dock={dock} x={46} y={46} size={11} />
      <g>
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" rotate="auto" calcMode="linear" path={ACROSS} />
        <MowerAt size={8} />
      </g>
    </Scene>
  );
}

export const ART = [Intro, Docking, Outline, Obstacles, Elements];

// the small pictures in the list of what a map has
export function LegendIcon({kind, dock}: {kind: 'mow' | 'nav' | 'obstacle' | 'dock'; dock: Dock}) {
  return (
    <svg viewBox="0 0 40 40" width={40} height={40} aria-hidden="true">
      {kind === 'mow' && (
        <>
          <rect x={5} y={5} width={30} height={30} rx={6} fill="var(--c-mow)" fillOpacity={0.3} stroke="var(--c-mow)" strokeWidth={2.2} />
          <path d="M14 28 q1 -8 5 -12 M20 28 q0 -8 4 -12 M26 28 q0 -6 3 -9" stroke="var(--c-mow)" strokeWidth={2.4} fill="none" strokeLinecap="round" />
        </>
      )}
      {kind === 'nav' && (
        <>
          <path d="M13 6 H27 L35 34 H5 Z" fill="var(--c-nav)" fillOpacity={0.3} stroke="var(--c-nav)" strokeWidth={2.2} strokeLinejoin="round" />
          <path d="M20 10 V30" stroke="var(--c-nav)" strokeWidth={2} strokeDasharray="4 3" />
        </>
      )}
      {kind === 'obstacle' && (
        <>
          <circle cx={20} cy={20} r={15} fill="var(--c-obstacle)" fillOpacity={0.3} stroke="var(--c-obstacle)" strokeWidth={2.2} />
          <circle cx={20} cy={18} r={7} fill="var(--c-obstacle)" />
          <path d="M20 24 V30" stroke="var(--c-obstacle)" strokeWidth={2.4} strokeLinecap="round" />
        </>
      )}
      {kind === 'dock' && (
        <>
          <circle cx={20} cy={20} r={17} fill="var(--c-dock)" fillOpacity={0.18} />
          <g transform="translate(20 20) scale(13)">{drawDock(dock)}</g>
        </>
      )}
    </svg>
  );
}
