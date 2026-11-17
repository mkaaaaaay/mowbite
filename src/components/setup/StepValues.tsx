import {fmt, tr} from '@/lib/i18n';
import {nameOf, type SetupValue} from '@/lib/setup';
import styles from './StepValues.module.css';

// a measured value as it's shown: a number with as many decimals as it needs, a text as it is
export function valueText(v: unknown, unit: string): string {
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'number') {
    const a = Math.abs(v);
    const n = Number.isInteger(v) ? fmt(v) : fmt(v, a < 1 ? 3 : a < 10 ? 2 : 1);
    return unit ? `${n} ${unit}` : n;
  }
  if (Array.isArray(v)) return v.length ? v.join(', ') : tr('none of them');
  return String(v);
}

const bounds = (v: SetupValue) =>
  v.min !== null && v.max !== null
    ? `${valueText(v.min, '')}–${valueText(v.max, v.unit)}`
    : v.min !== null
      ? `≥ ${valueText(v.min, v.unit)}`
      : v.max !== null
        ? `≤ ${valueText(v.max, v.unit)}`
        : '';

// where the value and its bounds sit on a bar: two bounds in the middle half, one above zero in the middle from zero
function scale(v: SetupValue): {band: [number, number]; pin: number} | null {
  if (typeof v.value !== 'number') return null;
  let lo = 0;
  let hi: number;
  if (v.min !== null && v.max !== null) [lo, hi] = [v.min - (v.max - v.min) / 2, v.max + (v.max - v.min) / 2];
  else if ((v.max ?? v.min ?? 0) > 0) hi = 2 * (v.max ?? v.min)!;
  else return null;
  const at = (x: number) => Math.min(100, Math.max(0, ((x - lo) / (hi - lo || 1)) * 100));
  return {band: [v.min !== null ? at(v.min) : 0, v.max !== null ? at(v.max) : 100], pin: at(v.value)};
}

function verdict(v: SetupValue): string {
  if (v.ok === null) return '';
  if (v.ok) return tr('good');
  if (typeof v.value === 'number' && v.max !== null && v.value > v.max) return tr('too high');
  if (typeof v.value === 'number' && v.min !== null && v.value < v.min) return tr('too low');
  return tr('not right');
}

// what a step measures, live while it runs and as it ended, each against its bounds
export function StepValues({values, lang}: {values: SetupValue[]; lang: string}) {
  if (!values.length) return null;
  return (
    <dl className={styles.values}>
      {values.map((v) => {
        const bar = scale(v);
        return (
          <div key={v.id} className={styles.value} data-ok={v.ok === null ? undefined : String(v.ok)}>
            <dt>{nameOf(v, lang)}</dt>
            <dd className={styles.word}>{verdict(v)}</dd>
            <dd className={styles.number}>{valueText(v.value, v.unit)}</dd>
            {bar && (
              <dd className={styles.bar} aria-hidden="true">
                <span className={styles.band} style={{left: `${bar.band[0]}%`, width: `${bar.band[1] - bar.band[0]}%`}} />
                <span className={styles.pin} style={{left: `calc(${bar.pin}% - 2px)`}} />
              </dd>
            )}
            {bounds(v) && <dd className={styles.bounds}>{bounds(v)}</dd>}
          </div>
        );
      })}
    </dl>
  );
}
