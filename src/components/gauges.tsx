'use client';

import type {SensorInfo} from '@/hooks/useMowerSensors';
import {bladeSeconds} from '@/lib/mowerBody';
import {along, sensorDial, type Tone} from '@/lib/sensorLimits';

const RED = '#e53935';
const YELLOW = '#fbc02d';
const GREEN = '#43a047';
const TONE: Record<Tone, string> = {ok: GREEN, warn: YELLOW, crit: RED};
const NEEDLE = '#616161';
// the dial is three quarters of a circle, open at the bottom
const DIAL_ANGLE = 1.5 * Math.PI;

// a sensor's value on the dial its limits make (lib/sensorLimits). spin: rpm of what the gauge shows, a blade turns in
// the middle that way round (negative: the other way), at a speed the eye can follow
export function RadialGauge({value, info, size = 120, spin}: {value: number; info: SensorInfo; size?: number; spin?: number}) {
  const dial = sensorDial(info, value);
  const c = size / 2;
  const r = c - 16;
  // the point d from the middle at f of the way along the dial. its angle goes clockwise from 12 o'clock (svg's y
  // points down), -135° at the dial's start and 135° at its end
  const at = (f: number, d: number) => {
    const a = (f - 0.5) * DIAL_ANGLE;
    return [c + d * Math.sin(a), c - d * Math.cos(a)];
  };
  // clockwise from f to t, over more than half the circle beyond 2/3 of the dial
  const arc = (f: number, t: number) => `M ${at(f, r).join(' ')} A ${r} ${r} 0 ${t - f > 2 / 3 ? 1 : 0} 1 ${at(t, r).join(' ')}`;
  const [x, y] = at(along(dial, value), r - 4);

  return (
    <svg width={size} height={size} viewBox={[0, 0, size, size].join(' ')}>
      {dial.bands.map((b, i) => (
        <path key={i} d={arc(along(dial, b.start), along(dial, b.end))} stroke={TONE[b.tone]} strokeWidth={10} fill="none" />
      ))}
      {spin !== undefined && <Blade cx={c} cy={c} r={r * 0.55} rpm={spin} />}
      <line x1={c} y1={c} x2={x} y2={y} stroke={NEEDLE} strokeWidth={2} />
      <circle cx={c} cy={c} r={4} fill={NEEDLE} />
    </svg>
  );
}

// a mow blade seen from above, turning with the motor (lib/mowerBody), standing still at 0, not turning at all for
// someone who asked for less motion
function Blade({cx, cy, r, rpm}: {cx: number; cy: number; r: number; rpm: number}) {
  const still = rpm === 0 || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  return (
    <g opacity={0.35}>
      <rect x={cx - r} y={cy - 3} width={2 * r} height={6} rx={3} fill="#616161" />
      <rect x={cx - r} y={cy - 3} width={6} height={6} rx={1} fill="#616161" transform={`rotate(-20 ${cx - r + 3} ${cy})`} />
      <rect x={cx + r - 6} y={cy - 3} width={6} height={6} rx={1} fill="#616161" transform={`rotate(-20 ${cx + r - 3} ${cy})`} />
      {!still && (
        <animateTransform
          attributeName="transform"
          type="rotate"
          from={`0 ${cx} ${cy}`}
          to={`${rpm < 0 ? -360 : 360} ${cx} ${cy}`}
          dur={`${bladeSeconds(rpm)}s`}
          repeatCount="indefinite"
        />
      )}
    </g>
  );
}

// Temperatures all share one fixed scale so they can be compared at a glance. Only the upper limits
// matter (a cold motor is fine): yellow above the sensor's normal max, red from its critical value.
// Sensors without limits just get a neutral bar.
// the limits from the sensor's info, or given directly (warn: yellow mark, crit: red one)
export function TempGauge({value, info, limits}: {value: number; info?: SensorInfo; limits?: {warn?: number; crit?: number}}) {
  // a max on its own counts, OpenMower only sets has_min_max when there's a min as well (max_pcb_temp of an ESC)
  const warn = info ? (info.max_value > 0 ? info.max_value : undefined) : limits?.warn;
  const crit = info ? (info.has_critical_high && info.upper_critical_value >= 0 ? info.upper_critical_value : undefined) : limits?.crit;
  const max = Math.max(90, (crit ?? 0) + 10);
  const color = crit !== undefined && value >= crit ? RED : warn !== undefined && value >= warn ? YELLOW : GREEN;
  const x = (v: number) => (Math.min(Math.max(v, 0), max) / max) * 100;
  const ticks = [0, 30, 60, 90].filter((t) => t <= max);

  return (
    <div style={{width: '100%', marginTop: 6}}>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" width="100%" height={10} style={{display: 'block'}}>
        {/* the track and the ticks in the theme's colours, visible on light cards too */}
        <rect x={0} y={1.5} width={100} height={7} rx={3.5} style={{fill: 'color-mix(in srgb, var(--text-secondary) 22%, transparent)'}} />
        <rect x={0} y={1.5} width={Math.max(2, x(value))} height={7} rx={3.5} fill={color} />
        {warn !== undefined && <rect x={x(warn) - 0.4} y={0} width={0.8} height={10} fill={YELLOW} />}
        {crit !== undefined && <rect x={x(crit) - 0.4} y={0} width={0.8} height={10} fill={RED} />}
      </svg>
      <div style={{position: 'relative', height: 14, fontSize: 10, color: 'var(--text-secondary)'}}>
        {ticks.map((t) => (
          <span
            key={t}
            style={{
              position: 'absolute',
              left: `${x(t)}%`,
              transform: t === 0 ? 'none' : t === max ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {t}°
          </span>
        ))}
      </div>
    </div>
  );
}
