'use client';

import {stillPreferred} from '@/lib/eggs';
import mapStyles from './MapView.module.css';

// what the eaters and the mower's icon wear now and then, drawn in the eater's 64 box (WitchHat, Towel, Umbrella)

export function WitchHat() {
  return (
    <g>
      <path
        d="M13.6 14.2 C16.8 9.2 19 3.4 21.6 -2.6 C23 -5.6 26.6 -7 30.2 -5.4 C26.8 -4.4 25.6 -1.4 25.9 2.6 C26.2 7.8 28.6 11.4 32.4 14.2 Z"
        fill="#3b2a5a"
        stroke="#241838"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      <path d="M15.5 11.4 C20.3 12.7 26.1 12.7 30.6 11.5 L31.6 13.2 C26.6 14.6 19.8 14.6 14.6 13.1 Z" fill="#ff9800" />
      <rect x="21.4" y="11.6" width="3.2" height="2.6" rx="0.4" fill="none" stroke="#ffd54f" strokeWidth="0.8" />
      <ellipse cx="23" cy="14.6" rx="12.6" ry="2.5" fill="#2a1d42" />
      <path d="M21.2 5.2 l0.6 1.3 1.4 0.1 -1.1 0.9 0.4 1.4 -1.3 -0.8 -1.2 0.8 0.4 -1.4 -1.1 -0.9 1.4 -0.1 Z" fill="#ffd54f" />
    </g>
  );
}

// a towel over its back, the way a hitchhiker carries one
export function Towel() {
  return (
    <g>
      {/* a little wider than the body, so it reads as something lying on it */}
      <path
        d="M22.3 12.3 Q8.2 13.6 4.2 32 L5.5 40.8 L12.3 38.6 L10.9 32 Q13 20.7 22.9 19 Z"
        fill="#fff3c4"
        stroke="#c9a94f"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      <path d="M4.6 35 L11.4 34.2 M4.4 32.4 L11 31.8 M19.4 12.6 L20.2 19.4 M16.6 13.2 L17.8 19.9" stroke="#3d5afe" strokeWidth="1.2" />
      <path d="M6.2 40.6 l-0.4 2 M8.2 40 l-0.3 2 M10.2 39.3 l-0.2 2 M12 38.7 l0 2" stroke="#c9a94f" strokeWidth="0.8" strokeLinecap="round" />
    </g>
  );
}

// a red umbrella, its handle in the mouth
export function Umbrella() {
  return (
    <g transform="rotate(10 33 2)">
      <path d="M33.6 7 L38.6 28.6 Q39.2 31.4 37 31.6" fill="none" stroke="#5d4037" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M13 7.2 C15 -4.6 27 -10 33 -10 C39 -10 51 -4.6 53 7.2 Q48 3.8 43 7.2 Q38 3.8 33 7.2 Q28 3.8 23 7.2 Q18 3.8 13 7.2 Z"
        fill="#e53950"
        stroke="#a3122a"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      <path d="M33 -10 Q27 -2 23 7.2 Z M33 -10 Q39 -2 43 7.2 Z" fill="#ff8a80" opacity="0.55" />
      <path d="M33 -10 L33 -12.6" stroke="#5d4037" strokeWidth="1.2" strokeLinecap="round" />
    </g>
  );
}

// the same dressing for the mower's icon on the map, any icon: upright over it, in the icon's -1..1 box. high: a side
// view (a figure, the openmower), its top is higher
export function MapCostume({hat, towel, umbrella, high}: {hat?: boolean; towel?: boolean; umbrella?: boolean; high?: boolean}) {
  const lift = high ? 0.6 : 0;
  // the umbrella's rim, its top is 1 higher
  const rim = -1.05 - lift;
  const top = rim - 1;
  // where a drop over the canopy lands
  const onCanopy = (x: number) => (Math.abs(x) < 1.3 ? top + 1 - (1 - (x / 1.3) ** 2) * 0.95 : 1.2);
  return (
    <g>
      {towel && (
        <g transform={`translate(0 ${-lift * 0.5})`}>
          <path d="M-0.62 -0.5 Q0 -0.7 0.62 -0.5 L0.56 0.42 Q0 0.3 -0.56 0.42 Z" fill="#f3e3b0" stroke="#c9b06a" strokeWidth="0.05" strokeLinejoin="round" />
          <path d="M-0.59 0.1 Q0 -0.02 0.59 0.1 M-0.58 0.24 Q0 0.12 0.58 0.24" fill="none" stroke="#4f74e3" strokeWidth="0.07" />
          <path d="M-0.45 0.38 v0.14 M-0.22 0.34 v0.14 M0 0.33 v0.14 M0.22 0.34 v0.14 M0.45 0.38 v0.14" stroke="#c9b06a" strokeWidth="0.04" strokeLinecap="round" />
        </g>
      )}
      {hat && (
        <g transform={`translate(0 ${-0.45 - lift}) scale(0.075) translate(-23 -14.6)`}>
          <WitchHat />
        </g>
      )}
      {umbrella && (
        <g>
          <path d={`M0 ${rim} L0 0.2 Q0 0.42 -0.2 0.38`} fill="none" stroke="#5d4037" strokeWidth="0.09" strokeLinecap="round" />
          <path
            d={`M-1.3 ${rim} C-1.2 ${rim - 0.75} -0.45 ${top} 0 ${top} C0.45 ${top} 1.2 ${rim - 0.75} 1.3 ${rim} Q0.98 ${rim - 0.2} 0.65 ${rim} Q0.33 ${rim - 0.2} 0 ${rim} Q-0.33 ${rim - 0.2} -0.65 ${rim} Q-0.98 ${rim - 0.2} -1.3 ${rim} Z`}
            fill="#e53950"
            stroke="#a3122a"
            strokeWidth="0.05"
            strokeLinejoin="round"
          />
          <path d={`M0 ${top} Q-0.42 ${rim - 0.5} -0.65 ${rim} Z M0 ${top} Q0.42 ${rim - 0.5} 0.65 ${rim} Z`} fill="#ff8a80" opacity="0.55" />
          <path d={`M0 ${top} L0 ${top - 0.16}`} stroke="#5d4037" strokeWidth="0.08" strokeLinecap="round" />
          {!stillPreferred() &&
            [-1.75, -1.05, -0.45, 0.3, 0.95, 1.7].map((x, i) => (
              <line
                key={x}
                className={mapStyles.drop}
                x1={x}
                y1={top - 1.3}
                x2={x}
                y2={top - 1.05}
                style={{'--to': `${onCanopy(x) - (top - 1.05)}px`, animationDelay: `${(i * 0.37) % 1.3}s`} as React.CSSProperties}
              />
            ))}
        </g>
      )}
    </g>
  );
}
