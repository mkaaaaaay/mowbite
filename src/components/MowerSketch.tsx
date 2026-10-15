'use client';

import {tr} from '@/lib/i18n';
import type {MowerBody} from '@/lib/mowerBody';
import local from './MowerSketch.module.css';

// the mower from above, heading right, to scale: body, blade, the point it follows and the gps antenna
export function MowerSketch({body, antenna}: {body: MowerBody; antenna?: {x: number; y: number}}) {
  const pad = 0.12;
  // more room on the left, the width is written there
  const left = pad + 0.06;
  const halfW = Math.max(body.width / 2, body.blade / 2 + Math.abs(body.bladeOffset));
  const x0 = -body.rear - left;
  const w = body.front + body.rear + pad + left;
  const h = 2 * halfW + 2 * pad;
  const label = (v: number) => `${Math.round(v * 100)} cm`;
  return (
    <svg className={local.sketch} viewBox={`${x0} ${-halfW - pad} ${w} ${h}`} role="img" aria-label={tr('The mower from above')}>
      {/* y flipped: left of the mower is up */}
      <g transform="scale(1 -1)">
        {body.outline ? (
          <polygon className={local.body} points={body.outline.map(([ahead, left]) => `${ahead},${left}`).join(' ')} />
        ) : (
          <rect className={local.body} x={-body.rear} y={-body.width / 2} width={body.front + body.rear} height={body.width} rx={0.03} />
        )}
        {body.blade > 0 && <circle className={local.blade} cx={body.bladeAhead} cy={body.bladeOffset} r={body.blade / 2} />}
        <line className={local.axle} x1={0} y1={-body.width / 2} x2={0} y2={body.width / 2} />
        <circle className={local.point} cx={0} cy={0} r={0.015} />
        <path className={local.heading} d={`M ${body.front - 0.09} 0 l -0.05 0.035 m 0.05 -0.035 l -0.05 -0.035`} />
        {antenna && <circle className={local.antenna} cx={antenna.x} cy={antenna.y} r={0.02} />}
      </g>
      <text className={local.text} x={body.front / 2} y={-body.width / 2 - 0.03} textAnchor="middle">
        {label(body.front)}
      </text>
      <text className={local.text} x={-body.rear / 2} y={-body.width / 2 - 0.03} textAnchor="middle">
        {label(body.rear)}
      </text>
      <text className={local.text} x={-body.rear - 0.02} y={0.015} textAnchor="end">
        {label(body.width)}
      </text>
    </svg>
  );
}
