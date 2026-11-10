'use client';

import styles from './Segments.module.css';

export interface Segment<T> {
  key: T;
  text: string;
  // the whole name for screen readers where text is a short form
  name?: string;
}

// one of a few to pick: a bar with parts of the same width
export default function Segments<T extends string | number>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly Segment<T>[];
  value: T | undefined;
  onPick: (key: T) => void;
}) {
  return (
    <div className={styles.segments} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          className={[styles.part, o.key === value ? styles.on : ''].join(' ')}
          aria-pressed={o.key === value}
          aria-label={o.name}
          onClick={() => onPick(o.key)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}
