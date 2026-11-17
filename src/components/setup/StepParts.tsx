import {nameOf, type SetupPart} from '@/lib/setup';
import styles from './StepParts.module.css';

// the parts of a step, each with its own tick; the one to do now is waiting
export function StepParts({parts, lang}: {parts: SetupPart[]; lang: string}) {
  if (!parts.length) return null;
  return (
    <ol className={styles.parts}>
      {parts.map((p) => (
        <li key={p.id} data-state={p.state} className={styles.part}>
          {nameOf(p, lang)}
        </li>
      ))}
    </ol>
  );
}
