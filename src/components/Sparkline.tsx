import type {Sample} from '@/hooks/useSensorHistory';
import styles from './Sparkline.module.css';

// small line of the last hour, min/max next to it
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
  if (!samples || samples.length < 2) return <div className={styles.empty}>collecting history…</div>;

  const w = 200;
  const h = 32;
  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const vs = samples.map((s) => s.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = Math.max(hi - lo, minSpan);
  const base = (lo + hi) / 2 - span / 2;
  const points = samples
    .map((s) => `${(((s.t - t0) / (t1 - t0 || 1)) * w).toFixed(1)},${(h - 2 - ((s.v - base) / span) * (h - 4)).toFixed(1)}`)
    .join(' ');
  const minutes = Math.max(1, Math.round((t1 - t0) / 60000));

  return (
    <div className={styles.wrap}>
      <svg className={styles.svg} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <polyline points={points} />
      </svg>
      <div className={styles.legend}>
        <span>{minutes} min</span>
        <span>
          {lo.toFixed(digits)}–{hi.toFixed(digits)} {unit}
        </span>
      </div>
    </div>
  );
}
