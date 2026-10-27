import type {Sample} from '@/hooks/useSensorHistory';
import styles from './Sparkline.module.css';
import {clock} from '@/lib/dates';
import {fmt, tr} from '@/lib/i18n';

// small line of the history, lowest and highest value next to it
// minSpan keeps sensor noise from looking like big swings on an otherwise flat line
export default function Sparkline({
  samples,
  digits = 1,
  unit = '',
  minSpan = 1,
}: {
  samples?: Sample[];
  digits?: number;
  unit?: string;
  minSpan?: number;
}) {
  if (!samples || samples.length < 2) return <div className={styles.empty}>{tr('collecting history…')}</div>;

  const w = 200;
  const h = 32;
  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const lo = Math.min(...samples.map((s) => s.lo ?? s.v));
  const hi = Math.max(...samples.map((s) => s.hi ?? s.v));
  const span = Math.max(hi - lo, minSpan);
  const base = (lo + hi) / 2 - span / 2;
  const at = (s: Sample) => `${(((s.t - t0) / (t1 - t0 || 1)) * w).toFixed(1)},${(h - 2 - ((s.v - base) / span) * (h - 4)).toFixed(1)}`;
  // no line over the time without data (gps only comes while it mows): a new piece after a gap of three times the
  // usual step, ten minutes at least
  const steps = samples.slice(1).map((s, i) => s.t - samples[i].t).sort((a, b) => a - b);
  const gap = Math.max(600000, 3 * (steps[Math.floor(steps.length / 2)] ?? 0));
  const pieces: Sample[][] = [];
  samples.forEach((s, i) => (i && s.t - samples[i - 1].t <= gap ? pieces[pieces.length - 1].push(s) : pieces.push([s])));
  const minutes = Math.max(1, Math.round((t1 - t0) / 60000));
  const range = minutes < 90 ? `${minutes} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} d`;
  // when the data ends: a gap up to now isn't drawn either
  const until = ` · ${tr('until {time}', {time: clock(t1 / 1000)})}`;

  return (
    <div className={styles.wrap}>
      <svg className={styles.svg} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {pieces.map((p, i) => (p.length > 1 ? <polyline key={i} points={p.map(at).join(' ')} /> : <circle key={i} cx={at(p[0]).split(',')[0]} cy={at(p[0]).split(',')[1]} r={1.2} />))}
      </svg>
      <div className={styles.legend}>
        <span>
          {range}
          {until}
        </span>
        <span>
          {fmt(lo, digits)}–{fmt(hi, digits)} {unit}
        </span>
      </div>
    </div>
  );
}
