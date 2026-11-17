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

// what a step measures, live while it runs and as it ended, each against its bounds
export function StepValues({values, lang}: {values: SetupValue[]; lang: string}) {
  if (!values.length) return null;
  return (
    <dl className={styles.values}>
      {values.map((v) => (
        <div key={v.id} className={styles.value} data-ok={v.ok === null ? undefined : String(v.ok)}>
          <dt>{nameOf(v, lang)}</dt>
          <dd>
            {valueText(v.value, v.unit)}
            {bounds(v) && <span className={styles.bounds}>{bounds(v)}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
